# Content guidelines for Southeast Asia Haze Watch

This is the shared brief for anyone (human or agent) writing editorial content under `/content`.
The platform's credibility is its only real asset. A single invented figure or citation does more
damage than a thin page, so the rule is simple: **when in doubt, leave it out.**

## 1. What you may write

You may only state a fact if **you read it on a page you successfully opened during this session**
(WebFetch or a search result snippet that clearly shows it). Training memory is a lead, never a source.

- Paraphrase in your own words. Do not copy sentences. Do not reproduce paragraphs, tables or lyrics.
  Short factual figures (a number, a date, a name) are fine.
- Every claim carries `sourceIds`, and every id resolves to an entry in that file's `sources`.
- A `source` entry is created only for a URL you opened successfully. Set `accessedDate` to
  today's date (`2026-10-23`). If a page failed to load, did not contain the claim, or only a search
  snippet exists, do not cite it for that claim.
- Prefer, in this order: national environment, meteorology and health agencies; ASEAN and ASMC;
  WHO, UN agencies, World Bank, ADB; peer reviewed papers; established newsrooms. Use `kind` honestly.
  Journalism may support "reported that" statements. It must not be the only support for a contested
  attribution.
- Use the source's own wording for the *metric*: "24-hour PSI", "3-hour PSI", "API", "PM2.5 1-hour
  mean". Never turn one into another. Never write a bare "AQI" for a figure from a national index.

## 2. Never

- Never invent or estimate a reading, a loss in dollars, a casualty count or a hospital figure.
  If a source gives a range or says it is an estimate, set `certainty: "estimated"` and say who
  estimated it. If studies disagree, use `"contested"` and name the disagreement.
- Never blame a company, a landowner, a plantation group or a named person for a fire or for haze.
  Do not name companies at all unless an official legal outcome is the point of a policy item, and
  even then describe the legal outcome, not the guilt. Hotspots are not proof of cause.
- Never claim a government failed, lied or was negligent. Report what an official body said or did.
- Never fill a field just because the schema has a slot. Empty arrays are correct when the evidence
  is missing.
- Never copy a figure from one country's index and present it as equal to another's.

## 3. Status, severity and the research agenda

The event list is a **research agenda**, not a claim that every year had a crisis.

- `status: "verified"`: the core facts (dates, places, headline readings) are confirmed in at least
  one official or scientific source you opened.
- `status: "partial"`: some facts confirmed, important gaps listed in `openQuestions`.
- `status: "research_agenda"`: you could not establish it as a notable regional episode. Say so in
  `summary`, set `severity: "unrated"`, explain in `severityBasis`, and list what is missing.
- `severity` must be justified in `severityBasis` by what the sources say (for example an official
  agency describing readings as "Hazardous" on its own scale). Do not rank events against each other.
  Use `"unrated"` when sources do not support a label.
- `type`: `transboundary` only if a source describes smoke crossing a national border.

## 4. Measurements

Add an entry to `measurements` only when the source gives: the number, the exact metric name, the
averaging period, the place, and the date or time. One measurement per entry. Put caveats in `note`.
A 3 hour PSI and a 24 hour PSI are different quantities and must not share an entry.

## 5. Imagery

Leave `imagery` empty unless you opened the image's own page, confirmed it is by an agency that
permits reuse (for example NASA Earth Observatory) and can state the credit and licence note.
A broken or unverifiable image link is worse than no image.

## 6. Country profiles

Describe what each country's official bodies publicly say and do. If a country has no documented
public air quality index or no open data you could confirm, say so in `openQuestions` and set
`nationalIndex` to `null`. `dataAccess.accessMethod` must be true to what you saw: a web page is
`web_only`, never `documented_api`.

## 7. Tone

British English. Plain, precise, calm. No drama, no adjectives that the source does not use,
no hyphens used as decoration. Short sentences. Write for a journalist who will check you.

## 8. Mechanics

- Schemas: `src/lib/content/schema.ts`. Do not change it, or anything else under `src/`.
- Files: events `content/events/<slug>.json`; countries `content/countries/<code lowercase>.json`;
  education `content/education/facts.json`; library records `content/library/<your-part>.json`
  shaped `{ "records": [ ... ] }`.
- Source ids are `s1`, `s2`, ... and local to each file.
- Validate often: `cd /home/claude/haze-watch && npm run validate:content`. Only your own files should
  fail while you work. Fix them. Do not touch another writer's files.
- The shell cannot reach the internet. Use WebSearch and WebFetch only.
- Dates: `lastReviewed` and `accessedDate` are `2026-10-23`.
