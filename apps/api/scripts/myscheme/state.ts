import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RawScheme } from './types';

export type ProgressStatus = 'inserted' | 'updated' | 'skipped_duplicate' | 'rejected' | 'failed';

export interface ProgressRecord {
  url: string;
  status: ProgressStatus;
  at: string;
  note?: string;
}

/**
 * Resumability, as an append-only log.
 *
 * A run over ~200 pages will be interrupted — a timeout, a rate limit, someone
 * closing the laptop. Appending one line per finished URL means progress survives a
 * hard kill with no flush step, and the file doubles as an audit trail of what the
 * scraper did and when. A rewritten JSON blob would lose everything on a crash
 * mid-write.
 *
 * `failed` is treated as retryable on the next run; the terminal statuses are not.
 */
export class ProgressLog {
  private readonly records = new Map<string, ProgressRecord>();

  private constructor(private readonly path: string) {}

  static async open(path: string, options: { force: boolean }): Promise<ProgressLog> {
    const log = new ProgressLog(path);
    await mkdir(dirname(path), { recursive: true });

    if (options.force) return log;

    const existing = await readFile(path, 'utf8').catch(() => '');
    for (const line of existing.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ProgressRecord;
        if (record.url) log.records.set(record.url, record);
      } catch {
        // A torn final line from an interrupted write is expected; skip it.
      }
    }

    return log;
  }

  /** True when this URL reached a terminal state on an earlier run. */
  isDone(url: string): boolean {
    const record = this.records.get(url);
    return record !== undefined && record.status !== 'failed';
  }

  processedUrls(): Set<string> {
    return new Set(
      [...this.records.entries()].filter(([, r]) => r.status !== 'failed').map(([url]) => url),
    );
  }

  countByStatus(status: ProgressStatus): number {
    return [...this.records.values()].filter((record) => record.status === status).length;
  }

  async record(url: string, status: ProgressStatus, note?: string): Promise<void> {
    const record: ProgressRecord = {
      url,
      status,
      at: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    this.records.set(url, record);
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

/**
 * Archive of raw scrapes, written before any interpretation happens, so that a
 * changed prompt or rule can be re-processed without hitting the portal again.
 *
 * Strictly append-only, and in particular *not* cleared by `--force`. It was
 * originally truncated on a forced run, which quietly destroyed the input that
 * `--from-archive` exists to read — the one file in here that cannot be regenerated
 * without going back to the portal. `readAll` keeps the last entry per URL, so a
 * re-scrape supersedes the older copy without needing the file emptied.
 */
export class RawArchive {
  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<RawArchive> {
    await mkdir(dirname(path), { recursive: true });
    return new RawArchive(path);
  }

  async append(scheme: RawScheme): Promise<void> {
    await appendFile(this.path, `${JSON.stringify(scheme)}\n`, 'utf8');
  }

  /**
   * Reads the archive back, most recent entry per URL winning, so a re-scrape of the
   * same scheme supersedes the older copy.
   */
  static async readAll(path: string): Promise<RawScheme[]> {
    const contents = await readFile(path, 'utf8').catch(() => '');
    const byUrl = new Map<string, RawScheme>();

    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      try {
        const scheme = JSON.parse(line) as RawScheme;
        if (scheme.sourceUrl) byUrl.set(scheme.sourceUrl, scheme);
      } catch {
        // Torn final line from an interrupted write.
      }
    }

    return [...byUrl.values()];
  }
}

/** Discovered URLs are cached so a resumed run does not re-walk the listing. */
export class UrlCache {
  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<UrlCache> {
    await mkdir(dirname(path), { recursive: true });
    return new UrlCache(path);
  }

  async read(): Promise<string[]> {
    const contents = await readFile(this.path, 'utf8').catch(() => '');
    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async write(urls: string[]): Promise<void> {
    await writeFile(this.path, `${urls.join('\n')}\n`, 'utf8');
  }
}
