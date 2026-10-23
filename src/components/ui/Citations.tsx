import type { Source } from "@/lib/content/schema";

const KIND_LABEL: Record<Source["kind"], string> = {
  official: "Official",
  intergovernmental: "Intergovernmental",
  scientific: "Research",
  ngo: "Organisation",
  journalism: "Journalism",
  reference: "Reference",
};

/** Superscript links to the numbered source list on the same page. */
export function Cite({ ids, sources, prefix = "src", page = "" }: { ids: readonly string[]; sources: readonly Source[]; prefix?: string; page?: string }) {
  const order = new Map(sources.map((s, i) => [s.id, i + 1]));
  return (
    <>
      {ids.map((id) => (
        <a key={id} href={`${page}#${prefix}-${id}`} className="cite" aria-label={`Source ${order.get(id) ?? id}`}>
          [{order.get(id) ?? id}]
        </a>
      ))}
    </>
  );
}

export function SourceList({ sources, prefix = "src", heading = "Sources" }: { sources: readonly Source[]; prefix?: string; heading?: string }) {
  return (
    <section aria-labelledby={`${prefix}-heading`} className="mt-12 border-t border-line pt-6">
      <h2 id={`${prefix}-heading`} className="text-xl">
        {heading}
      </h2>
      <ol className="mt-4 space-y-3 text-sm">
        {sources.map((s, i) => (
          <li key={s.id} id={`${prefix}-${s.id}`} className="grid grid-cols-[2rem_1fr] gap-2 scroll-mt-24">
            <span className="text-dim tabular-nums">{i + 1}.</span>
            <span>
              <a href={s.url} rel="noopener noreferrer" target="_blank">
                {s.title}
              </a>
              <span className="text-ash">
                {". "}
                {s.publisher}
                {s.publishedDate ? `, ${s.publishedDate}` : ""}. {KIND_LABEL[s.kind]}. Accessed {s.accessedDate}.
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
