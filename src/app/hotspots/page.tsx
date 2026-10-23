import type { Metadata } from "next";
import { Suspense } from "react";
import { HotspotExplorer } from "@/components/hotspots/HotspotExplorer";
import { LoadingBlock } from "@/components/ui/States";

export const metadata: Metadata = {
  title: "Fire hotspot explorer",
  description: "Satellite fire detections (VIIRS thermal anomalies from NASA FIRMS) across Southeast Asia for the last 24 hours to 7 days, with confidence and radiative power.",
  alternates: { canonical: "/hotspots" },
};

export default function HotspotsPage() {
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Fire hotspots</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Heat detected by satellites over the region. A detection shows where something was hot when a satellite passed, not what was burning
        or why.
      </p>
      <Suspense fallback={<LoadingBlock label="Loading the explorer" className="mt-8" />}>
        <HotspotExplorer />
      </Suspense>
    </div>
  );
}
