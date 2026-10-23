import type { Metadata } from "next";
import Link from "next/link";
import { DataExplorer } from "@/components/data/DataExplorer";

export const metadata: Metadata = {
  title: "Historical data explorer",
  description: "Chart, summarise, compare and download historical air quality readings for Singapore regions and Malaysia's national monthly means, with original values and metadata.",
  alternates: { canonical: "/data" },
};

export default function DataPage() {
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Historical data explorer</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Pick a source, a place and a measure. Missing readings stay missing: they are counted, shown as gaps and never filled in. Downloads keep
        the original values, timestamps and timezones. <Link href="/about#missing">How missing data is handled</Link>.
      </p>
      <DataExplorer />
    </div>
  );
}
