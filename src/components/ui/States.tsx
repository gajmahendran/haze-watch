import type { ReactNode } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[var(--radius-control)] bg-moss/60 ${className}`} />;
}

export function LoadingBlock({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div role="status" className={`space-y-3 ${className}`}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-line-strong px-5 py-6">
      <p className="font-display text-lg">{title}</p>
      {children ? <div className="mt-1.5 text-sm text-ash measure">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-panel)] border border-error/50 bg-error/5 px-5 py-4">
      <p className="font-semibold text-error">{title}</p>
      {children ? <div className="mt-1 text-sm text-smoke/90 measure">{children}</div> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-[var(--radius-control)] border border-line-strong px-3 py-1.5 text-sm hover:border-ash">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Inline note for limitations and caveats. Sits in the reading flow, not in a box. */
export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "demo" }) {
  const bar = tone === "warn" ? "border-warn" : tone === "demo" ? "border-demo" : "border-line-strong";
  return <div className={`border-l-2 ${bar} pl-3 text-sm text-ash measure`}>{children}</div>;
}
