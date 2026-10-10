import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatINR, regionName } from '@sih/shared';
import type { ScrapeConfig } from './config';
import type { ProxyNote, Rejection, RunTotals } from './types';

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  config: ScrapeConfig;
  totals: RunTotals;
  rejections: Rejection[];
  proxies: ProxyNote[];
  unmappedCategories: Array<{ name: string; tags: string[] }>;
}

/** Console summary — the bit you actually read when the run finishes. */
export function printSummary(report: RunReport): void {
  const { totals } = report;
  const line = '─'.repeat(64);

  console.log(`\n${line}`);
  console.log('  myScheme scrape summary');
  console.log(line);
  console.log(`  discovered          ${totals.discovered}`);
  console.log(`  visited             ${totals.visited}`);
  console.log(`  scraped ok          ${totals.scraped}`);
  console.log(`  normalised          ${totals.normalized}`);
  console.log(`  inserted            ${totals.inserted}`);
  console.log(`  updated             ${totals.updated}`);
  console.log(`  skipped (duplicate) ${totals.skippedDuplicate}`);
  console.log(`  rejected            ${totals.rejected}`);
  console.log(`  transient (retry)   ${totals.transientFailures}`);
  console.log(`  PROXY income applied ${totals.proxy}`);
  console.log(line);

  if (totals.transientFailures > 0) {
    console.log(
      `\n  ${totals.transientFailures} scheme(s) failed on infrastructure (rate limit / timeout)`,
    );
    console.log('  and are still queued — re-run the same command to pick them up.');
  }

  if (report.proxies.length > 0) {
    console.log(`\n  PROXY — income ceiling substituted for deprivation criteria (review these):`);
    for (const proxy of report.proxies) {
      console.log(`    · ${proxy.schemeName}`);
      console.log(
        `      trigger "${proxy.trigger}" → maxAnnualIncome ${formatINR(proxy.appliedIncomeCeiling)}`,
      );
    }
  }

  if (report.rejections.length > 0) {
    console.log(`\n  REJECTED — not inserted, fix by hand:`);
    for (const rejection of report.rejections) {
      console.log(`    · [${rejection.stage}] ${rejection.name || rejection.slug}`);
      console.log(`      ${rejection.reason}`);
      for (const detail of rejection.details ?? []) {
        console.log(`        - ${detail}`);
      }
      console.log(`      ${rejection.sourceUrl}`);
    }
  }

  if (report.unmappedCategories.length > 0) {
    console.log(
      `\n  Filed as OTHER — no category pattern matched (${report.unmappedCategories.length}):`,
    );
    for (const entry of report.unmappedCategories.slice(0, 15)) {
      console.log(`    · ${entry.name} [${entry.tags.slice(0, 5).join(', ')}]`);
    }
  }

  console.log('');
}

/** Markdown report, so the rejected list survives the terminal scrollback. */
export async function writeReport(report: RunReport, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const { totals } = report;
  const lines: string[] = [
    '# myScheme scrape report',
    '',
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Normaliser: \`${report.config.normalizer}\`${
      report.config.normalizer === 'llm' ? ` (model \`${report.config.llm.model}\`)` : ''
    }`,
    `- Target: ${report.config.target} new schemes`,
    `- Dry run: ${report.config.dryRun ? 'yes — nothing was written' : 'no'}`,
    '',
    '## Totals',
    '',
    '| Stage | Count |',
    '| --- | --- |',
    `| Discovered | ${totals.discovered} |`,
    `| Visited | ${totals.visited} |`,
    `| Scraped | ${totals.scraped} |`,
    `| Normalised | ${totals.normalized} |`,
    `| Inserted | ${totals.inserted} |`,
    `| Updated | ${totals.updated} |`,
    `| Skipped (duplicate name) | ${totals.skippedDuplicate} |`,
    `| Rejected (needs a human) | ${totals.rejected} |`,
    `| Transient failures (still queued) | ${totals.transientFailures} |`,
    `| PROXY income applied | ${totals.proxy} |`,
    '',
  ];

  lines.push('## PROXY schemes — needs review', '');
  if (report.proxies.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push(
      'These schemes select beneficiaries by SECC / BPL / Antyodaya deprivation criteria',
      'rather than a stated income figure. An income ceiling was substituted so they can be',
      'matched at all, exactly as `seed.ts` does. **The ceiling is our invention, not the',
      "scheme's rule** — confirm each against the source before relying on it.",
      '',
    );
    for (const proxy of report.proxies) {
      lines.push(
        `### ${proxy.schemeName}`,
        '',
        `- Source: ${proxy.sourceUrl}`,
        `- Trigger phrase: \`${proxy.trigger}\``,
        `- Applied \`maxAnnualIncome\`: ${proxy.appliedIncomeCeiling} (${formatINR(proxy.appliedIncomeCeiling)})`,
        '',
        '```',
        proxy.prose,
        '```',
        '',
      );
    }
  }

  lines.push('## Rejected schemes — fix by hand', '');
  if (report.rejections.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push(
      'Nothing below was written to the database. Each entry failed at the stage shown,',
      'with the source prose included so the rule can be written by hand.',
      '',
    );
    for (const rejection of report.rejections) {
      lines.push(
        `### ${rejection.name || rejection.slug}`,
        '',
        `- Stage: \`${rejection.stage}\``,
        `- Reason: ${rejection.reason}`,
        `- Source: ${rejection.sourceUrl}`,
      );
      if (rejection.details?.length) {
        lines.push('- Details:');
        for (const detail of rejection.details) lines.push(`  - ${detail}`);
      }
      if (rejection.prose) {
        lines.push('', '```', rejection.prose, '```');
      }
      lines.push('');
    }
  }

  if (report.unmappedCategories.length > 0) {
    lines.push(
      '## Filed as OTHER',
      '',
      'No category pattern matched these, so they were stored as `OTHER`. Add a pattern to',
      '`mapping.ts` if any of them belong somewhere specific.',
      '',
    );
    for (const entry of report.unmappedCategories) {
      lines.push(`- ${entry.name} — tags: ${entry.tags.join(', ') || '(none)'}`);
    }
    lines.push('');
  }

  await writeFile(path, lines.join('\n'), 'utf8');
}

export function describeScope(state: string | null): string {
  return state === null ? 'Central' : regionName(state);
}
