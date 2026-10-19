// @vitest-environment jsdom
import { File as NodeFile } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentBytes, loadDocument, outputName, uniqueTexts } from "./ooxml";
import { translateAll } from "./translate";

const sample = (name: string) => {
  const buf = readFileSync(resolve(__dirname, "../../../samples", name));
  return new NodeFile([buf], name) as unknown as File; // jsdom's File lacks arrayBuffer()
};

/** Pretends to be Google: prefixes every line with the target language. */
const fakeFetch = (calls: string[] = []) =>
  (async (url: string, init: RequestInit) => {
    const q = new URLSearchParams(init.body as URLSearchParams).get("q")!;
    calls.push(q);
    const tl = new URL(url).searchParams.get("tl");
    const out = q.split("\n").map((l) => `[${tl}] ${l}`).join("\n");
    return new Response(JSON.stringify([[[out, q]], null, "en"]));
  }) as unknown as typeof fetch;

async function translateFile(name: string, calls: string[] = []) {
  const doc = await loadDocument(sample(name));
  const texts = uniqueTexts(doc).map((t) => t.key);
  const result = await translateAll(texts, {
    from: "auto", to: "ja", signal: new AbortController().signal, fetchImpl: fakeFetch(calls),
  });
  const bytes = await buildDocumentBytes(doc, result.translations);
  const out = new NodeFile([bytes], outputName(name, "ja")) as unknown as File;
  // Saved so the output can be opened in Office by hand; the folder is git-ignored.
  const outDir = resolve(__dirname, "../../test-output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, out.name), bytes);
  return { doc, result, reloaded: await loadDocument(out) };
}

describe("docx", () => {
  it("finds paragraphs, splits at breaks and tabs, skips numbers, merges duplicates", async () => {
    const doc = await loadDocument(sample("sample.docx"));
    const keys = doc.segments.map((s) => s.key);
    expect(keys).toContain("Revenue grew this quarter.");
    expect(keys).toContain("First line");
    expect(keys).toContain("Second line after a break");
    expect(keys).toContain("Name:");
    expect(keys).toContain("John Tan");
    expect(keys).not.toContain("2025");
    expect(keys).toContain("Confidential draft");
    expect(doc.segments.find((s) => s.key === "Internal use only")?.location).toBe("Footer");
    expect(uniqueTexts(doc).find((t) => t.key === "Thank you")?.count).toBe(2);
  });

  it("writes translations back and keeps whitespace", async () => {
    const { reloaded } = await translateFile("sample.docx");
    const keys = reloaded.segments.map((s) => s.key);
    expect(keys).toContain("[ja] Revenue grew this quarter.");
    expect(keys).toContain("[ja] All regions on track");
    expect(keys).toContain("[ja] Internal use only");
    expect(keys.every((k) => k.startsWith("[ja]"))).toBe(true);
  });
});

describe("pptx", () => {
  it("follows presentation order and includes tables, groups and notes", async () => {
    const doc = await loadDocument(sample("sample.pptx"));
    const at = (k: string) => doc.segments.find((s) => s.key === k)?.location;
    expect(at("Thank you")).toBe("Slide 1"); // moved to the front in the sample
    expect(at("Welcome to the team")).toBe("Slide 2");
    expect(at("Customer growth")).toBe("Slide 3");
    expect(at("Grouped note")).toBe("Slide 3");
    expect(at("Remember to introduce yourself first.")).toBe("Notes · Slide 2");
    expect(doc.segments.map((s) => s.key)).not.toContain("12%");
  });

  it("round-trips with batched requests", async () => {
    const calls: string[] = [];
    const { reloaded, result } = await translateFile("sample.pptx", calls);
    expect(calls.length).toBe(1); // every segment fits in one batch
    expect(result.failed).toEqual([]);
    expect(reloaded.segments.every((s) => s.key.startsWith("[ja]"))).toBe(true);
  });
});

describe("translateAll", () => {
  it("falls back to one-by-one when a batch loses lines", async () => {
    const calls: string[] = [];
    const lossy = (async (_url: string, init: RequestInit) => {
      const q = new URLSearchParams(init.body as URLSearchParams).get("q")!;
      calls.push(q);
      const out = q.includes("\n") ? "merged into one line" : `T:${q}`;
      return new Response(JSON.stringify([[[out, q]], null, "en"]));
    }) as unknown as typeof fetch;
    const r = await translateAll(["a", "b", "c"], { from: "en", to: "ja", signal: new AbortController().signal, fetchImpl: lossy });
    expect(Object.fromEntries(r.translations)).toEqual({ a: "T:a", b: "T:b", c: "T:c" });
    expect(calls.length).toBe(4);
  });

  it("stops early when the service is unreachable", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(
      translateAll(["a", "b", "c", "d"], { from: "en", to: "ja", signal: new AbortController().signal, fetchImpl: down }),
    ).rejects.toThrow(/Couldn't reach/);
  }, 30_000);
});
