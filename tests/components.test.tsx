// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReadingStrip } from "@/components/readings/ReadingStrip";
import { BandBadge, FreshnessBadge } from "@/components/ui/Badge";
import { ChartTable } from "@/components/charts/TimeSeriesChart";
import type { Observation } from "@/lib/domain/schemas";
import { describeReading, observationForView } from "@/lib/ui/readings";

const base = {
  providerId: "p", stationId: "p:a", countryCode: "SG" as const, observedAtUtc: "2026-10-20T13:00:00.000Z",
  retrievedAtUtc: "2026-10-20T13:10:00.000Z", original: { value: 142, unit: null, timestamp: "2026-10-20T21:00:00+08:00", timezone: "+08:00" },
  quality: "unvalidated" as const, provenance: "provider" as const, sourceUrl: "https://x.test/",
};

afterEach(cleanup);

describe("reading presentation", () => {
  it("always names the scale and averaging period", () => {
    const psi: Observation = { ...base, kind: "index", indexId: "SG_PSI", value: 142, averagingPeriod: "PT24H", dominantPollutant: null };
    const d = describeReading(psi);
    expect(d.metricLabel).toBe("24-hour PSI");
    expect(d.scaleLabel).toBe("Singapore PSI");
    expect(d.band?.label).toBe("Unhealthy");

    const api: Observation = { ...psi, countryCode: "MY", indexId: "MY_API", averagingPeriod: "PT1H" } as Observation;
    expect(describeReading(api).scaleLabel).toBe("Malaysia API");
  });

  it("does not borrow Singapore's PM2.5 bands for another country", () => {
    const my: Observation = { ...base, countryCode: "MY", kind: "concentration", pollutant: "PM2.5", unit: "µg/m³", value: 200, averagingPeriod: "PT1H" };
    expect(describeReading(my).band).toBeNull();
  });

  it("keeps the PM2.5 views separate by averaging period", () => {
    const one: Observation = { ...base, kind: "concentration", pollutant: "PM2.5", unit: "µg/m³", value: 40, averagingPeriod: "PT1H" };
    const day: Observation = { ...one, value: 30, averagingPeriod: "PT24H" };
    expect(observationForView([one, day], "p:a", "pm25_1h")?.value).toBe(40);
    expect(observationForView([one, day], "p:a", "pm25_24h")?.value).toBe(30);
  });

  it("renders a reading strip with its scale and category in text, not colour alone", () => {
    render(<ReadingStrip value={142} scale={{ kind: "index", indexId: "SG_PSI" }} metricLabel="24-hour PSI" unitLabel="Singapore PSI" bandLabel="Unhealthy" />);
    expect(screen.getByText("142")).toBeInTheDocument();
    const caption = screen.getByText("Singapore PSI").closest("figcaption")!;
    expect(within(caption as HTMLElement).getByText("Unhealthy")).toBeInTheDocument();
    expect(within(caption as HTMLElement).getByText("24-hour PSI")).toBeInTheDocument();
  });

  it("badges carry words, not only colour", () => {
    render(
      <>
        <BandBadge level={3} label="Unhealthy" scaleName="Singapore PSI" />
        <FreshnessBadge state="stale" />
      </>,
    );
    expect(screen.getByText("Unhealthy")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("chart tables say 'No value' for gaps instead of zero", () => {
    render(<ChartTable zone="Asia/Singapore" unitLabel="µg/m³" caption="t" series={[{ id: "a", label: "A", points: [{ t: "2026-10-20T13:00:00.000Z", v: null }, { t: "2026-10-20T14:00:00.000Z", v: 0 }] }]} />);
    expect(screen.getByText("No value")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
