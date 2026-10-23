import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  countryProfileSchema,
  educationFileSchema,
  hazeEventSchema,
  libraryFileSchema,
  type CountryProfile,
  type EducationFile,
  type HazeEvent,
  type LibraryRecord,
} from "./schema";
import type { CountryCode } from "../domain/countries";

/**
 * Reads editorial JSON from /content and validates it against the schemas.
 * Reads are synchronous and deterministic, so pages that use them prerender at build time.
 * Invalid content throws, which fails the build: bad citations should never ship.
 */

export const CONTENT_ROOT = path.join(process.cwd(), "content");

export class ContentError extends Error {
  constructor(file: string, issues: string) {
    super(`Invalid content file ${file}:\n${issues}`);
    this.name = "ContentError";
  }
}

function readJson<S extends z.ZodType>(file: string, schema: S, root: string): z.infer<S> {
  const full = path.join(root, file);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    throw new ContentError(file, error instanceof Error ? error.message : String(error));
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new ContentError(file, issues);
  }
  return parsed.data;
}

function listJson(dir: string, root: string): string[] {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadEvents(root = CONTENT_ROOT): HazeEvent[] {
  const events = listJson("events", root).map((f) => {
    const event = readJson(f, hazeEventSchema, root);
    const expected = path.basename(f, ".json");
    if (event.slug !== expected) throw new ContentError(f, `  - slug "${event.slug}" must match the file name "${expected}".`);
    return event;
  });
  return events.sort((a, b) => a.yearStart - b.yearStart || a.slug.localeCompare(b.slug));
}

export function loadEvent(slug: string, root = CONTENT_ROOT): HazeEvent | undefined {
  return loadEvents(root).find((e) => e.slug === slug);
}

/**
 * Library records may live in `content/library.json` and/or any number of `content/library/*.json`
 * files, each shaped `{ "records": [...] }`. Ids must be unique across all of them.
 */
export function loadLibrary(root = CONTENT_ROOT): LibraryRecord[] {
  const files = [
    ...(fs.existsSync(path.join(root, "library.json")) ? ["library.json"] : []),
    ...listJson("library", root),
  ];
  const seen = new Map<string, string>();
  const records: LibraryRecord[] = [];
  for (const file of files) {
    for (const record of readJson(file, libraryFileSchema, root).records) {
      const prior = seen.get(record.id);
      if (prior) throw new ContentError(file, `  - duplicate id "${record.id}" (already defined in ${prior}).`);
      seen.set(record.id, file);
      records.push(record);
    }
  }
  return records.sort((a, b) =>
    a.publishedDate < b.publishedDate ? 1 : a.publishedDate > b.publishedDate ? -1 : a.id.localeCompare(b.id),
  );
}

export function loadCountryProfile(code: CountryCode, root = CONTENT_ROOT): CountryProfile | undefined {
  const file = path.join("countries", `${code.toLowerCase()}.json`);
  if (!fs.existsSync(path.join(root, file))) return undefined;
  const profile = readJson(file, countryProfileSchema, root);
  if (profile.code !== code) throw new ContentError(file, `  - code "${profile.code}" does not match the file name.`);
  return profile;
}

export function loadEducation(root = CONTENT_ROOT): EducationFile | undefined {
  const file = path.join("education", "facts.json");
  if (!fs.existsSync(path.join(root, file))) return undefined;
  return readJson(file, educationFileSchema, root);
}
