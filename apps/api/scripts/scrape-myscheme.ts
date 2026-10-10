/**
 * ============================================================================
 * myScheme scraper
 * ============================================================================
 *
 *   npm run scrape                          -- 175 schemes, LLM normalisation
 *   npm run scrape -- --normalizer=rules    -- no API key needed
 *   npm run scrape -- --dry-run --target=10 -- look before you write
 *
 * Pipeline, per scheme:
 *
 *   discover URL  →  render page  →  extract prose  →  normalise  →  ground
 *                 →  Zod validate →  insert
 *
 * Two properties matter more than throughput here.
 *
 * **Nothing malformed reaches the database.** `schemes.eligibility` is guarded by
 * a CHECK constraint, and the same shape is defined by `eligibilityRuleSchema` in
 * @sih/shared. Every record goes through that Zod schema first, so a bad rule is
 * reported with the offending prose attached instead of blowing up an insert.
 *
 * **No number is invented.** An LLM asked to read eligibility prose will happily
 * produce a plausible income ceiling that the source never stated, and in this
 * domain that silently excludes the people a scheme exists for. Every numeric
 * bound is checked back against the prose and the record is rejected if it cannot
 * be found there.
 *
 * Written in TypeScript rather than Python for one reason: the requirement is to
 * validate against the *existing* Zod normalizer and write through the *existing*
 * Prisma schema. From TypeScript both are a direct import; from Python both would
 * be reimplemented or shelled out to, and a second implementation of the rules is
 * exactly the drift this project has been careful to avoid. Playwright's Node API
 * is the same API as its Python one.
 */
import { PrismaClient } from '@prisma/client';
import { chromium, type Browser, type Page } from 'playwright';
import { ARTIFACT_DIRECTORY, buildConfig, type ScrapeConfig } from './myscheme/config';
import { discoverSchemeUrls } from './myscheme/discover';
import { eligibilityProse, extractScheme } from './myscheme/extract';
import { normalizeScheme } from './myscheme/normalize';
import { duplicateKey, loadExistingNames, persistScheme } from './myscheme/persist';
import { printSummary, writeReport, type RunReport } from './myscheme/report';
import { ProgressLog, RawArchive, UrlCache } from './myscheme/state';
import type { ProxyNote, RawScheme, Rejection, RunTotals } from './myscheme/types';
import { resolve } from 'node:path';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const config = buildConfig();
  const startedAt = new Date().toISOString();

  console.log('myScheme scraper');
  console.log(
    `  normaliser   ${config.normalizer}${config.normalizer === 'llm' ? ` (${config.llm.model})` : ''}`,
  );
  console.log(`  target       ${config.target} new schemes`);
  console.log(`  politeness   ${config.delayMs}ms between page loads`);
  console.log(`  artifacts    ${ARTIFACT_DIRECTORY}`);
  if (config.dryRun) console.log('  DRY RUN — nothing will be written to the database');

  if (config.normalizer === 'llm' && !config.llm.apiKey) {
    console.error(
      '\nNo LLM credentials found. Set LLM_API_KEY (and optionally LLM_BASE_URL / LLM_MODEL),\n' +
        'or run with --normalizer=rules to use the deterministic extractor.',
    );
    process.exitCode = 1;
    return;
  }

  const totals: RunTotals = {
    discovered: 0,
    visited: 0,
    scraped: 0,
    normalized: 0,
    inserted: 0,
    updated: 0,
    skippedDuplicate: 0,
    rejected: 0,
    transientFailures: 0,
    proxy: 0,
  };
  const rejections: Rejection[] = [];
  const proxies: ProxyNote[] = [];
  const unmappedCategories: Array<{ name: string; tags: string[] }> = [];

  const progress = await ProgressLog.open(config.stateFile, { force: config.force });
  const archive = await RawArchive.open(config.rawArchiveFile);
  const urlCache = await UrlCache.open(resolve(ARTIFACT_DIRECTORY, 'discovered-urls.txt'));

  const existingNames = await loadExistingNames(prisma);
  console.log(`  already in DB ${existingNames.size} schemes\n`);

  let browser: Browser | undefined;

  try {
    // Re-normalising the archive touches neither the portal nor a browser.
    let page: Page | undefined;
    if (!config.fromArchive) {
      browser = await chromium.launch({ headless: config.headless });
      page = await browser.newPage({ userAgent: config.userAgent });
      page.setDefaultTimeout(45_000);
    }

    const jobs: Array<{ url: string; scheme?: RawScheme }> = config.fromArchive
      ? (await RawArchive.readAll(config.rawArchiveFile)).map((scheme) => ({
          url: scheme.sourceUrl,
          scheme,
        }))
      : (await collectUrls(page as Page, config, urlCache, progress)).map((url) => ({ url }));

    totals.discovered = jobs.length;
    if (config.fromArchive) {
      console.log(`Re-normalising ${jobs.length} archived schemes — no portal traffic`);
    }

    const pending = jobs.filter((job) => !progress.isDone(job.url));
    console.log(`\n${pending.length} to process (${jobs.length - pending.length} already done)\n`);

    for (const { url, scheme: archived } of pending) {
      if (totals.inserted + totals.updated >= config.target) {
        console.log(`\nReached target of ${config.target} schemes.`);
        break;
      }

      totals.visited += 1;
      const label = `[${totals.visited}/${pending.length}]`;

      if (!config.fromArchive) await sleep(config.delayMs);

      const scheme = archived ?? (await scrapeWithRetries(page as Page, url, config, label));
      if (!scheme) {
        await progress.record(url, 'failed', 'page could not be scraped');
        rejections.push({
          slug: url.split('/schemes/')[1] ?? url,
          sourceUrl: url,
          name: '',
          stage: 'extract',
          reason: `page could not be scraped after ${config.retries + 1} attempts`,
        });
        totals.rejected += 1;
        continue;
      }

      totals.scraped += 1;
      // Only a fresh scrape is worth archiving; re-runs would duplicate the entry.
      if (!config.fromArchive) await archive.append(scheme);

      if (scheme.category === 'OTHER') {
        unmappedCategories.push({ name: scheme.name, tags: scheme.tags });
      }

      // Duplicate check before normalisation, so a scheme we already have never
      // costs an LLM call.
      //
      // Bypassed for `--from-archive`, where re-processing schemes already stored is
      // the entire point: it is how rows written by the deterministic normaliser get
      // upgraded once an LLM key is available. `persistScheme` then updates in place
      // on the (name, state) key rather than inserting a second row.
      const key = duplicateKey(scheme.name);
      const clash = config.fromArchive ? undefined : existingNames.get(key);
      if (clash) {
        console.log(`${label} skip (already have "${clash}")`);
        totals.skippedDuplicate += 1;
        await progress.record(url, 'skipped_duplicate', clash);
        continue;
      }

      const normalized = await normalizeScheme(scheme, config);
      if (!normalized.ok) {
        // A transient failure is the provider's problem, not the scheme's: leave the
        // URL retryable and keep it out of the "fix these by hand" list.
        if (normalized.rejection.transient) {
          console.log(`${label} retry later — ${scheme.name}`);
          console.log(`         ${normalized.rejection.reason.slice(0, 160)}`);
          totals.transientFailures += 1;
          await progress.record(url, 'failed', normalized.rejection.reason.slice(0, 200));
          continue;
        }

        console.log(`${label} REJECT [${normalized.rejection.stage}] ${scheme.name}`);
        console.log(`         ${normalized.rejection.reason}`);
        rejections.push({
          slug: scheme.slug,
          sourceUrl: scheme.sourceUrl,
          name: scheme.name,
          ...normalized.rejection,
        });
        totals.rejected += 1;
        await progress.record(url, 'rejected', normalized.rejection.reason);
        continue;
      }

      totals.normalized += 1;
      if (normalized.value.proxy) {
        proxies.push(normalized.value.proxy);
        totals.proxy += 1;
      }

      if (config.dryRun) {
        console.log(`${label} would insert ${scheme.name} — ${summarise(normalized.value.rule)}`);
        // Reserve the name so a duplicate later in the same dry run is still caught.
        existingNames.set(key, scheme.name);
        totals.inserted += 1;
        continue;
      }

      const outcome = await persistScheme(prisma, {
        scheme,
        normalized: normalized.value,
        rawEligibility: eligibilityProse(scheme),
      });

      if (outcome.status === 'rejected') {
        console.log(`${label} REJECT [insert] ${scheme.name}: ${outcome.rejection.reason}`);
        rejections.push(outcome.rejection);
        totals.rejected += 1;
        await progress.record(url, 'rejected', outcome.rejection.reason);
        continue;
      }

      existingNames.set(key, scheme.name);
      if (outcome.status === 'inserted') totals.inserted += 1;
      else totals.updated += 1;

      console.log(
        `${label} ${outcome.status} ${scheme.name} (${scheme.state ?? 'central'}, ${scheme.category})`,
      );
      await progress.record(url, outcome.status);
    }
  } finally {
    await browser?.close();
  }

  const report: RunReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    config,
    totals,
    rejections,
    proxies,
    unmappedCategories,
  };

  printSummary(report);
  await writeReport(report, config.reportFile);
  console.log(`Full report written to ${config.reportFile}\n`);
}

/**
 * Discovery is cached: walking the listing is the slowest part of a run and its
 * results do not change minute to minute, so a resumed run reuses them unless the
 * cache is too small for the target.
 */
async function collectUrls(
  page: Page,
  config: ScrapeConfig,
  cache: UrlCache,
  progress: ProgressLog,
): Promise<string[]> {
  const cached = await cache.read();
  const done = progress.processedUrls();
  const usableCached = cached.filter((url) => !done.has(url));

  if (!config.force && usableCached.length >= config.target) {
    console.log(`Using ${cached.length} cached URLs (${usableCached.length} unprocessed)`);
    return cached;
  }

  console.log('Discovering scheme URLs from the search listing...');
  // Over-fetch: some URLs will be duplicates of schemes already stored, and some
  // will be rejected, so discovery has to run ahead of the insert target.
  const need = Math.ceil(config.target * 1.6) + done.size;
  const discovered = await discoverSchemeUrls(page, config, { need, alreadyKnown: new Set() });

  const merged = [...new Set([...cached, ...discovered])];
  await cache.write(merged);
  return merged;
}

async function scrapeWithRetries(
  page: Page,
  url: string,
  config: ScrapeConfig,
  label: string,
): Promise<RawScheme | null> {
  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    try {
      return await extractScheme(page, url);
    } catch (error) {
      const message = (error as Error).message.split('\n')[0];
      const remaining = config.retries - attempt;
      console.log(
        `${label} scrape failed (${message})${remaining > 0 ? ` — retrying in ${(attempt + 1) * 2}s` : ''}`,
      );
      if (remaining > 0) await sleep((attempt + 1) * 2000);
    }
  }
  return null;
}

function summarise(rule: {
  minAge: number | null;
  maxAge: number | null;
  maxAnnualIncome: number | null;
  gender: string;
  states: string[];
}): string {
  const parts: string[] = [];
  if (rule.minAge !== null || rule.maxAge !== null) {
    parts.push(`age ${rule.minAge ?? '–'}..${rule.maxAge ?? '–'}`);
  }
  if (rule.maxAnnualIncome !== null) parts.push(`income ≤ ${rule.maxAnnualIncome}`);
  if (rule.gender !== '*') parts.push(rule.gender.toLowerCase());
  if (!rule.states.includes('*')) parts.push(rule.states.join('/'));
  return parts.length > 0 ? parts.join(', ') : 'open to all';
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

main()
  .catch((error) => {
    console.error('\nScrape failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
