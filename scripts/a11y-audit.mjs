// Accessibility audit: runs axe-core (WCAG 2.1 A and AA rules) on every page at desktop and phone
// widths against a running server.
//
//   node scripts/a11y-audit.mjs [baseUrl]     (default http://localhost:3000)
//
// Needs playwright-core and a Chromium. Set CHROMIUM_PATH if Chromium is not at the default path.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const base = process.argv[2] ?? "http://localhost:3000";
const pages = [
  "/", "/live", "/history", "/history/2015-fire-crisis", "/history/2026-haze-season", "/hotspots", "/data",
  "/countries", "/countries/malaysia", "/countries/laos", "/learn", "/research", "/about", "/this-page-does-not-exist",
];
const widths = [1366, 390];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let total = 0;
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const path of pages) {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(3500);
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } }),
    );
    for (const v of result.violations) {
      total += v.nodes.length;
      console.log(`[${width}] ${path}  ${v.impact}  ${v.id}: ${v.help} (${v.nodes.length})`);
      for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(total === 0 ? "No violations found." : `${total} violating node(s).`);
process.exit(total === 0 ? 0 : 1);
