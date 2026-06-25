"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ComboboxProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /** Forwarded to the underlying input (RHF blur tracking). */
  onBlur?: () => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** When true (default), the typed text is kept even if it is not an option. */
  allowCustomValue?: boolean;
  clearLabel?: string;
  noResultsLabel?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Lightweight searchable combobox built on the existing Input styling — no
 * external dependency. Behaves like a country selector: type to filter, click
 * to select, and (when `allowCustomValue`) keep a custom typed value.
 *
 * Display strategy: the input text is the source of truth. When freshly opened
 * (focus/click) the full list shows so the user can browse; once they type, the
 * list filters by the query.
 */
export function Combobox({
  options,
  value,
  onChange,
  onBlur,
  id,
  placeholder,
  disabled,
  allowCustomValue = true,
  clearLabel,
  noResultsLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: ComboboxProps) {
  const [query, setQuery] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = id ? `${id}-listbox` : undefined;

  // Keep the displayed text in sync when the value changes from the outside
  // (e.g. model reset after the make changes, or edit-form prefill). This is
  // React's recommended "adjust state during render" pattern — no effect.
  const [prevValue, setPrevValue] = React.useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setQuery(value);
  }

  // Only filter once the user has typed; a fresh open browses the whole list.
  const filtered = React.useMemo(() => {
    if (!typed || !query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query, typed]);

  // Close on outside interaction.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function commit(next: string) {
    onChange(next);
    setQuery(next);
    setTyped(false);
    setOpen(false);
    setHighlight(-1);
  }

  function handleInput(next: string) {
    setQuery(next);
    setTyped(true);
    setOpen(true);
    setHighlight(-1);
    if (allowCustomValue) onChange(next);
  }

  function handleBlur() {
    // Without custom values, an unmatched query reverts to the committed value.
    if (!allowCustomValue) {
      const match = options.find((o) => o.toLowerCase() === query.toLowerCase());
      if (match) onChange(match);
      else setQuery(value);
    }
    onBlur?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && highlight < filtered.length) {
        e.preventDefault();
        commit(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  }

  const showClear = Boolean(value) && !disabled;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setTyped(false);
        }}
        onClick={() => {
          setOpen(true);
          setTyped(false);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 pe-9 text-sm text-ink",
          "placeholder:text-ink-3",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />

      {showClear ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          tabIndex={-1}
          onClick={() => {
            commit("");
            inputRef.current?.focus();
            setOpen(true);
          }}
          className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-ink-3 hover:text-ink"
        >
          <svg
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l8 8M14 6l-8 8" />
          </svg>
        </button>
      ) : null}

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain",
            "rounded-xl border border-line bg-surface py-1 cockpit-lift",
          )}
        >
          {filtered.length > 0 ? (
            filtered.map((option, i) => (
              <li key={option} role="option" aria-selected={option === value}>
                <button
                  type="button"
                  // Select on click, not pointerdown: touch-scrolling the list
                  // starts with a pointerdown on an option, which previously
                  // selected + closed it. Blur does not close the list, so a
                  // genuine tap (click) still lands. preventDefault on mousedown
                  // keeps input focus without blocking touch scroll.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(option)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "block w-full truncate px-3 py-2 text-start text-sm",
                    i === highlight ? "bg-surface-2" : "hover:bg-surface-2",
                    option === value ? "font-medium text-accent" : "",
                  )}
                >
                  {option}
                </button>
              </li>
            ))
          ) : (
            <li
              role="presentation"
              className="px-3 py-2 text-sm text-ink-2"
            >
              {noResultsLabel}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
