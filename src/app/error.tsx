"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="wrap py-20">
      <h1 className="text-3xl">Something on this page failed</h1>
      <p className="mt-4 text-ash measure">
        The page could not be displayed. No data is shown in its place. You can try again, or go back to the home page.
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </p>
      <button type="button" onClick={reset} className="mt-6 rounded-[var(--radius-control)] border border-line-strong px-4 py-2 text-sm">
        Try again
      </button>
    </div>
  );
}
