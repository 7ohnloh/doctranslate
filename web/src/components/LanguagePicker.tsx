import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AUTO, LANGUAGES, SUGGESTED, languageName } from "../engine/languages";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "./icons";

interface Props {
  label: string;
  value: string | null;
  onChange: (code: string) => void;
  allowAuto?: boolean;
  disabled?: boolean;
  alignRight?: boolean;
}

type Row = { type: "group"; label: string } | { type: "option"; code: string };

/** A searchable select, following the ARIA combobox + listbox pattern. */
export function LanguagePicker({ label, value, onChange, allowAuto, disabled, alignRight }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return LANGUAGES.filter((l) => l.name.toLowerCase().includes(q) || l.code === q).map((l) => ({
        type: "option" as const,
        code: l.code,
      }));
    }
    const suggested = [...(allowAuto ? [AUTO] : []), ...SUGGESTED];
    return [
      { type: "group", label: "Suggested" },
      ...suggested.map((code) => ({ type: "option" as const, code })),
      { type: "group", label: "All languages" },
      ...LANGUAGES.map((l) => ({ type: "option" as const, code: l.code })),
    ];
  }, [query, allowAuto]);

  const options = rows.flatMap((r, i) => (r.type === "option" ? [i] : []));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${options[active]}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, options]);

  const openPicker = () => {
    // Start the keyboard highlight on the current value (options are in the unfiltered order).
    const suggested = [...(allowAuto ? [AUTO] : []), ...SUGGESTED];
    const inSuggested = value ? suggested.indexOf(value) : -1;
    const inAll = LANGUAGES.findIndex((l) => l.code === value);
    setQuery("");
    setActive(inSuggested >= 0 ? inSuggested : inAll >= 0 ? suggested.length + inAll : 0);
    setOpen(true);
  };

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[options[active]];
      if (row?.type === "option") choose(row.code);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div className="picker" ref={root}>
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span id={`${id}-value`} className={value ? "value" : "value placeholder"}>
          {value ? languageName(value) : "Choose a language"}
        </span>
        <ChevronDownIcon />
      </button>

      {open && (
        <div className={`picker-pop${alignRight ? " align-right" : ""}`}>
          <label className="picker-search">
            <SearchIcon />
            <span className="sr-only">Search languages</span>
            <input
              autoFocus
              value={query}
              placeholder="Search languages"
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={options.length ? `${id}-opt-${options[active]}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          {options.length === 0 ? (
            <div className="picker-empty">No languages match “{query}”.</div>
          ) : (
            <ul className="picker-list" role="listbox" id={`${id}-list`} ref={list} aria-label={label}>
              {rows.map((row, i) =>
                row.type === "group" ? (
                  <li key={`g-${row.label}`} className="picker-group" role="presentation">
                    {row.label}
                  </li>
                ) : (
                  <li
                    key={`${i}-${row.code}`}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={row.code === value}
                    className={`picker-option${options[active] === i ? " active" : ""}`}
                    onMouseEnter={() => setActive(options.indexOf(i))}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(row.code)}
                  >
                    <span className="check">{row.code === value && <CheckIcon />}</span>
                    {languageName(row.code)}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
