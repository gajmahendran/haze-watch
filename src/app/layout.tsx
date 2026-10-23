import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_NAME, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME}: live air quality and haze history`, template: `%s | ${SITE_NAME}` },
  description:
    "Independent record of haze in Southeast Asia: official air quality readings on their own scales, satellite fire detections, and a sourced history of haze episodes since 1997.",
  openGraph: { siteName: SITE_NAME, type: "website" },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: "#121815",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-[2000] rounded bg-lichen px-3 py-2 text-ground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
