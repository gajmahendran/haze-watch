import type { Metadata } from "next";
import Link from "next/link";
import { LiveDashboard } from "@/components/live/LiveDashboard";

export const metadata: Metadata = {
  title: "Live air quality",
  description:
    "Latest official air quality readings in Southeast Asia, shown on each country's own index or as PM2.5 concentrations, with source, time and freshness for every value.",
  alternates: { canonical: "/live" },
};

export default function LivePage() {
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Live air quality</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        The latest readings from official sources, each on its own scale. Values are as published, never converted between
        national indices. Sources update on their own schedules, so every reading carries its time and a freshness check.{" "}
        <Link href="/learn#index-meanings">What the numbers mean</Link>.
      </p>
      <LiveDashboard />
    </div>
  );
}
