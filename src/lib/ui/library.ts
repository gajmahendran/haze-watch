import type { LibraryRecord } from "../content/schema";

export const LIBRARY_TYPE_LABEL: Record<LibraryRecord["type"], string> = {
  official_announcement: "Official announcement",
  scientific_paper: "Research",
  asean_publication: "ASEAN publication",
  government_report: "Government document",
  intergovernmental_report: "Intergovernmental report",
  ngo_report: "Organisation report",
  journalism: "Journalism",
  satellite_observation: "Satellite observation",
  historical_document: "Historical record",
  dataset: "Dataset",
};
