import type { HazeEvent } from "../content/schema";

export const SEVERITY_LABEL: Record<HazeEvent["severity"], string> = {
  severe: "Severe",
  moderate: "Moderate",
  minor: "Minor",
  unrated: "Not rated",
};

/** Marker height on the timeline. Severity is editorial, so it uses size and words, not band colours. */
export const SEVERITY_WEIGHT: Record<HazeEvent["severity"], number> = { severe: 3, moderate: 2, minor: 1, unrated: 0 };

export const STATUS_LABEL: Record<HazeEvent["status"], string> = {
  verified: "Verified",
  partial: "Partly verified",
  research_agenda: "On the research agenda",
};

export const TYPE_LABEL: Record<HazeEvent["type"], string> = {
  transboundary: "Transboundary",
  national: "National",
  localised: "Localised",
  unclear: "Unclear",
};

export function yearsLabel(e: Pick<HazeEvent, "yearStart" | "yearEnd">): string {
  return e.yearStart === e.yearEnd ? String(e.yearStart) : `${e.yearStart}–${e.yearEnd}`;
}
