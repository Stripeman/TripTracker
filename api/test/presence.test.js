const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const presence = require("../presence");

test("presence rejects missing and malformed principals", async () => {
  resetBlobs();
  assert.equal((await invoke(presence, request("GET"))).status, 401);
  const malformed = request("GET");
  malformed.headers["x-ms-client-principal"] = "not-json";
  assert.equal((await invoke(presence, malformed)).status, 401);
});

test("heartbeats count new sessions once and persist principal-owned identity fields", async () => {
  resetBlobs();
  const first = await invoke(presence, request("POST", "person@example.test", {
    body: { name: "  Synthetic Person  ", sid: "session-a" },
  }));
  const second = await invoke(presence, request("POST", "person@example.test", {
    body: { name: "Synthetic Person", sid: "session-a" },
  }));
  const third = await invoke(presence, request("POST", "person@example.test", {
    body: { name: "Synthetic Person", sid: "session-b" },
  }));
  assert.deepEqual([first.body.logins, second.body.logins, third.body.logins], [1, 1, 2]);
  const stored = readBlob("presence.json").users["user-1"];
  assert.equal(stored.email, "person@example.test");
  assert.equal(stored.name, "Synthetic Person");
  assert.equal(stored.sid, "session-b");
  assert.equal(stored.logins, 2);
});

test("online roster excludes stale records and marks the caller", async () => {
  const now = Date.now();
  resetBlobs({ "presence.json": { users: {
    "user-1": { name: "Current", email: "current@example.test", roles: ["reader"], lastSeen: now },
    stale: { name: "Stale", email: "stale@example.test", roles: ["reader"], lastSeen: now - 120000 },
  } } });
  const res = await invoke(presence, request("GET", "current@example.test"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users.map((user) => user.id), ["user-1"]);
  assert.equal(res.body.users[0].you, true);
});

test("login statistics are admin-only and include trip owners without presence", async () => {
  resetBlobs({
    "presence.json": { users: { known: { name: "Known", email: "known@example.test", logins: 3, lastSeen: 1 } } },
    "trip-tracker.json": { locations: [
      { id: "one", ownerEmail: "known@example.test" },
      { id: "two", ownerEmail: "never@example.test" },
      { id: "three", ownerEmail: "NEVER@example.test" },
    ] },
  });
  assert.equal((await invoke(presence, request("GET", "reader@example.test", { query: { stats: "1" } }))).status, 403);
  const res = await invoke(presence, request("GET", "admin@example.test", {
    principal: { roles: ["authenticated", "admin"] }, query: { stats: "true" },
  }));
  assert.equal(res.status, 200);
  const byEmail = Object.fromEntries(res.body.stats.map((row) => [row.email, row]));
  assert.equal(byEmail["known@example.test"].trips, 1);
  assert.equal(byEmail["known@example.test"].logins, 3);
  assert.equal(byEmail["never@example.test"].trips, 2);
  assert.equal(byEmail["never@example.test"].logins, 0);
});
