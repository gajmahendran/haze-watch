import { z } from "zod";
import { COUNTRY_CODES } from "../domain/countries";

/**
 * Editorial content schemas.
 *
 * Content lives in JSON files under /content so new events, countries and library records can be
 * added without touching application code. These schemas are enforced at build time: a file that
 * fails validation fails the build, which is the point.
 *
 * Core rule: every factual claim carries `sourceIds`, and every id must resolve to an entry in the
 * same file's `sources` list. Nothing is allowed to float free of a citation.
 */

const countryCode = z.enum(COUNTRY_CODES);

/** YYYY, YYYY-MM or YYYY-MM-DD. */
export const partialDateSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD");

/** A date, or a date-time, as printed in a historical record. */
const observedAtSchema = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/, "Use an ISO date or date-time");

export const sourceKindSchema = z.enum([
  "official",
  "intergovernmental",
  "scientific",
  "ngo",
  "journalism",
  "reference",
]);

export const sourceSchema = z.object({
  id: z.string().regex(/^s\d{1,3}$/, "Source ids look like s1, s2, ..."),
  title: z.string().min(3).max(300),
  publisher: z.string().min(2).max(200),
  url: z.url(),
  publishedDate: partialDateSchema.nullable(),
  accessedDate: z.iso.date(),
  kind: sourceKindSchema,
});
export type Source = z.infer<typeof sourceSchema>;

export const claimSchema = z.object({
  /** Paraphrased in the author's own words. */
  text: z.string().min(10).max(700),
  sourceIds: z.array(z.string()).min(1),
});

/* ----------------------------------------------------------------------------------------------
 * Historical haze events
 * -------------------------------------------------------------------------------------------- */

export const eventMeasurementSchema = z.object({
  country: countryCode,
  location: z.string().min(2).max(160),
  /** The exact index or concentration as the source names it, e.g. "3-hour PSI", "24-hour PSI", "API". */
  metric: z.string().min(2).max(120),
  value: z.number(),
  unit: z.string().min(1).max(40),
  averagingPeriod: z.string().min(2).max(60),
  observedAt: observedAtSchema,
  sourceIds: z.array(z.string()).min(1),
  note: z.string().max(400).optional(),
});

export const EVENT_STATUS = ["verified", "partial", "research_agenda"] as const;
export const EVENT_SEVERITY = ["severe", "moderate", "minor", "unrated"] as const;
export const EVENT_TYPES = ["transboundary", "national", "localised", "unclear"] as const;

export const hazeEventSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(5).max(160),
    yearStart: z.number().int().min(1980).max(2100),
    yearEnd: z.number().int().min(1980).max(2100),
    /** Human readable dates, only as precise as the sources are. */
    datesLabel: z.string().min(4).max(120),
    dateStart: partialDateSchema.nullable(),
    dateEnd: partialDateSchema.nullable(),
    type: z.enum(EVENT_TYPES),
    severity: z.enum(EVENT_SEVERITY),
    /** Why this severity label was given, citing what the sources say. "unrated" must explain why. */
    severityBasis: z.string().min(10).max(500),
    /**
     * verified        = core facts confirmed against the cited sources.
     * partial         = some facts confirmed, important gaps listed in openQuestions.
     * research_agenda = on the research list but not yet established as a notable episode.
     */
    status: z.enum(EVENT_STATUS),
    countries: z.array(countryCode),
    summary: z.string().min(40).max(900),
    summarySourceIds: z.array(z.string()),
    measurements: z.array(eventMeasurementSchema),
    fireWeatherContext: z.array(claimSchema),
    impacts: z.array(
      claimSchema.extend({
        kind: z.enum(["health", "economic", "environmental", "other"]),
        certainty: z.enum(["reported", "estimated", "contested"]),
      }),
    ),
    responses: z.array(claimSchema.extend({ actor: z.string().min(2).max(160) })),
    policy: z.array(claimSchema.extend({ date: partialDateSchema.nullable() })),
    /** Things that could not be verified. Required reading for anyone using the page. */
    openQuestions: z.array(z.string().min(5).max(400)),
    imagery: z.array(
      z.object({
        description: z.string().min(5).max(300),
        url: z.url(),
        pageUrl: z.url().optional(),
        credit: z.string().min(2).max(200),
        licenceNote: z.string().min(2).max(300),
      }),
    ),
    sources: z.array(sourceSchema).min(1),
    lastReviewed: z.iso.date(),
  })
  .superRefine((event, ctx) => {
    const ids = event.sources.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["sources"], message: "Duplicate source ids." });
    }
    const known = new Set(ids);
    const check = (path: (string | number)[], refs: readonly string[]) => {
      for (const ref of refs) {
        if (!known.has(ref)) ctx.addIssue({ code: "custom", path, message: `Unknown source id "${ref}".` });
      }
    };
    check(["summarySourceIds"], event.summarySourceIds);
    event.measurements.forEach((m, i) => check(["measurements", i, "sourceIds"], m.sourceIds));
    event.fireWeatherContext.forEach((c, i) => check(["fireWeatherContext", i, "sourceIds"], c.sourceIds));
    event.impacts.forEach((c, i) => check(["impacts", i, "sourceIds"], c.sourceIds));
    event.responses.forEach((c, i) => check(["responses", i, "sourceIds"], c.sourceIds));
    event.policy.forEach((c, i) => check(["policy", i, "sourceIds"], c.sourceIds));

    if (event.yearEnd < event.yearStart) {
      ctx.addIssue({ code: "custom", path: ["yearEnd"], message: "yearEnd is before yearStart." });
    }
    if (event.status !== "research_agenda" && event.summarySourceIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["summarySourceIds"], message: "A non-agenda event needs summary sources." });
    }
    if (event.status !== "verified" && event.openQuestions.length === 0) {
      ctx.addIssue({ code: "custom", path: ["openQuestions"], message: "Partial or agenda events must list open questions." });
    }
  });
export type HazeEvent = z.infer<typeof hazeEventSchema>;

/* ----------------------------------------------------------------------------------------------
 * Research and news library
 * -------------------------------------------------------------------------------------------- */

export const LIBRARY_TYPES = [
  "official_announcement",
  "scientific_paper",
  "asean_publication",
  "government_report",
  "intergovernmental_report",
  "dataset",
  "ngo_report",
  "journalism",
  "satellite_observation",
  "historical_document",
] as const;

export const libraryRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(3).max(300),
  publisher: z.string().min(2).max(200),
  publishedDate: partialDateSchema,
  url: z.url(),
  regions: z.array(z.union([countryCode, z.literal("ASEAN"), z.literal("GLOBAL")])).min(1),
  type: z.enum(LIBRARY_TYPES),
  /** One or two sentences, paraphrased. Not an abstract copy. */
  summary: z.string().min(30).max(500),
  /** Date a person last opened the URL and confirmed title, publisher and date. */
  verifiedDate: z.iso.date(),
});
export type LibraryRecord = z.infer<typeof libraryRecordSchema>;

export const libraryFileSchema = z
  .object({ records: z.array(libraryRecordSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.records.forEach((r, i) => {
      if (seen.has(r.id)) ctx.addIssue({ code: "custom", path: ["records", i, "id"], message: `Duplicate id "${r.id}".` });
      seen.add(r.id);
    });
  });

/* ----------------------------------------------------------------------------------------------
 * Country profiles
 * -------------------------------------------------------------------------------------------- */

export const countryProfileSchema = z
  .object({
    code: countryCode,
    status: z.enum(["researched", "partial"]),
    agencies: z.array(
      z.object({
        name: z.string().min(2).max(200),
        role: z.string().min(5).max(300),
        url: z.url(),
        sourceIds: z.array(z.string()).min(1),
      }),
    ),
    /** The air-quality index the country publicly reports, if the sources document one. */
    nationalIndex: z
      .object({
        name: z.string().min(2).max(160),
        description: z.string().min(10).max(500),
        sourceIds: z.array(z.string()).min(1),
      })
      .nullable(),
    monitoring: z.array(claimSchema),
    seasonalPattern: z.array(claimSchema),
    healthContext: z.array(claimSchema),
    policy: z.array(claimSchema.extend({ date: partialDateSchema.nullable() })),
    dataAccess: z.array(
      z.object({
        name: z.string().min(2).max(200),
        url: z.url(),
        accessMethod: z.enum(["documented_api", "download", "web_only", "request_only", "unknown"]),
        note: z.string().min(5).max(400),
      }),
    ),
    openQuestions: z.array(z.string().min(5).max(400)),
    sources: z.array(sourceSchema).min(1),
    lastReviewed: z.iso.date(),
  })
  .superRefine((profile, ctx) => {
    const ids = profile.sources.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["sources"], message: "Duplicate source ids." });
    }
    const known = new Set(ids);
    const check = (path: (string | number)[], refs: readonly string[]) => {
      for (const ref of refs) {
        if (!known.has(ref)) ctx.addIssue({ code: "custom", path, message: `Unknown source id "${ref}".` });
      }
    };
    profile.agencies.forEach((a, i) => check(["agencies", i, "sourceIds"], a.sourceIds));
    if (profile.nationalIndex) check(["nationalIndex", "sourceIds"], profile.nationalIndex.sourceIds);
    profile.monitoring.forEach((c, i) => check(["monitoring", i, "sourceIds"], c.sourceIds));
    profile.seasonalPattern.forEach((c, i) => check(["seasonalPattern", i, "sourceIds"], c.sourceIds));
    profile.healthContext.forEach((c, i) => check(["healthContext", i, "sourceIds"], c.sourceIds));
    profile.policy.forEach((c, i) => check(["policy", i, "sourceIds"], c.sourceIds));
    if (profile.status === "partial" && profile.openQuestions.length === 0) {
      ctx.addIssue({ code: "custom", path: ["openQuestions"], message: "Partial profiles must list open questions." });
    }
  });
export type CountryProfile = z.infer<typeof countryProfileSchema>;

/* ----------------------------------------------------------------------------------------------
 * Education fact pack
 * -------------------------------------------------------------------------------------------- */

export const EDUCATION_TOPICS = [
  "what-is-haze",
  "fire-and-peat",
  "pm25-vs-pm10",
  "index-meanings",
  "index-differences",
  "weather-transport",
  "health-effects",
  "precautions",
  "land-use-climate",
] as const;
export type EducationTopic = (typeof EDUCATION_TOPICS)[number];

export const educationFileSchema = z
  .object({
    lastReviewed: z.iso.date(),
    topics: z.array(
      z.object({
        topic: z.enum(EDUCATION_TOPICS),
        facts: z.array(claimSchema).min(1),
        officialGuidance: z.array(
          z.object({
            title: z.string().min(3).max(300),
            publisher: z.string().min(2).max(200),
            url: z.url(),
            region: z.union([countryCode, z.literal("ASEAN"), z.literal("GLOBAL")]),
          }),
        ),
      }),
    ),
    sources: z.array(sourceSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = file.sources.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["sources"], message: "Duplicate source ids." });
    }
    const known = new Set(ids);
    const seenTopics = new Set<string>();
    file.topics.forEach((t, ti) => {
      if (seenTopics.has(t.topic)) ctx.addIssue({ code: "custom", path: ["topics", ti, "topic"], message: "Duplicate topic." });
      seenTopics.add(t.topic);
      t.facts.forEach((f, fi) => {
        for (const ref of f.sourceIds) {
          if (!known.has(ref)) ctx.addIssue({ code: "custom", path: ["topics", ti, "facts", fi, "sourceIds"], message: `Unknown source id "${ref}".` });
        }
      });
    });
  });
export type EducationFile = z.infer<typeof educationFileSchema>;
