const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const families = require("../families");

test("families requires authentication", async () => {
  resetBlobs();
  assert.equal((await invoke(families, request("GET"))).status, 401);
});

test("normal users see only their memberships and accessible family travelers", async () => {
  resetBlobs({
    "families.json": [{ id: "mine", name: "Mine" }, { id: "shared", name: "Shared" }, { id: "hidden", name: "Hidden" }],
    "memberships.json": [
      { email: "person@example.test", familyId: "mine", role: "reader", active: true },
      { email: "other@example.test", familyId: "hidden", role: "admin", active: true },
    ],
    "family-shares.json": [{ fromFamilyId: "shared", toFamilyId: "mine", role: "reader" }],
    "travelers.json": [{ key: "m", familyId: "mine" }, { key: "s", familyId: "shared" }, { key: "h", familyId: "hidden" }],
  });
  const res = await invoke(families, request("GET", "person@example.test"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.families.map((f) => f.id), ["mine", "shared"]);
  assert.deepEqual(res.body.memberships.map((m) => m.email), ["person@example.test"]);
  assert.deepEqual(res.body.travelers.map((t) => t.key), ["m", "s"]);
  assert.equal(res.body.siteAdmin, false);
  assert.equal(res.body.accessRequests, undefined);
});

test("family mutations enforce normal-user and site-admin authorization", async () => {
  resetBlobs({
    "families.json": [{ id: "mine", name: "Mine", approved: true }],
    "memberships.json": [{ email: "reader@example.test", familyId: "mine", role: "reader", active: true }],
  });
  const denied = await invoke(families, request("POST", "reader@example.test", { body: { action: "rename", familyId: "mine", name: "Changed" } }));
  assert.equal(denied.status, 403);
  const siteDenied = await invoke(families, request("POST", "reader@example.test", { body: { action: "setAutoApprove", value: true } }));
  assert.equal(siteDenied.status, 403);
});

test("family administrators can invite normalized members but readers cannot", async () => {
  resetBlobs({
    "families.json": [{ id: "mine", name: "Mine", approved: true }],
    "memberships.json": [
      { email: "admin@example.test", familyId: "mine", role: "admin", active: true },
      { email: "reader@example.test", familyId: "mine", role: "reader", active: true },
    ],
  });
  const denied = await invoke(families, request("POST", "reader@example.test", {
    body: { action: "invitePerson", familyId: "mine", email: "person@example.test", role: "editor" },
  }));
  assert.equal(denied.status, 403);

  const invited = await invoke(families, request("POST", "admin@example.test", {
    body: { action: "invitePerson", familyId: "mine", email: " Person@Example.Test ", role: "unexpected" },
  }));
  assert.equal(invited.status, 200);
  assert.deepEqual(readBlob("memberships.json").find((row) => row.email === "person@example.test"), {
    email: "person@example.test", familyId: "mine", role: "reader", active: true,
    createdAt: readBlob("memberships.json").find((row) => row.email === "person@example.test").createdAt,
  });
});

test("pending families cannot invite people until a site administrator approves them", async () => {
  resetBlobs({
    "families.json": [{ id: "pending", name: "Pending", approved: false }],
    "memberships.json": [{ email: "admin@example.test", familyId: "pending", role: "admin", active: true }],
  });
  const res = await invoke(families, request("POST", "admin@example.test", {
    body: { action: "invitePerson", familyId: "pending", email: "person@example.test", role: "reader" },
  }));
  assert.equal(res.status, 403);
  assert.equal(readBlob("memberships.json").some((row) => row.email === "person@example.test"), false);
});
