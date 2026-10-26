import Link from "next/link";
import { REAL_AIR_PROVIDERS, REAL_HOTSPOT_PROVIDERS } from "@/lib/providers/registry";
import { correctionsContact } from "@/lib/site";

export function SiteFooter() {
  const providers = [...REAL_AIR_PROVIDERS, ...REAL_HOTSPOT_PROVIDERS];
  const contact = correctionsContact();
  return (
    <footer className="mt-24 border-t border-line bg-forest/60">
      <div className="wrap grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-xl">Southeast Asia Haze Watch</p>
          <p className="mt-2 max-w-md text-sm text-ash">
            An independent record of haze in Southeast Asia. Readings come from official agencies and are shown on their own
            scales. Editorial pages cite every claim. This site is not an official source of health advice.
          </p>
          <p className="mt-4 text-sm">
            Corrections:{" "}
            {contact ? (
              <a href={`mailto:${contact}`}>{contact}</a>
            ) : (
              <span className="text-ash">contact address not configured yet (set NEXT_PUBLIC_CORRECTIONS_EMAIL)</span>
            )}
            . See the <Link href="/about#corrections">corrections policy</Link>.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Data sources</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {providers.map((p) => (
              <li key={p.id}>
                <a href={p.homepage} rel="noopener noreferrer" target="_blank">
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">About this site</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>
              <Link href="/about">Purpose and methodology</Link>
            </li>
            <li>
              <Link href="/about#sources">Source status and licences</Link>
            </li>
            <li>
              <Link href="/about#limitations">Known limitations</Link>
            </li>
            <li>
              <Link href="/learn#index-differences">Why indices differ</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="wrap border-t border-line py-5 text-xs text-dim">
        Contains information from data.gov.sg made available under the Singapore Open Data Licence v1.0. Malaysian monthly
        series from OpenDOSM (CC BY 4.0). Fire detections from NASA FIRMS. Boundaries from Natural Earth (public domain),
        not an endorsement of any claim.
      </div>
    </footer>
  );
}
