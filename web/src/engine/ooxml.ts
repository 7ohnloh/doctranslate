/**
 * Reads and rewrites the text inside .docx and .pptx files, entirely in the browser.
 *
 * Both formats are zip files of XML. Text lives in runs (<w:r>/<a:r>) inside
 * paragraphs (<w:p>/<a:p>). A sentence is often split over several runs because
 * of formatting, so we translate a whole paragraph (up to a line break) at a time,
 * put the result in the first run and empty the rest. That keeps the paragraph's
 * main font, size and colour, where v1 reset everything to the default style.
 */
import JSZip from "jszip";

export type Kind = "docx" | "pptx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const MIME: Record<Kind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export interface Segment {
  /** Source text with surrounding whitespace removed; also the translation key. */
  key: string;
  leading: string;
  trailing: string;
  /** Where it appears, for the review screen, e.g. "Slide 3" or "Footer". */
  location: string;
  /** Sort order of `location`. */
  order: number;
  nodes: Element[];
}

export interface LoadedDocument {
  kind: Kind;
  fileName: string;
  size: number;
  segments: Segment[];
  zip: JSZip;
  parts: Map<string, Document>;
}

export class UnsupportedFileError extends Error {}

export function kindOf(fileName: string): Kind | null {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "docx" || ext === "pptx" ? ext : null;
}

// ------------------------------------------------------------------ parsing

const parser = () => new DOMParser();

async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  if (!file) return null;
  const doc = parser().parseFromString(await file.async("string"), "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

/** Relationship id → absolute part path, from a part's .rels file. */
async function readRels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const name = partPath.slice(partPath.lastIndexOf("/") + 1);
  const rels = await readXml(zip, `${dir}/_rels/${name}.rels`);
  const out = new Map<string, string>();
  if (!rels) return out;
  for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
    const target = rel.getAttribute("Target") ?? "";
    out.set(rel.getAttribute("Id") ?? "", resolvePath(dir, target));
  }
  return out;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Text-bearing parts in reading order, each with a human-readable location. */
async function textParts(zip: JSZip, kind: Kind): Promise<{ path: string; location: string }[]> {
  const files = Object.keys(zip.files);
  const out: { path: string; location: string }[] = [];

  if (kind === "docx") {
    const label = (p: string) =>
      /header/.test(p) ? "Header" : /footer/.test(p) ? "Footer" : /footnotes/.test(p) ? "Footnotes"
        : /endnotes/.test(p) ? "Endnotes" : /charts/.test(p) ? "Charts" : /diagrams/.test(p) ? "Diagrams" : "Document";
    const order = ["Document", "Diagrams", "Charts", "Header", "Footer", "Footnotes", "Endnotes"];
    files
      .filter((p) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p)
        || /^word\/(charts\/chart|diagrams\/(data|drawing))\d+\.xml$/.test(p))
      .forEach((p) => out.push({ path: p, location: label(p) }));
    return out.sort((a, b) => order.indexOf(a.location) - order.indexOf(b.location));
  }

  // PowerPoint: follow presentation.xml for the real slide order.
  const pres = await readXml(zip, "ppt/presentation.xml");
  const presRels = await readRels(zip, "ppt/presentation.xml");
  const slideIds = pres ? Array.from(pres.getElementsByTagNameNS("*", "sldId")) : [];
  const slides = slideIds
    .map((el) => presRels.get(el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? ""))
    .filter((p): p is string => !!p && !!zip.file(p));

  for (const [i, slide] of slides.entries()) {
    const location = `Slide ${i + 1}`;
    out.push({ path: slide, location });
    for (const target of (await readRels(zip, slide)).values()) {
      if (/\/(charts\/chart|diagrams\/(data|drawing))\d+\.xml$/.test(target)) out.push({ path: target, location });
    }
  }
  for (const [i, slide] of slides.entries()) {
    for (const target of (await readRels(zip, slide)).values()) {
      if (/notesSlides\/notesSlide\d+\.xml$/.test(target)) out.push({ path: target, location: `Notes · Slide ${i + 1}` });
    }
  }
  return out;
}

/** Split a paragraph's text nodes into groups at line breaks and tabs. */
function paragraphGroups(p: Element, ns: string): Element[][] {
  const groups: Element[][] = [[]];
  const breakTags = ns === W ? ["br", "cr", "tab"] : ["br"];
  const skipTags = ns === W ? ["pPr", "rPr", "del", "instrText", "delText", "p"] : ["pPr", "rPr", "fld", "p", "endParaRPr"];

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (child.namespaceURI === ns && skipTags.includes(child.localName)) continue;
      if (child.namespaceURI === ns && child.localName === "t") groups[groups.length - 1].push(child);
      else if (child.namespaceURI === ns && breakTags.includes(child.localName)) groups.push([]);
      else walk(child);
    }
  };
  walk(p);
  return groups.filter((g) => g.length);
}

const HAS_LETTERS = /\p{L}/u;

function extractSegments(doc: Document, location: string, order: number): Segment[] {
  const out: Segment[] = [];
  for (const ns of [W, A]) {
    for (const p of Array.from(doc.getElementsByTagNameNS(ns, "p"))) {
      for (const nodes of paragraphGroups(p, ns)) {
        const text = nodes.map((n) => n.textContent ?? "").join("").replace(/[\r\n]+/g, " ");
        const key = text.trim();
        if (!HAS_LETTERS.test(key)) continue; // numbers, bullets, punctuation
        const leading = text.slice(0, text.length - text.trimStart().length);
        const trailing = text.slice(text.trimEnd().length);
        out.push({ key, leading, trailing, location, order, nodes });
      }
    }
  }
  return out;
}

export async function loadDocument(file: File): Promise<LoadedDocument> {
  const kind = kindOf(file.name);
  if (!kind) throw new UnsupportedFileError("Only .docx and .pptx files are supported.");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new UnsupportedFileError("This file couldn't be opened. It may be damaged or password-protected.");
  }

  const parts = new Map<string, Document>();
  const segments: Segment[] = [];
  const located = await textParts(zip, kind);
  for (const [order, { path, location }] of located.entries()) {
    const doc = parts.get(path) ?? (await readXml(zip, path));
    if (!doc || parts.has(path)) continue;
    parts.set(path, doc);
    segments.push(...extractSegments(doc, location, order));
  }
  if (!parts.size) throw new UnsupportedFileError("This file doesn't look like a Word or PowerPoint document.");
  return { kind, fileName: file.name, size: file.size, segments, zip, parts };
}

// ------------------------------------------------------------------ writing

/**
 * Write translations into the document and return the new file.
 * Safe to call repeatedly (e.g. after edits on the review screen).
 */
export async function buildDocument(doc: LoadedDocument, translations: Map<string, string>): Promise<Blob> {
  const bytes = await buildDocumentBytes(doc, translations);
  return new Blob([bytes], { type: MIME[doc.kind] });
}

export async function buildDocumentBytes(doc: LoadedDocument, translations: Map<string, string>): Promise<Uint8Array> {
  for (const seg of doc.segments) {
    const value = translations.get(seg.key);
    if (value === undefined) continue;
    const [first, ...rest] = seg.nodes;
    first.textContent = seg.leading + value + seg.trailing;
    if (first.namespaceURI === W) first.setAttributeNS(XML_NS, "xml:space", "preserve");
    rest.forEach((n) => (n.textContent = ""));
  }

  const serializer = new XMLSerializer();
  for (const [path, xml] of doc.parts) {
    let text = serializer.serializeToString(xml);
    if (!text.startsWith("<?xml")) text = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + text;
    doc.zip.file(path, text);
  }
  return doc.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** "Q3 Report.pptx" + "ja" → "Q3 Report (ja).pptx" */
export function outputName(fileName: string, lang: string): string {
  const dot = fileName.lastIndexOf(".");
  return `${fileName.slice(0, dot)} (${lang})${fileName.slice(dot)}`;
}

/** Unique source strings in reading order, with how often each appears. */
export function uniqueTexts(doc: LoadedDocument): { key: string; count: number; location: string }[] {
  const map = new Map<string, { key: string; count: number; location: string }>();
  for (const s of doc.segments) {
    const entry = map.get(s.key);
    if (entry) entry.count++;
    else map.set(s.key, { key: s.key, count: 1, location: s.location });
  }
  return Array.from(map.values());
}
