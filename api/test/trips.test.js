const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const trips = require("../trips");

const family = { id: "fam-a", name: "Synthetic Family", createdBy: "owner@example.test", approved: true };
const baseTrip = { id: "trip-1", familyId: "fam-a", owner: "owner-id", ownerEmail: "owner@example.test", city: "Test City", date: "2026-08-01", dateEnd: "2026-08-04", visibility: "private", sharedWith: [] };

function seed(extra = {}) {
  resetBlobs({
    "trip-tracker.json": { app: "vacation-location", version: 1, locations: [baseTrip] },
    "families.json": [family],
    "memberships.json": [],
    "family-shares.json": [],
    ...extra,
  });
}

test("trips rejects missing and malformed authentication principals before storage access", async () => {
  seed();
  assert.equal((await invoke(trips, request("GET"))).status, 401);
  const malformed = request("GET");
  malformed.headers["x-ms-client-principal"] = "not-base64-json";
  assert.equal((await invoke(trips, malformed)).status, 401);
});

test("GET isolates private family trips while preserving legacy public trips", async () => {
  seed({ "trip-tracker.json": { locations: [baseTrip, { id: "legacy", city: "Legacy" }, { id: "public", familyId: "fam-a", ownerEmail: "other@example.test", visibility: "all" }] } });
  const res = await invoke(trips, request("GET", "outsider@example.test"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.locations.map((trip) => trip.id), ["legacy", "public"]);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.visible, 2);
});

test("GET honors direct recipients, incoming family shares, and per-trip share hiding", async () => {
  seed({
    "trip-tracker.json": { locations: [
      { ...baseTrip, id: "direct", soloPrivate: true, sharedWith: ["recipient@example.test"] },
      { ...baseTrip, id: "shared" },
      { ...baseTrip, id: "hidden", hiddenFromShares: true },
    ] },
    "families.json": [family, { id: "fam-b", name: "Recipient Family", approved: true }],
    "memberships.json": [{ email: "recipient@example.test", familyId: "fam-b", role: "reader", active: true }],
    "family-shares.json": [{ fromFamilyId: "fam-a", toFamilyId: "fam-b", role: "reader" }],
  });
  const res = await invoke(trips, request("GET", "recipient@example.test"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.locations.map((trip) => trip.id), ["direct", "shared"]);
});

test("family owner can view and edit solo-private trips despite a reader membership", async () => {
  seed({
    "trip-tracker.json": { locations: [{ ...baseTrip, soloPrivate: true }] },
    "memberships.json": [{ email: "owner@example.test", familyId: "fam-a", role: "reader", active: true }],
  });
  const get = await invoke(trips, request("GET", "owner@example.test", { principal: { id: "different-id" } }));
  assert.deepEqual(get.body.locations.map((trip) => trip.id), ["trip-1"]);
  const edited = { ...get.body.locations[0], city: "Changed City" };
  const post = await invoke(trips, request("POST", "owner@example.test", { principal: { id: "different-id" }, body: { locations: [edited] } }));
  assert.equal(post.status, 200);
  assert.equal(readBlob("trip-tracker.json").locations[0].city, "Changed City");
});

test("ordinary family administrators cannot view another owner's solo-private trip", async () => {
  seed({
    "trip-tracker.json": { locations: [{ ...baseTrip, soloPrivate: true }] },
    "memberships.json": [{ email: "admin@example.test", familyId: "fam-a", role: "admin", active: true }],
  });
  const res = await invoke(trips, request("GET", "admin@example.test"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.locations, []);
});

test("incoming editor shares allow edits but not deletion by omission", async () => {
  seed({
    "families.json": [family, { id: "fam-b", name: "Recipient Family", approved: true }],
    "memberships.json": [{ email: "shared-editor@example.test", familyId: "fam-b", role: "editor", active: true }],
    "family-shares.json": [{ fromFamilyId: "fam-a", toFamilyId: "fam-b", role: "editor" }],
  });
  await invoke(trips, request("POST", "shared-editor@example.test", {
    body: { locations: [{ ...baseTrip, city: "Shared edit" }] },
  }));
  assert.equal(readBlob("trip-tracker.json").locations[0].city, "Shared edit");

  await invoke(trips, request("POST", "shared-editor@example.test", { body: { locations: [] } }));
  assert.equal(readBlob("trip-tracker.json").locations.length, 1);
});

test("reader cannot edit or delete another member's trip", async () => {
  seed({ "memberships.json": [{ email: "reader@example.test", familyId: "fam-a", role: "reader", active: true }] });
  const changed = { ...baseTrip, city: "Unauthorized change" };
  await invoke(trips, request("POST", "reader@example.test", { body: { locations: [changed] } }));
  assert.equal(readBlob("trip-tracker.json").locations[0].city, "Test City");
  await invoke(trips, request("POST", "reader@example.test", { body: { locations: [] } }));
  assert.equal(readBlob("trip-tracker.json").locations.length, 1);
});

test("editor can edit but omission does not delete a trip without delete permission", async () => {
  seed({ "memberships.json": [{ email: "editor@example.test", familyId: "fam-a", role: "editor", active: true }] });
  await invoke(trips, request("POST", "editor@example.test", { body: { locations: [{ ...baseTrip, city: "Edited" }] } }));
  assert.equal(readBlob("trip-tracker.json").locations[0].city, "Edited");
  await invoke(trips, request("POST", "editor@example.test", { body: { locations: [] } }));
  assert.equal(readBlob("trip-tracker.json").locations.length, 1);
});

test("admin membership can delete a family trip by omission", async () => {
  seed({ "memberships.json": [{ email: "admin@example.test", familyId: "fam-a", role: "admin", active: true }] });
  const res = await invoke(trips, request("POST", "admin@example.test", { body: { locations: [] } }));
  assert.equal(res.status, 200);
  assert.deepEqual(readBlob("trip-tracker.json").locations, []);
});

test("site administrator can retrieve all trips without family membership", async () => {
  const previous = process.env.SITE_ADMIN_EMAIL;
  process.env.SITE_ADMIN_EMAIL = "site-admin@example.test";
  seed({ "trip-tracker.json": { locations: [{ ...baseTrip, soloPrivate: true }] } });
  try {
    const res = await invoke(trips, request("GET", "site-admin@example.test", { principal: { roles: ["authenticated", "admin"] } }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.locations.map((trip) => trip.id), ["trip-1"]);
    assert.equal(res.body.me.siteAdmin, true);
  } finally {
    if (previous === undefined) delete process.env.SITE_ADMIN_EMAIL; else process.env.SITE_ADMIN_EMAIL = previous;
  }
});

test("new trips are assigned to an editable family and normalized before persistence", async () => {
  seed({
    "trip-tracker.json": { locations: [] },
    "memberships.json": [{ email: "editor@example.test", familyId: "fam-a", role: "editor", active: true }],
  });
  const input = { id: "new-trip", city: "New", visibility: "shared", sharedWith: [" Friend@Example.Test ", ""], hiddenFromShares: 1 };
  const res = await invoke(trips, request("POST", "editor@example.test", { principal: { id: "editor-id" }, body: { locations: [input] } }));
  assert.equal(res.status, 200);
  const stored = readBlob("trip-tracker.json");
  assert.equal(stored.app, "vacation-location");
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.locations[0], { ...input, familyId: "fam-a", owner: "editor-id", ownerEmail: "editor@example.test", visibility: "private", sharedWith: ["friend@example.test"], hiddenFromShares: true, soloPrivate: false });
});

test("new trips cannot be inserted into an unknown or unauthorized family", async () => {
  seed({
    "trip-tracker.json": { locations: [] },
    "families.json": [family, { id: "fam-b", name: "Other Family", approved: true }],
    "memberships.json": [{ email: "editor@example.test", familyId: "fam-a", role: "editor", active: true }],
  });
  const unauthorized = { id: "new-trip", familyId: "fam-b", city: "New" };
  assert.equal((await invoke(trips, request("POST", "editor@example.test", { body: { locations: [unauthorized] } }))).status, 403);
  assert.deepEqual(readBlob("trip-tracker.json").locations, []);

  const unknown = { ...unauthorized, familyId: "missing-family" };
  assert.equal((await invoke(trips, request("POST", "editor@example.test", { body: { locations: [unknown] } }))).status, 403);
  assert.deepEqual(readBlob("trip-tracker.json").locations, []);
});

test("missing, malformed, empty, and legacy array storage documents read safely", async (t) => {
  for (const [name, stored, expected] of [
    ["missing", undefined, []], ["malformed", "{bad", []], ["empty object", {}, []], ["legacy array", [{ id: "legacy" }], ["legacy"]],
  ]) {
    await t.test(name, async () => {
      resetBlobs({ "families.json": [], "memberships.json": [], ...(stored === undefined ? {} : { "trip-tracker.json": stored }) });
      const res = await invoke(trips, request("GET", "person@example.test"));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.locations.map((trip) => trip.id), expected);
    });
  }
});

test("elevated modes require a configured site administrator", async () => {
  seed();
  const payload = { locations: [{ id: "replacement", date: "2026-09-03", dateEnd: "2026-09-01" }], settings: { unit: "km" } };
  const familyAdmin = { principal: { roles: ["authenticated", "admin", "editor", "reader"] } };
  assert.equal((await invoke(trips, request("POST", "family-admin@example.test", { ...familyAdmin, query: { mode: "replace" }, body: payload }))).status, 403);
  assert.equal((await invoke(trips, request("POST", "family-admin@example.test", { ...familyAdmin, query: { mode: "assign" }, body: { id: "trip-1", ownerEmail: "new@example.test" } }))).status, 403);
  assert.equal((await invoke(trips, request("POST", "family-admin@example.test", { ...familyAdmin, query: { mode: "deleteUser" }, body: { email: "owner@example.test", deleteTrips: true } }))).status, 403);
});

test("site administrator elevated-mode payloads match frontend contracts", async () => {
  const previous = process.env.SITE_ADMIN_EMAIL;
  process.env.SITE_ADMIN_EMAIL = "site-admin@example.test";
  seed();
  const admin = { principal: { roles: ["authenticated", "admin", "editor", "reader"] } };
  try {
    const assigned = await invoke(trips, request("POST", "site-admin@example.test", { ...admin, query: { mode: "assign" }, body: { id: "trip-1", ownerEmail: "new@example.test" } }));
    assert.equal(assigned.status, 200);
    assert.equal(readBlob("trip-tracker.json").locations[0].ownerEmail, "new@example.test");

    const deleted = await invoke(trips, request("POST", "site-admin@example.test", { ...admin, query: { mode: "deleteUser" }, body: { email: "new@example.test", key: "traveler-1", deleteTrips: false } }));
    assert.equal(deleted.status, 200);
    assert.equal(readBlob("trip-tracker.json").locations[0].ownerEmail, "");

    const payload = { locations: [{ id: "replacement", date: "2026-09-03", dateEnd: "2026-09-01" }], settings: { unit: "km" } };
    const replaced = await invoke(trips, request("POST", "site-admin@example.test", { ...admin, query: { mode: "replace" }, body: payload }));
    assert.equal(replaced.status, 200);
    assert.deepEqual(readBlob("trip-tracker.json").locations, payload.locations);
    assert.deepEqual(readBlob("trip-tracker.json").settings, payload.settings);
  } finally {
    if (previous === undefined) delete process.env.SITE_ADMIN_EMAIL; else process.env.SITE_ADMIN_EMAIL = previous;
  }
});
