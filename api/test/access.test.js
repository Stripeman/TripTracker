const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const access = require("../access");

test("access list requires an authenticated administrator", async () => {
  resetBlobs({ "access-list.json": { list: [{ email: "member@example.test", role: "reader" }] } });
  assert.equal((await invoke(access, request("GET"))).status, 401);
  assert.equal((await invoke(access, request("GET", "member@example.test"))).status, 403);
});

test("administrator reads legacy arrays and writes a normalized access list", async () => {
  resetBlobs({ "access-list.json": [{ email: "legacy@example.test", role: "reader" }] });
  const admin = { principal: { roles: ["authenticated", "admin"] } };
  const get = await invoke(access, request("GET", "admin@example.test", admin));
  assert.deepEqual(get.body.list, [{ email: "legacy@example.test", role: "reader" }]);

  const post = await invoke(access, request("POST", "admin@example.test", {
    ...admin,
    body: { list: [
      { email: " Person@Example.Test ", role: "EDITOR", name: " Person " },
      { email: "person@example.test", role: "admin" },
      { email: "fallback@example.test", role: "unknown", active: false },
      { email: "invalid", role: "admin" },
    ] },
  }));
  assert.equal(post.status, 200);
  assert.equal(post.body.count, 2);
  assert.deepEqual(readBlob("access-list.json"), {
    app: "trip-tracker",
    kind: "access-list",
    list: [
      { email: "person@example.test", role: "editor", active: true, name: "Person" },
      { email: "fallback@example.test", role: "reader", active: false },
    ],
  });
});

test("access list rejects malformed replacement payloads", async () => {
  resetBlobs();
  const res = await invoke(access, request("PUT", "admin@example.test", {
    principal: { roles: ["authenticated", "admin"] }, body: "{bad",
  }));
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid JSON");
});
