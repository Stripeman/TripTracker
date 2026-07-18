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

test("frontend enforces current trip required-field and date-range behavior before API persistence", () => {
  const html = read("Trip Tracker.dc.html");
  assert.match(html, /if \(!hasCity\) \{[\s\S]*?formError: 'City is required\.'/);
  assert.match(html, /if \(this\.isUS\(f\.country\)[\s\S]*?formError: 'State is required for U\.S\. cities\.'/);
  assert.match(html, /if \(!f\.date\) \{[\s\S]*?formError: 'A trip date is required\.'/);
  assert.match(html, /if \(f\.date && f\.dateEnd && f\.dateEnd < f\.date\) f\.dateEnd = '';/);
  assert.match(html, /_itineraryDayList\(date, dateEnd\)[\s\S]*?if \(!dateEnd \|\| dateEnd <= date\) return out;/);
});

test("Azure Functions expose the deployed route names and HTTP methods through standard bindings", () => {
  const expected = {
    access: ["get", "post", "put"],
    attachments: ["get", "post"],
    families: ["get", "post"],
    presence: ["get", "post"],
    "request-access": ["post"],
    roles: ["post"],
    "site-settings": ["get"],
    trips: ["get", "post", "put"],
  };

  for (const [name, methods] of Object.entries(expected)) {
    const config = JSON.parse(read(`api/${name}/function.json`));
    const trigger = config.bindings.filter((binding) => binding.type === "httpTrigger");
    const output = config.bindings.filter((binding) => binding.type === "http" && binding.direction === "out");
    assert.equal(trigger.length, 1, `${name} must have one HTTP trigger`);
    assert.equal(output.length, 1, `${name} must have one HTTP output`);
    assert.deepEqual(trigger[0], {
      authLevel: "anonymous", type: "httpTrigger", direction: "in", name: "req",
      methods, ...(name === "access" || name === "roles" ? {} : { route: name }),
    });
    assert.equal(output[0].name, "res");
  }
});

test("Static Web Apps applies the expected authentication gates to protected API methods", () => {
  const config = JSON.parse(read("staticwebapp.config.json"));
  assert.equal(config.auth.rolesSource, "/api/roles");
  assert.deepEqual(config.navigationFallback, {
    rewrite: "/index.html",
    exclude: ["/api/*", "*.{json,js,css,png,jpg,svg,ico}"],
  });
  assert.deepEqual(config.routes, [
    { route: "/api/access", allowedRoles: ["admin"] },
    { route: "/api/families", allowedRoles: ["authenticated"] },
    { route: "/api/trips", methods: ["GET"], allowedRoles: ["reader", "editor"] },
    { route: "/api/trips", methods: ["POST", "PUT"], allowedRoles: ["editor"] },
    { route: "/api/attachments", methods: ["GET"], allowedRoles: ["reader", "editor"] },
    { route: "/api/attachments", methods: ["POST"], allowedRoles: ["editor"] },
    { route: "/api/presence", methods: ["GET", "POST"], allowedRoles: ["reader", "editor"] },
  ]);
});
