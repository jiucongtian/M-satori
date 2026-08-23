import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "out");
const HOME_BASELINE_BYTES = 263 * 1024;
const HOME_TARGET_BYTES = Math.floor(HOME_BASELINE_BYTES * 0.75);
const DOMAIN_JS_LIMIT_BYTES = 100 * 1024;
const reportOnly = process.argv.includes("--report");

const ROUTES = {
  "/": "index.html",
  "/login": "login.html",
  "/consent": "consent.html",
  "/home": "home.html",
  "/profile/create": "profile/create.html",
  "/daily": "daily.html",
  "/daily/report": "daily/report.html",
  "/my": "my.html",
  "/my/profile": "my/profile.html",
  "/my/seeds": "my/seeds.html",
  "/my/reports": "my/reports.html",
  "/my/archive": "my/archive.html",
  "/legal": "legal.html",
};

function routeAssets(relativeHtml) {
  const htmlPath = resolve(OUT_DIR, relativeHtml);
  if (!existsSync(htmlPath)) return null;
  const html = readFileSync(htmlPath, "utf8");
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+\.(?:js|css))["']/g)) {
    assets.add(match[1]);
  }
  return assets;
}

function gzipBytes(asset) {
  return gzipSync(readFileSync(resolve(OUT_DIR, `.${asset}`))).byteLength;
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const homeAssets = routeAssets(ROUTES["/"]);
if (!homeAssets) {
  console.error("Missing frontend/out/index.html. Run npm run build:static first.");
  process.exit(2);
}

const results = [];
for (const [route, html] of Object.entries(ROUTES)) {
  const assets = routeAssets(html);
  if (!assets) {
    results.push({ route, missing: true, total: 0, domainJs: 0 });
    continue;
  }
  const total = [...assets].reduce((sum, asset) => sum + gzipBytes(asset), 0);
  const domainJs = [...assets]
    .filter((asset) => asset.endsWith(".js") && !homeAssets.has(asset))
    .reduce((sum, asset) => sum + gzipBytes(asset), 0);
  results.push({ route, missing: false, total, domainJs });
}

for (const result of results) {
  if (result.missing) console.log(`${result.route.padEnd(18)} missing`);
  else console.log(`${result.route.padEnd(18)} total=${format(result.total).padEnd(12)} domain-js=${format(result.domainJs)}`);
}

if (reportOnly) process.exit(0);

const violations = [];
const home = results.find((result) => result.route === "/");
if (home.total > HOME_TARGET_BYTES) {
  violations.push(`/ initial JS+CSS ${format(home.total)} exceeds target ${format(HOME_TARGET_BYTES)} (25% below 263 KiB baseline)`);
}
for (const result of results) {
  if (result.missing) violations.push(`${result.route} static HTML is missing`);
  if (result.domainJs > DOMAIN_JS_LIMIT_BYTES) {
    violations.push(`${result.route} domain JS ${format(result.domainJs)} exceeds ${format(DOMAIN_JS_LIMIT_BYTES)}`);
  }
}

if (violations.length > 0) {
  console.error("\nRoute budget violations:\n- " + violations.join("\n- "));
  process.exit(1);
}
console.log("\nAll route budgets passed.");
