import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TextareaHTMLAttributes } from "react";
import { SearchIcon } from "./icons";

export interface ReviewItem {
  key: string;
  count: number;
  location: string;
}

interface Props {
  items: ReviewItem[];
  machine: Map<string, string>;
  edits: Record<string, string>;
  failed: Set<string>;
  onEdit: (key: string, value: string | null) => void;
  sourceLabel: string;
  targetLabel: string;
}

type Filter = "all" | "edited" | "failed";

/** Grows with its content (CSS field-sizing isn't in Safari/Firefox yet). */
function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

export function ReviewTable({ items, machine, edits, failed, onEdit, sourceLabel, targetLabel }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const valueOf = (key: string) => edits[key] ?? machine.get(key) ?? key;
  const editedCount = Object.keys(edits).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "edited" && !(item.key in edits)) return false;
      if (filter === "failed" && !failed.has(item.key)) return false;
      if (!q) return true;
      const target = (edits[item.key] ?? machine.get(item.key) ?? "").toLowerCase();
      return item.key.toLowerCase().includes(q) || target.includes(q);
    });
  }, [items, query, filter, edits, machine, failed]);

  const groups = useMemo(() => {
    const out: { location: string; items: ReviewItem[] }[] = [];
    for (const item of visible) {
      const last = out[out.length - 1];
      if (last?.location === item.location) last.items.push(item);
      else out.push({ location: item.location, items: [item] });
    }
    return out;
  }, [visible]);

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All", count: items.length },
    { id: "edited", label: "Edited", count: editedCount },
  ];
  if (failed.size) filters.push({ id: "failed", label: "Not translated", count: failed.size });

  return (
    <div className="card">
      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <span className="sr-only">Search text</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search original or translation" />
        </label>
        <div className="segmented" role="group" aria-label="Filter">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="count">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="review-columns" aria-hidden>
        <span>Original · {sourceLabel}</span>
        <span>Translation · {targetLabel}</span>
      </div>

      {groups.length === 0 && (
        <div className="review-empty">
          {filter === "edited" && !query ? "You haven't edited anything yet." : "Nothing matches your search."}
        </div>
      )}

      {groups.map((group, gi) => (
        <section key={`${group.location}-${gi}`} aria-label={group.location}>
          <div className="review-group">{group.location}</div>
          {group.items.map((item) => {
            const edited = item.key in edits;
            const notTranslated = failed.has(item.key) && !edited;
            return (
              <div key={item.key} className={`review-row${notTranslated ? " failed" : ""}`}>
                <div>
                  <div className="source-text">{item.key}</div>
                  {item.count > 1 && (
                    <div className="source-meta">
                      <span className="pill" title="Editing this changes every occurrence">
                        Appears {item.count}×
                      </span>
                    </div>
                  )}
                </div>
                <div className="target-cell">
                  <AutoTextarea
                    rows={1}
                    aria-label={`Translation of: ${item.key}`}
                    value={valueOf(item.key)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onEdit(item.key, v === (machine.get(item.key) ?? item.key) ? null : v);
                    }}
                  />
                  {(edited || notTranslated) && (
                    <div className="target-meta">
                      {edited && <span className="pill edited">Edited</span>}
                      {edited && (
                        <button type="button" className="text-button" onClick={() => onEdit(item.key, null)}>
                          Undo
                        </button>
                      )}
                      {notTranslated && <span className="pill warn">Couldn't translate — kept original</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
