const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("frontend uses the deployed trip and attachment request contracts", () => {
  const html = read("Trip Tracker.dc.html");
  assert.match(html, /fetch\('\/api\/trips', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body \}\)/);
  assert.match(html, /JSON\.stringify\(\{ tripId, filename: file\.name, mimeType: file\.type \|\| 'application\/octet-stream', dataBase64 \}\)/);
  assert.match(html, /JSON\.stringify\(\{ action: 'delete', tripId, id \}\)/);
  assert.match(html, /'If-None-Match': this\._famEtag/);
});

test("entry page requests only the public site-settings endpoint", () => {
  const html = read("index.html");
  const apiCalls = [...html.matchAll(/fetch\(['"]([^'"]+)/g)].map((match) => match[1]);
  assert.deepEqual(apiCalls, ["/api/site-settings"]);
});
