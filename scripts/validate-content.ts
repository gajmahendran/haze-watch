/**
 * Validates every editorial JSON file in /content against the Zod schemas.
 *
 *   npm run validate:content
 *
 * Exits 1 on any problem. Run by `npm run check` and intended for CI.
 */
import path from "node:path";
import { COUNTRY_CODES } from "../src/lib/domain/countries";
import {
  ContentError,
  loadCountryProfile,
  loadEducation,
  loadEvents,
  loadLibrary,
} from "../src/lib/content/loader";

const root = path.join(process.cwd(), "content");
let failures = 0;

function attempt<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}`);
    console.error(error instanceof ContentError ? error.message : error);
    return undefined;
  }
}

const events = attempt("events", () => loadEvents(root));
if (events) {
  console.log(`events: ${events.length}`);
  for (const e of events) {
    console.log(`  ${e.slug.padEnd(34)} status=${e.status.padEnd(15)} severity=${e.severity.padEnd(8)} sources=${e.sources.length} measurements=${e.measurements.length}`);
  }
}

const library = attempt("library", () => loadLibrary(root));
if (library) console.log(`library records: ${library.length}`);

let profiles = 0;
for (const code of COUNTRY_CODES) {
  const profile = attempt(`country ${code}`, () => loadCountryProfile(code, root));
  if (profile) profiles += 1;
}
console.log(`country profiles: ${profiles}/${COUNTRY_CODES.length}`);

const education = attempt("education", () => loadEducation(root));
console.log(`education topics: ${education ? education.topics.length : 0}`);

if (failures > 0) {
  console.error(`\n${failures} content file(s) failed validation.`);
  process.exit(1);
}
console.log("\nAll present content files are valid.");
