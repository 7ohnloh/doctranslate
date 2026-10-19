import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguagePicker } from "./components/LanguagePicker";
import { ReviewTable } from "./components/ReviewTable";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CloudIcon,
  DownloadIcon,
  GithubIcon,
  LaptopIcon,
  MoonIcon,
  ShieldIcon,
  SunIcon,
  SwapIcon,
  UploadIcon,
} from "./components/icons";
import { AUTO, languageName } from "./engine/languages";
import { buildDocument, kindOf, loadDocument, outputName, uniqueTexts } from "./engine/ooxml";
import type { LoadedDocument } from "./engine/ooxml";
import { translateAll } from "./engine/translate";

// Update after creating the GitHub repo.
const REPO_URL = "https://github.com/your-username/doctranslate";

type Phase = "upload" | "configure" | "translating" | "review";
type Notice = { tone: "error" | "warning" | "success"; title: string; body?: string } | null;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(store.get("from") ?? AUTO);
  const [to, setTo] = useState<string | null>(store.get("to"));
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [machine, setMachine] = useState(new Map<string, string>());
  const [failed, setFailed] = useState(new Set<string>());
  const [detected, setDetected] = useState<string | undefined>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [downloaded, setDownloaded] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const abort = useRef<AbortController | null>(null);

  const items = useMemo(() => (doc ? uniqueTexts(doc) : []), [doc]);
  const editCount = Object.keys(edits).length;

  useEffect(() => store.set("from", from), [from]);
  useEffect(() => {
    if (to) store.set("to", to);
  }, [to]);

  // A file dropped outside the drop zone would make the browser open it and leave the app.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  // Warn before leaving mid-translation or with edits that haven't been downloaded.
  useEffect(() => {
    const unsaved = phase === "translating" || (phase === "review" && (!downloaded || editCount > 0));
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase, downloaded, editCount]);

  // ---------------------------------------------------------------- actions
  const openFile = useCallback(async (file: File) => {
    setNotice(null);
    if (!kindOf(file.name)) {
      const legacy = /\.(doc|ppt)$/i.test(file.name);
      setNotice({
        tone: "error",
        title: "That file type isn't supported",
        body: legacy
          ? "Older .doc and .ppt files need to be saved as .docx or .pptx first (File → Save As in Office)."
          : "Choose a Word (.docx) or PowerPoint (.pptx) file.",
      });
      return;
    }
    setLoading(true);
    try {
      const loaded = await loadDocument(file);
      if (!loaded.segments.length) {
        setNotice({ tone: "warning", title: "No text to translate", body: "This file doesn't contain any text we can translate." });
        return;
      }
      setDoc(loaded);
      setPhase("configure");
    } catch (err) {
      setNotice({ tone: "error", title: "This file couldn't be opened", body: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = () => {
    const unsaved = phase === "review" && (editCount > 0 || !downloaded);
    if (unsaved && !window.confirm("Leave without downloading? Your translation will be lost.")) return;
    abort.current?.abort();
    setDoc(null);
    setEdits({});
    setNotice(null);
    setPhase("upload");
  };

  const start = async () => {
    if (!doc || !to) return;
    const controller = new AbortController();
    abort.current = controller;
    setNotice(null);
    setEdits({});
    setDownloaded(false);
    setProgress({ done: 0, total: items.length });
    setPhase("translating");
    try {
      const result = await translateAll(
        items.map((i) => i.key),
        { from, to, signal: controller.signal, onProgress: setProgress },
      );
      setMachine(result.translations);
      setFailed(new Set(result.failed));
      setDetected(result.detectedSource);
      setPhase("review");
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase("configure");
        return;
      }
      setNotice({ tone: "error", title: "Translation service unavailable", body: (err as Error).message });
      setPhase("configure");
    }
  };

  const download = async () => {
    if (!doc || !to) return;
    const final = new Map(machine);
    for (const [k, v] of Object.entries(edits)) final.set(k, v);
    const blob = await buildDocument(doc, final);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputName(doc.fileName, to);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
    setNotice({ tone: "success", title: `Downloaded ${a.download}`, body: "Check your browser's downloads." });
  };

  const translateAgain = () => {
    if (editCount && !window.confirm(`Discard your ${editCount} edit${editCount > 1 ? "s" : ""}?`)) return;
    setEdits({});
    setNotice(null);
    setPhase("configure");
  };

  const swap = () => {
    if (from === AUTO || !to) return;
    setFrom(to);
    setTo(from);
  };

  // ------------------------------------------------------------------ views
  const missing = !to ? "Choose a language to translate into." : from === to ? "Pick two different languages." : null;

  return (
    <div className="page">
      <Header onHome={phase === "translating" ? undefined : reset} />
      <main>
        {phase === "upload" && (
          <div className="container">
            <section className="hero">
              <span className="eyebrow">
                <ShieldIcon /> Your file never leaves your device
              </span>
              <h1>Translate Word and PowerPoint files, layout intact.</h1>
              <p>Drop in a document, pick a language, review the result and download it. No sign-up, nothing stored.</p>
            </section>
            {notice && <Banner notice={notice} onDismiss={() => setNotice(null)} />}
            <DropZone onFile={openFile} loading={loading} />
            <HowItWorks />
          </div>
        )}

        {(phase === "configure" || phase === "translating") && doc && (
          <div className="container">
            <h1 className="sr-only">Translate {doc.fileName}</h1>
            {notice && <Banner notice={notice} onDismiss={() => setNotice(null)} />}
            <div className="card">
              <div className="card-section">
                <h2 className="section-label">
                  <span className="step">1</span> Document
                </h2>
                <FileCard doc={doc} onChange={reset} disabled={phase === "translating"} />
              </div>
              <div className="card-section">
                <h2 className="section-label">
                  <span className="step">2</span> Languages
                </h2>
                <div className="lang-row">
                  <LanguagePicker label="From" value={from} onChange={setFrom} allowAuto disabled={phase === "translating"} />
                  <button
                    type="button"
                    className="btn ghost swap"
                    onClick={swap}
                    disabled={from === AUTO || !to || phase === "translating"}
                    aria-label="Swap languages"
                    title={from === AUTO ? "Choose a source language to swap" : "Swap languages"}
                  >
                    <SwapIcon />
                  </button>
                  <LanguagePicker label="To" value={to} onChange={setTo} disabled={phase === "translating"} alignRight />
                </div>
              </div>
            </div>

            <div className="action-bar">
              {phase === "translating" ? (
                <Progress done={progress.done} total={progress.total} target={languageName(to!)} onCancel={() => abort.current?.abort()} />
              ) : (
                <>
                  <button type="button" className="btn primary lg block" disabled={!!missing} onClick={start}>
                    Translate {doc.kind === "docx" ? "document" : "presentation"}
                  </button>
                  <p className="hint">
                    {missing ?? `${from === AUTO ? "Any language" : languageName(from)} → ${languageName(to!)} · ${items.length} text blocks`}
                  </p>
                </>
              )}
            </div>
            <HowItWorks />
          </div>
        )}

        {phase === "review" && doc && to && (
          <div className="container wide">
            <div className="review-head">
              <div>
                <button type="button" className="btn ghost sm" onClick={translateAgain} style={{ marginLeft: -10 }}>
                  <ArrowLeftIcon /> Change languages
                </button>
                <h1>Review translation</h1>
                <div className="muted">
                  {doc.fileName} · {from === AUTO && detected ? `${languageName(detected)} (detected)` : languageName(from)} →{" "}
                  {languageName(to)}
                </div>
              </div>
            </div>
            {notice && <Banner notice={notice} onDismiss={() => setNotice(null)} />}
            {failed.size > 0 && !notice && (
              <Banner
                notice={{
                  tone: "warning",
                  title: `${failed.size} text block${failed.size > 1 ? "s" : ""} couldn't be translated`,
                  body: "They're highlighted below and will keep their original text. You can type a translation yourself.",
                }}
              />
            )}
            <ReviewTable
              items={items}
              machine={machine}
              edits={edits}
              failed={failed}
              sourceLabel={from === AUTO && detected ? languageName(detected) : languageName(from)}
              targetLabel={languageName(to)}
              onEdit={(key, value) =>
                setEdits((prev) => {
                  const next = { ...prev };
                  if (value === null) delete next[key];
                  else next[key] = value;
                  return next;
                })
              }
            />
            <div className="download-bar">
              <div className="card">
                <div className="summary">
                  <strong>{outputName(doc.fileName, to)}</strong>
                  <div className="muted">
                    {items.length} text blocks{editCount ? ` · ${editCount} edited by you` : ""}
                  </div>
                </div>
                <button type="button" className="btn ghost" onClick={reset}>
                  Translate another file
                </button>
                <button type="button" className="btn primary lg" onClick={download}>
                  <DownloadIcon /> Download
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>DocTranslate · translations by Google Translate</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------- components

function Header({ onHome }: { onHome?: () => void }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    setTheme(next);
  };
  return (
    <header className="site-header">
      <div className="container">
        <button type="button" className="brand" onClick={onHome} disabled={!onHome} aria-label="DocTranslate home">
          <img src="./favicon.svg" alt="" />
          DocTranslate
        </button>
        <nav className="header-nav">
          <a href="#how-it-works">
            <ShieldIcon />
            <span className="label">Privacy</span>
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            <GithubIcon />
            <span className="label">GitHub</span>
          </a>
          <button type="button" className="icon-button" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </nav>
      </div>
    </header>
  );
}

function DropZone({ onFile, loading }: { onFile: (f: File) => void; loading: boolean }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  // Accept drops anywhere on the page, not only on the box.
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth.current++;
      setDragging(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);

  return (
    <label className={`dropzone${dragging ? " dragging" : ""}`}>
      <input
        type="file"
        className="sr-only"
        accept=".docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <span className="dropzone-icon">
        <UploadIcon />
      </span>
      {loading ? (
        <strong>Reading file…</strong>
      ) : dragging ? (
        <strong>Drop to open</strong>
      ) : (
        <>
          <strong>Drop a file here</strong>
          <span className="muted">
            or <span className="link">browse your computer</span>
          </span>
        </>
      )}
      <span className="file-types">
        <span className="pill">.docx</span>
        <span className="pill">.pptx</span>
      </span>
    </label>
  );
}

function FileCard({ doc, onChange, disabled }: { doc: LoadedDocument; onChange: () => void; disabled: boolean }) {
  const slides = new Set(doc.segments.map((s) => s.location).filter((l) => l.startsWith("Slide"))).size;
  const blocks = uniqueTexts(doc).length;
  return (
    <div className="file-row">
      <span className={`badge ${doc.kind}`} aria-hidden>
        {doc.kind.toUpperCase()}
      </span>
      <div className="file-info">
        <div className="file-name" title={doc.fileName}>
          {doc.fileName}
        </div>
        <div className="file-meta">
          {blocks} text blocks{doc.kind === "pptx" ? ` · ${slides} slides` : ""} · {humanSize(doc.size)}
        </div>
      </div>
      <button type="button" className="btn sm" onClick={onChange} disabled={disabled}>
        Change file
      </button>
    </div>
  );
}

function Progress({ done, total, target, onCancel }: { done: number; total: number; target: string; onCancel: () => void }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="card card-section" role="status" aria-live="polite">
      <div className="progress-head">
        <strong>
          Translating into {target}… {done} of {total}
        </strong>
        <span className="muted">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <div className="progress-foot">
        <span className="muted">Keep this tab open. Your file is being processed in this browser.</span>
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Banner({ notice, onDismiss }: { notice: NonNullable<Notice>; onDismiss?: () => void }) {
  const Icon = notice.tone === "success" ? CheckCircleIcon : AlertIcon;
  return (
    <div className={`banner ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <Icon />
      <div>
        <div className="banner-title">{notice.title}</div>
        {notice.body && <div className="banner-body">{notice.body}</div>}
      </div>
      <span className="spacer" />
      {onDismiss && (
        <button type="button" className="text-button" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="how" id="how-it-works">
      <h2>How your file stays private</h2>
      <p>There's no server and no database. Only the text goes out, and only to Google Translate.</p>
      <div className="how-steps">
        <div className="card how-step">
          <span className="where local">
            <LaptopIcon /> In your browser
          </span>
          <h3>1. Opened locally</h3>
          <p>The file is unzipped and read right here. It's never uploaded anywhere.</p>
        </div>
        <div className="card how-step">
          <span className="where remote">
            <CloudIcon /> Google Translate
          </span>
          <h3>2. Text is translated</h3>
          <p>Only the text blocks are sent to Google Translate. Images and file data stay put.</p>
        </div>
        <div className="card how-step">
          <span className="where local">
            <LaptopIcon /> In your browser
          </span>
          <h3>3. Rebuilt and downloaded</h3>
          <p>The translated file is put back together on your device. Close the tab and it's gone.</p>
        </div>
      </div>
    </section>
  );
}
