"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "quiet" }) {
  const cls =
    variant === "primary"
      ? "bg-lichen text-ground hover:bg-lichen-strong hover:text-ground"
      : "border border-line-strong text-smoke hover:border-ash hover:text-smoke";
  return (
    <Link href={href} className={`inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold no-underline ${cls}`}>
      {children}
    </Link>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "quiet",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "quiet";
  disabled?: boolean;
}) {
  const cls =
    variant === "primary"
      ? "bg-lichen text-ground hover:bg-lichen-strong disabled:opacity-50"
      : "border border-line-strong text-smoke hover:border-ash disabled:opacity-50";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold ${cls}`}>
      {children}
    </button>
  );
}

/** Radio group styled as a segmented control. Arrow keys move between options natively. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel,
}: {
  label: string;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className={hideLabel ? "sr-only" : "field-label"}>{label}</legend>
      <div className="inline-flex flex-wrap rounded-[var(--radius-control)] border border-line-strong p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-[4px] px-3 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lichen ${
              value === o.value ? "bg-canopy text-smoke" : "text-ash hover:text-smoke"
            } ${o.disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Small explanatory tooltip. Works on hover, focus and tap, and is read by screen readers. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-describedby={id}
        aria-label={label}
        className="inline-flex size-5 items-center justify-center rounded-full border border-line-strong text-[11px] text-ash hover:text-smoke focus:text-smoke"
      >
        i
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute left-1/2 top-full z-[1200] mt-2 w-64 -translate-x-1/2 rounded-[var(--radius-control)] border border-line-strong bg-canopy p-3 text-xs leading-relaxed text-smoke opacity-0 shadow-lg group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

/** Native <dialog>: focus is trapped and Escape closes it, without extra libraries. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${title}-title`}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border border-line-strong bg-forest p-0 text-smoke backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <h2 id={`${title}-title`} className="text-xl">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="rounded px-2 text-ash hover:text-smoke" aria-label="Close dialog">
          ✕
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

export function SearchInput({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input id={id} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="field" />
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="field">
        {children}
      </select>
    </div>
  );
}
