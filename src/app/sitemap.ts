import type { MetadataRoute } from "next";
import { loadEvents } from "@/lib/content/loader";
import { COUNTRIES } from "@/lib/domain/countries";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages = ["", "/live", "/history", "/hotspots", "/data", "/countries", "/research", "/learn", "/about"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: (p === "/live" || p === "/hotspots" ? "hourly" : "weekly") as "hourly" | "weekly",
  }));
  const events = loadEvents().map((e) => ({ url: `${base}/history/${e.slug}`, lastModified: e.lastReviewed, changeFrequency: "monthly" as const }));
  const countries = COUNTRIES.map((c) => ({ url: `${base}/countries/${c.slug}`, changeFrequency: "monthly" as const }));
  return [...pages, ...events, ...countries];
}
