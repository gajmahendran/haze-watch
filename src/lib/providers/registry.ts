import { demoAir, demoHotspots } from "./demo";
import { firmsViirs } from "./firms";
import { myDoeApims } from "./my-doe-apims";
import { myOpenDosm } from "./my-opendosm";
import { sgNeaAir } from "./sg-nea-air";
import { sgNeaArchive } from "./sg-nea-archive";
import { sgNeaWeather } from "./sg-nea-weather";
import { isDemoEnabled, type AirProvider, type HotspotProvider, type Provider, type ProviderEnv } from "./types";

/** Every real source, connected or not. Order is display order. */
export const REAL_AIR_PROVIDERS: readonly AirProvider[] = [sgNeaAir, sgNeaArchive, sgNeaWeather, myDoeApims, myOpenDosm];
export const REAL_HOTSPOT_PROVIDERS: readonly HotspotProvider[] = [firmsViirs];

export function airProviders(env: ProviderEnv): AirProvider[] {
  return isDemoEnabled(env) ? [...REAL_AIR_PROVIDERS, demoAir] : [...REAL_AIR_PROVIDERS];
}

export function hotspotProviders(env: ProviderEnv): HotspotProvider[] {
  return isDemoEnabled(env) ? [...REAL_HOTSPOT_PROVIDERS, demoHotspots] : [...REAL_HOTSPOT_PROVIDERS];
}

export function allProviders(env: ProviderEnv): Provider[] {
  return [...airProviders(env), ...hotspotProviders(env)];
}

export function findAirProvider(env: ProviderEnv, id: string): AirProvider | undefined {
  return airProviders(env).find((p) => p.id === id);
}

/**
 * Sources we have looked at but do not ingest, shown on the methodology page so readers know they
 * were considered and why they are not used.
 */
export const REVIEWED_SOURCES = [
  {
    name: "ASEAN Haze Portal",
    url: "https://hazeportal.asean.org/",
    finding:
      "Knowledge platform with publications and a daily haze and hotspot map that links to ASMC. No API, download or reuse licence documented. Linked, not ingested.",
  },
  {
    name: "ASEAN Specialised Meteorological Centre (ASMC) WIS2 data catalogue",
    url: "https://wis2.asmc.asean.org/data-catalog/",
    finding:
      "Offers VIIRS hotspot records, a daily haze map and a smoke dispersion model through an API. Its terms of use (checked 23 October 2026) restrict use to non-commercial purposes and forbid redistribution or automated access without written permission from NEA (ASMC_Enquiries@nea.gov.sg). Not ingested; this site links to ASMC and cites its published alert levels.",
  },
  {
    name: "Malaysia APIMS (live Air Pollutant Index)",
    url: "https://eqms.doe.gov.my/apims/main",
    finding: "Public website with hourly readings. No documented API or reuse terms. Not connected.",
  },
  {
    name: "Singapore historical PSI readings (haze.gov.sg)",
    url: "https://www.haze.gov.sg/resources/historical-readings",
    finding:
      "Web table of 24-hour PSI and PM2.5 for the past year, behind a captcha. The same NEA data is taken from data.gov.sg instead.",
  },
  {
    name: "Singapore transboundary haze archive (weather.gov.sg)",
    url: "https://www.weather.gov.sg/category/all-categories/transboundary-haze/",
    finding: "Editorial archive. Used as a source for historical event pages, not as a data feed.",
  },
] as const;
