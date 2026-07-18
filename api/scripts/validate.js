const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const failures = [];
const checked = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

const jsFiles = walk(apiRoot).filter((file) => file.endsWith(".js"));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  checked.push(path.relative(repoRoot, file));
  if (result.status !== 0) failures.push(`${path.relative(repoRoot, file)}: ${result.stderr.trim()}`);
}

const jsonFiles = [path.join(repoRoot, "package.json"), path.join(repoRoot, "staticwebapp.config.json"), ...walk(apiRoot).filter((file) => file.endsWith(".json"))];
const parsed = new Map();
for (const file of jsonFiles) {
  try { parsed.set(file, JSON.parse(fs.readFileSync(file, "utf8"))); checked.push(path.relative(repoRoot, file)); }
  catch (error) { failures.push(`${path.relative(repoRoot, file)}: invalid JSON (${error.message})`); }
}

const swa = parsed.get(path.join(repoRoot, "staticwebapp.config.json")) || {};
const routeRules = Array.isArray(swa.routes) ? swa.routes : [];
const functions = fs.readdirSync(apiRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(apiRoot, entry.name, "function.json")));
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

const frontend = fs.readFileSync(path.join(repoRoot, "Trip Tracker.dc.html"), "utf8");
for (const endpoint of ["trips", "families", "attachments", "presence", "request-access", "access"]) {
  if (!frontend.includes(`/api/${endpoint}`)) failures.push(`frontend: no caller found for /api/${endpoint}`);
}
const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
if (!index.includes("/api/site-settings")) failures.push("index.html: public site-settings caller missing");
if (swa.auth && swa.auth.rolesSource !== "/api/roles") failures.push("staticwebapp.config.json: auth.rolesSource must be /api/roles");

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Validated ${jsFiles.length} API JavaScript files, ${jsonFiles.length} JSON files, ${functions.length} Azure Functions, SWA route coverage, and frontend API references.`);
