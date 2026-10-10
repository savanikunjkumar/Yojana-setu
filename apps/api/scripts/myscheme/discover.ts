import type { Page } from 'playwright';
import { MYSCHEME_ORIGIN, SEARCH_URL, type ScrapeConfig } from './config';

/**
 * Collects scheme URLs from the /search listing.
 *
 * The listing is a statically exported Next.js page that fetches results client
 * side: `?page=2` is ignored, nothing is server-rendered, and scrolling does not
 * load more. Pagination is a numbered `<li>` list which has to be clicked, so
 * discovery walks pages in order and stops as soon as it has enough URLs.
 *
 * Result ordering is not stable between requests, so the same scheme can appear
 * on two consecutive pages. Collecting into a Set makes that harmless, and the
 * yield-per-page is reported so a run that stops making progress is visible.
 */
export async function discoverSchemeUrls(
  page: Page,
  config: ScrapeConfig,
  options: { need: number; alreadyKnown: Set<string> },
): Promise<string[]> {
  const found = new Set<string>();

  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('a[href^="/schemes/"]', { timeout: 45_000 });

  for (let pageNumber = 1; pageNumber <= config.maxPages; pageNumber += 1) {
    await page.waitForTimeout(config.delayMs);

    const hrefs = await page.$$eval('a[href^="/schemes/"]', (anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href') ?? '').filter(Boolean),
    );

    const before = found.size;
    for (const href of hrefs) {
      const url = `${MYSCHEME_ORIGIN}${href}`;
      if (!options.alreadyKnown.has(url)) found.add(url);
    }

    const fresh = found.size - before;
    console.log(
      `  page ${pageNumber}: ${hrefs.length} links, ${fresh} new (${found.size}/${options.need} needed)`,
    );

    if (found.size >= options.need) break;

    const advanced = await goToNextPage(page, pageNumber + 1);
    if (!advanced) {
      console.log(`  no page ${pageNumber + 1} control found — ending discovery`);
      break;
    }
  }

  return [...found];
}

/**
 * Clicks the numbered pagination control. Anchored on the exact page number
 * inside the pagination list rather than a class name, because the listing's
 * Tailwind classes are generated and change between deploys.
 */
async function goToNextPage(page: Page, targetPage: number): Promise<boolean> {
  const firstLinkBefore = await currentFirstLink(page);

  const paginationItem = page
    .locator('ul.list-none li')
    .filter({ hasText: new RegExp(`^${targetPage}$`) })
    .last();

  if ((await paginationItem.count()) === 0) return false;

  try {
    await paginationItem.click({ timeout: 15_000 });
  } catch {
    return false;
  }

  // The list re-renders in place, so wait for the first result to actually change
  // rather than for a navigation that never happens.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(400);
    const now = await currentFirstLink(page);
    if (now && now !== firstLinkBefore) return true;
  }

  return false;
}

async function currentFirstLink(page: Page): Promise<string | null> {
  const links = await page.$$eval('a[href^="/schemes/"]', (anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
  );
  return links[0] ?? null;
}
