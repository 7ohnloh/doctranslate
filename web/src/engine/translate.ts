/**
 * Google Translate client that runs in the browser.
 *
 * Uses the same public endpoint as the `googletrans` Python library in v1. It
 * allows cross-origin requests, so there is no server of ours in between: only
 * the text goes to Google, never the file.
 *
 * Segments are sent in newline-joined batches to cut the number of requests
 * (v1 made two requests per paragraph). If a batch comes back with a different
 * number of lines, its segments are retried one at a time.
 */

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_BATCH_ITEMS = 40;
const MAX_BATCH_CHARS = 3500;
const CONCURRENCY = 3;

export class TranslationServiceError extends Error {}

export interface TranslateProgress {
  done: number;
  total: number;
}

export interface TranslateResult {
  translations: Map<string, string>;
  /** Source strings that couldn't be translated and were left as they were. */
  failed: string[];
  detectedSource?: string;
}

type Fetch = typeof fetch;

async function request(text: string, from: string, to: string, signal: AbortSignal, fetchImpl: Fetch) {
  const url = `${ENDPOINT}?client=gtx&dt=t&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ q: text }),
        signal,
      });
      if (!res.ok) throw new TranslationServiceError(`Translation service returned ${res.status}`);
      const data = await res.json();
      const translated = (data[0] as [string | null][]).map((chunk) => chunk[0] ?? "").join("");
      return { text: translated, detected: typeof data[2] === "string" ? data[2] : undefined };
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt)); // 0.6s, 1.2s, 2.4s
    }
  }
  throw new TranslationServiceError(
    lastError instanceof Error ? lastError.message : "Couldn't reach the translation service",
  );
}

function makeBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const t of texts) {
    if (current.length && (current.length >= MAX_BATCH_ITEMS || chars + t.length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(t);
    chars += t.length + 1;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function translateAll(
  texts: string[],
  options: {
    from: string;
    to: string;
    signal: AbortSignal;
    onProgress?: (p: TranslateProgress) => void;
    fetchImpl?: Fetch;
  },
): Promise<TranslateResult> {
  const { from, to, signal, onProgress } = options;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const translations = new Map<string, string>();
  const failed: string[] = [];
  let detectedSource: string | undefined;
  let done = 0;
  let consecutiveFailures = 0;

  const batches = makeBatches(texts);
  onProgress?.({ done: 0, total: texts.length });

  const runOne = async (text: string) => {
    try {
      const r = await request(text, from, to, signal, fetchImpl);
      translations.set(text, r.text.trim());
      detectedSource ??= r.detected;
      consecutiveFailures = 0;
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push(text);
      // The service is down or blocking us, not a one-off: stop early.
      if (++consecutiveFailures >= 3 && translations.size === 0) {
        throw new TranslationServiceError(
          "Couldn't reach the translation service. Check your internet connection and try again.",
        );
      }
    }
  };

  const runBatch = async (batch: string[]) => {
    let lines: string[] | null = null;
    try {
      const r = await request(batch.join("\n"), from, to, signal, fetchImpl);
      detectedSource ??= r.detected;
      lines = r.text.split("\n");
    } catch (err) {
      if (signal.aborted) throw err;
    }
    if (lines && lines.length === batch.length) {
      batch.forEach((t, i) => translations.set(t, lines![i].trim()));
      consecutiveFailures = 0;
    } else {
      for (const t of batch) await runOne(t);
    }
    done += batch.length;
    onProgress?.({ done, total: texts.length });
  };

  // Simple worker pool.
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      signal.throwIfAborted();
      await runBatch(batches[next++]);
    }
  });
  await Promise.all(workers);
  return { translations, failed, detectedSource };
}
