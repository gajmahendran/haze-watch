import type { Metadata } from "next";
import Link from "next/link";
import { PsiBandDays } from "@/components/history/PsiBandDays";
import { TimelineExplorer } from "@/components/history/TimelineExplorer";
import { Note } from "@/components/ui/States";
import { loadEvents } from "@/lib/content/loader";

export const metadata: Metadata = {
  title: "Historical haze timeline, 1997 to 2026",
  description:
    "Sourced record of Southeast Asian haze episodes from the 1997 El Niño haze to the 2026 season, with readings, impacts, responses and citations.",
  alternates: { canonical: "/history" },
};

export default function HistoryPage() {
  const events = loadEvents();
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Historical haze</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Every episode page cites the sources it rests on and lists what could not be verified. Readings keep the exact name and averaging
        period their source used.
      </p>
      <div className="mt-6 max-w-[62ch]">
        <Note>
          This list began as a research agenda. Inclusion does not mean a year was a regional crisis: 2024, for example, is listed because we
          checked it, and the sources we found do not show a major southern episode. <Link href="/about#methodology">How episodes are rated</Link>.
        </Note>
      </div>
      <section aria-labelledby="bands-heading" className="mt-12">
        <h2 id="bands-heading" className="text-2xl md:text-3xl">
          Singapore since 2014: days in each PSI band
        </h2>
        <p className="mt-2 max-w-[62ch] text-ash">
          Counted from NEA&apos;s hourly archive of regional 24-hour PSI. It shows how the episodes below register in one long, consistent
          record.
        </p>
        <div className="mt-6">
          <PsiBandDays />
        </div>
      </section>
      <h2 className="mt-16 text-2xl md:text-3xl">Episodes</h2>
      <div className="mt-6">
        <TimelineExplorer events={events} />
      </div>
    </div>
  );
}
