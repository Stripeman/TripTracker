const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const failures = [];
const checked = [];

function requireFile(relative) {
  const file = path.join(repoRoot, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) failures.push(`${relative}: required file is missing`);
  else checked.push(relative);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

const jsFiles = [
  ...walk(apiRoot).filter((file) => file.endsWith(".js")),
  ...fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(repoRoot, entry.name)),
];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  checked.push(path.relative(repoRoot, file));
  if (result.status !== 0) failures.push(`${path.relative(repoRoot, file)}: ${result.stderr.trim()}`);
}

const jsonFiles = walk(repoRoot).filter((file) =>
  file.endsWith(".json") &&
  !file.includes(`${path.sep}node_modules${path.sep}`) &&
  !file.includes(`${path.sep}logs${path.sep}`)
);
const parsed = new Map();
for (const file of jsonFiles) {
  try { parsed.set(file, JSON.parse(fs.readFileSync(file, "utf8"))); checked.push(path.relative(repoRoot, file)); }
  catch (error) { failures.push(`${path.relative(repoRoot, file)}: invalid JSON (${error.message})`); }
}

const swa = parsed.get(path.join(repoRoot, "staticwebapp.config.json")) || {};
const rootPackage = parsed.get(path.join(repoRoot, "package.json")) || {};
const apiPackage = parsed.get(path.join(apiRoot, "package.json")) || {};
if (!rootPackage.scripts || rootPackage.scripts.test !== "npm --prefix api test") failures.push("package.json: test must run the complete API test suite");
if (!rootPackage.scripts || rootPackage.scripts.build !== "npm --prefix api run build") failures.push("package.json: build must delegate to API build validation");
if (!apiPackage.scripts || !/node --test/.test(apiPackage.scripts.test || "")) failures.push("api/package.json: test must use the Node test runner");
if (!apiPackage.scripts || apiPackage.scripts.build !== "npm test && npm run validate") failures.push("api/package.json: build must run tests and validation");
const routeRules = Array.isArray(swa.routes) ? swa.routes : [];
const functions = fs.readdirSync(apiRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(apiRoot, entry.name, "function.json")));
const functionRoutes = new Map();
for (const entry of functions) {
  const functionFile = path.join(apiRoot, entry.name, "function.json");
  const config = parsed.get(functionFile);
  const handler = path.join(apiRoot, entry.name, "index.js");
  if (!fs.existsSync(handler)) { failures.push(`api/${entry.name}: function.json has no index.js handler`); continue; }
  const triggers = config && config.bindings && config.bindings.filter((binding) => binding.type === "httpTrigger");
  const outputs = config && config.bindings && config.bindings.filter((binding) => binding.type === "http" && binding.direction === "out");
  if (!triggers || triggers.length !== 1) failures.push(`api/${entry.name}/function.json: expected one httpTrigger`);
  if (!outputs || outputs.length !== 1) failures.push(`api/${entry.name}/function.json: expected one HTTP output`);
  if (!triggers || triggers.length !== 1) continue;
  const trigger = triggers[0];
  const route = `/api/${trigger.route || entry.name}`;
  const methods = new Set((trigger.methods || []).map((method) => method.toLowerCase()));
  if (trigger.direction !== "in" || trigger.name !== "req") failures.push(`${route}: HTTP trigger must be the inbound req binding`);
  if (outputs.length === 1 && (outputs[0].name !== "res")) failures.push(`${route}: HTTP output must use the res binding`);
  if (functionRoutes.has(route)) failures.push(`${route}: duplicate Azure Function route`);
  functionRoutes.set(route, methods);
  if (trigger.authLevel !== "anonymous") failures.push(`${route}: expected SWA-managed anonymous function binding`);
  if (!Array.isArray(trigger.methods) || !trigger.methods.length) failures.push(`${route}: missing HTTP methods`);
  const protectedRoute = ["access", "families", "trips", "attachments", "presence"].includes(entry.name);
  if (protectedRoute) {
    for (const method of trigger.methods || []) {
      const covered = routeRules.some((rule) => rule.route === route && (!rule.methods || rule.methods.map((m) => m.toLowerCase()).includes(method.toLowerCase())) && Array.isArray(rule.allowedRoles) && rule.allowedRoles.length);
      if (!covered) failures.push(`${route} ${method.toUpperCase()}: no matching protected Static Web Apps route rule`);
    }
  }
}

for (const rule of routeRules.filter((item) => typeof item.route === "string" && item.route.startsWith("/api/"))) {
  const methods = functionRoutes.get(rule.route);
  if (!methods) {
    failures.push(`staticwebapp.config.json: ${rule.route} has no matching Azure Function`);
    continue;
  }
  for (const method of rule.methods || []) {
    if (!methods.has(String(method).toLowerCase())) failures.push(`staticwebapp.config.json: ${rule.route} ${String(method).toUpperCase()} is not accepted by its Azure Function`);
  }
}

const configuredRouteMethods = new Set();
for (const rule of routeRules.filter((item) => typeof item.route === "string" && item.route.startsWith("/api/"))) {
  for (const method of rule.methods || ["*"]) {
    const key = `${rule.route} ${String(method).toUpperCase()}`;
    if (configuredRouteMethods.has(key)) failures.push(`staticwebapp.config.json: duplicate route rule for ${key}`);
    configuredRouteMethods.add(key);
  }
}

const frontend = fs.readFileSync(path.join(repoRoot, "Trip Tracker.dc.html"), "utf8");
for (const endpoint of ["trips", "families", "attachments", "presence", "request-access", "access"]) {
  if (!frontend.includes(`/api/${endpoint}`)) failures.push(`frontend: no caller found for /api/${endpoint}`);
}
const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
if (!index.includes("/api/site-settings")) failures.push("index.html: public site-settings caller missing");
if (!swa.auth || swa.auth.rolesSource !== "/api/roles") failures.push("staticwebapp.config.json: auth.rolesSource must be /api/roles");
if (!swa.navigationFallback || swa.navigationFallback.rewrite !== "/index.html") failures.push("staticwebapp.config.json: navigation fallback must rewrite to /index.html");

for (const file of [
  "index.html", "Trip Tracker.dc.html", "Landing.dc.html", "support.js", "favicon.svg",
  "staticwebapp.config.json", "api/host.json",
  ".github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml",
]) requireFile(file);

for (const relative of ["index.html", "Trip Tracker.dc.html", "Landing.dc.html"]) {
  const source = fs.readFileSync(path.join(repoRoot, relative), "utf8");
  const references = [
    ...[...source.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
      .map((match) => match[1])
      .filter((reference) => /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)(?:[?#]|$)/i.test(reference)),
  ];
  for (const reference of references) {
    if (!reference || reference.startsWith("#") || reference.startsWith("/") || reference.startsWith("{{") || /^[a-z][a-z\d+.-]*:/i.test(reference)) continue;
    const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, "");
    if (clean && !fs.existsSync(path.resolve(repoRoot, clean))) failures.push(`${relative}: broken local reference ${reference}`);
  }
}

const deployWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml"), "utf8");
if (!/^\s*app_location:\s*["']?\/["']?\s*$/m.test(deployWorkflow)) failures.push("deployment workflow: app_location must be /");
if (!/^\s*api_location:\s*["']?api["']?\s*$/m.test(deployWorkflow)) failures.push("deployment workflow: api_location must be api");
if (!/^\s*skip_app_build:\s*true\s*$/m.test(deployWorkflow)) failures.push("deployment workflow: expected static frontend deployment with skip_app_build true");

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Validated ${jsFiles.length} JavaScript files, ${jsonFiles.length} repository JSON files, package script wiring, ${functions.length} Azure Functions, bidirectional SWA route coverage, deployment structure, and frontend references.`);
