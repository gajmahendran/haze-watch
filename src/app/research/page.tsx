import type { Metadata } from "next";
import { LibrarySearch } from "@/components/research/LibrarySearch";
import { Note } from "@/components/ui/States";
import { loadLibrary } from "@/lib/content/loader";

export const metadata: Metadata = {
  title: "Research and news library",
  description: "Searchable list of official announcements, ASEAN publications, research, datasets and journalism on Southeast Asian haze, each checked by hand.",
  alternates: { canonical: "/research" },
};

export default function ResearchPage() {
  const records = loadLibrary();
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Research and news library</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Official announcements, ASEAN publications, research, datasets and reporting on haze. Every link goes to the original.
      </p>
      <div className="mt-6 max-w-[62ch]">
        <Note>
          This is a curated list, checked by hand, not a live news feed. Summaries are our own paraphrases. Inclusion is not endorsement, and
          journalism is labelled as journalism.
        </Note>
      </div>
      <div className="mt-10">
        <LibrarySearch records={records} />
      </div>
    </div>
  );
}
