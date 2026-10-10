import type { Page } from 'playwright';
import { inferCategory, resolveMinistry, resolveScope } from './mapping';
import { cleanText, stripHeading, toBulletList, truncate } from './text';
import type { RawScheme } from './types';

/**
 * A myScheme detail page renders each block under a stable anchor id — #details,
 * #benefits, #eligibility, #exclusions, #documents-required, #sources — which is
 * the one part of the markup safe to depend on. Everything else is generated
 * Tailwind classes.
 *
 * The header (ministry-or-state, title, tag cloud) has no ids at all, so it is
 * read positionally instead: of the text nodes preceding the first section, the
 * one immediately before the title is the ministry or state, and everything after
 * it is the tag cloud. That is anchored on the title, which we already know
 * independently from the `h1`, so it survives restyling.
 */
export async function extractScheme(page: Page, url: string): Promise<RawScheme> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#eligibility, #details', { timeout: 45_000 });
  // The section bodies hydrate a moment after the anchors appear.
  await page.waitForTimeout(1200);

  const name = cleanText(
    await page.$$eval('h1', (headings) => {
      const texts = headings.map((heading) => heading.textContent ?? '').filter((t) => t.trim());
      return texts[0] ?? '';
    }),
  );

  if (!name) {
    throw new Error('no scheme title found on the page');
  }

  const header = await readHeader(page, name);
  const sections = await readSections(page);
  const links = await readLinks(page);

  const details = stripHeading(sections.details, 'Details');
  const { state } = resolveScope(header.headerLabel);
  const ministry = resolveMinistry({ headerLabel: header.headerLabel, state, details });
  const { category } = inferCategory({ tags: header.tags, name, details });

  return {
    slug: url.split('/schemes/')[1] ?? url,
    sourceUrl: truncate(url, 600),
    name: truncate(name, 300),
    headerLabel: header.headerLabel,
    ministry: truncate(ministry, 200),
    state,
    tags: header.tags,
    detailsText: details,
    benefitsText: stripHeading(sections.benefits, 'Benefits'),
    eligibilityText: stripHeading(sections.eligibility, 'Eligibility'),
    exclusionsText: stripHeading(sections.exclusions, 'Exclusions'),
    documents: toBulletList(stripHeading(sections.documents, 'Documents Required')),
    applicationUrl: truncate(pickApplicationUrl(links, url), 600),
    category,
    scrapedAt: new Date().toISOString(),
  };
}

async function readHeader(
  page: Page,
  name: string,
): Promise<{ headerLabel: string; tags: string[] }> {
  const nodes = await page.evaluate(() => {
    const anchor =
      document.querySelector('#details') ??
      document.querySelector('#benefits') ??
      document.querySelector('#eligibility');
    if (!anchor) return [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const collected: string[] = [];
    let node = walker.nextNode();

    while (node) {
      const precedesAnchor =
        anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
      if (precedesAnchor) {
        const text = node.textContent?.trim();
        if (text && text.length > 1) collected.push(text);
      }
      node = walker.nextNode();
    }

    return collected;
  });

  const cleaned = nodes.map((node) => cleanText(node));
  const titleIndex = cleaned.lastIndexOf(name);

  if (titleIndex <= 0) {
    return { headerLabel: '', tags: [] };
  }

  return {
    headerLabel: cleaned[titleIndex - 1] ?? '',
    // Tag clouds are short labels; anything long is body copy that slipped in.
    tags: cleaned.slice(titleIndex + 1).filter((tag) => tag.length <= 60),
  };
}

async function readSections(page: Page) {
  const read = async (id: string): Promise<string> => {
    const locator = page.locator(`#${id}`).first();
    if ((await locator.count()) === 0) return '';
    try {
      return await locator.evaluate((element) => (element as HTMLElement).innerText ?? '');
    } catch {
      return '';
    }
  };

  return {
    details: await read('details'),
    benefits: await read('benefits'),
    eligibility: await read('eligibility'),
    exclusions: await read('exclusions'),
    documents: await read('documents-required'),
  };
}

async function readLinks(page: Page): Promise<{ application: string[]; sources: string[] }> {
  const collect = async (selector: string): Promise<string[]> => {
    if ((await page.locator(selector).count()) === 0) return [];
    return page.$$eval(selector, (anchors) =>
      anchors
        .map((anchor) => (anchor.getAttribute('href') ?? '').trim())
        .filter((href) => href.startsWith('http')),
    );
  };

  return {
    application: await collect('#application-process a[href^="http"]'),
    sources: await collect('#sources a[href^="http"]'),
  };
}

const APPLY_HINTS = /(apply|registration|register|application|form|enrol|online|portal|login)/i;
const DOCUMENT_LINK = /\.(pdf|docx?|xlsx?)(\?|$)/i;

/**
 * The portal's own "Apply Now" button sits behind a myScheme sign-in, so it is no
 * use to a citizen arriving from here. The next best thing is the department's own
 * application page, preferring links from the Application Process block and
 * skipping PDFs, which are guidelines rather than somewhere you can apply.
 *
 * Falls back to the myScheme page itself — an honest destination, since it lists
 * the real process — because `applicationUrl` is non-null in the schema.
 */
function pickApplicationUrl(
  links: { application: string[]; sources: string[] },
  pageUrl: string,
): string {
  const candidates = [...links.application, ...links.sources].filter(
    (href) => !DOCUMENT_LINK.test(href),
  );

  return candidates.find((href) => APPLY_HINTS.test(href)) ?? candidates[0] ?? pageUrl;
}

/**
 * Everything the normaliser is allowed to read. Exclusions are included because
 * they routinely carry hard criteria — PM-KISAN's income-tax-payer bar lives
 * there, not under Eligibility.
 */
export function eligibilityProse(scheme: RawScheme): string {
  const parts = [scheme.eligibilityText];
  if (scheme.exclusionsText) {
    parts.push(`Exclusions:\n${scheme.exclusionsText}`);
  }
  return parts.filter(Boolean).join('\n\n');
}
