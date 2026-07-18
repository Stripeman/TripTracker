const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const attachments = require("../attachments");

const trip = {
  id: "trip-1", familyId: "fam-a", owner: "owner-id", ownerEmail: "owner@example.test",
  city: "Synthetic City", visibility: "private", attachments: [],
};

function seed(extra = {}) {
  resetBlobs({
    "trip-tracker.json": { locations: [trip] },
    "families.json": [{ id: "fam-a", createdBy: "owner@example.test", approved: true }],
    "memberships.json": [],
    ...extra,
  });
}

test("attachment upload requires authentication, an allowed type, and trip edit access", async () => {
  seed();
  assert.equal((await invoke(attachments, request("POST", undefined, { body: {} }))).status, 401);

  const unsupported = await invoke(attachments, request("POST", "owner@example.test", {
    principal: { id: "owner-id" },
    body: { tripId: "trip-1", filename: "script.html", mimeType: "text/html", dataBase64: "dGVzdA==" },
  }));
  assert.equal(unsupported.status, 400);

  seed({ "memberships.json": [{ email: "reader@example.test", familyId: "fam-a", role: "reader", active: true }] });
  const denied = await invoke(attachments, request("POST", "reader@example.test", {
    body: { tripId: "trip-1", filename: "ticket.pdf", mimeType: "application/pdf", dataBase64: "dGVzdA==" },
  }));
  assert.equal(denied.status, 403);
  assert.deepEqual(readBlob("trip-tracker.json").locations[0].attachments, []);
});

test("trip owner upload stores sanitized metadata and uploader can later delete it", async () => {
  seed();
  const uploaded = await invoke(attachments, request("POST", "owner@example.test", {
    principal: { id: "owner-id" },
    body: { tripId: "trip-1", filename: "ticket/<unsafe>.pdf", mimeType: "application/pdf", dataBase64: "c3ludGhldGlj" },
  }));
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.attachment.name, "ticket_unsafe_.pdf");
  assert.equal(uploaded.body.attachment.size, 9);
  assert.match(uploaded.body.attachment.blobName, /^attachments\/trip-1\/att-[\w-]+-ticket_unsafe_\.pdf$/);
  assert.equal(readBlob("trip-tracker.json").locations[0].attachments.length, 1);

  seed({ "trip-tracker.json": { locations: [{ ...trip, attachments: [uploaded.body.attachment] }] } });
  const removed = await invoke(attachments, request("POST", "owner@example.test", {
    principal: { id: "different-id", roles: ["authenticated", "reader"] },
    body: { action: "delete", tripId: "trip-1", id: uploaded.body.attachment.id },
  }));
  assert.equal(removed.status, 200);
  assert.deepEqual(readBlob("trip-tracker.json").locations[0].attachments, []);
});

test("shared-family readers cannot download attachments hidden by family policy", async () => {
  const attachment = { id: "att-1", name: "ticket.pdf", mimeType: "application/pdf", blobName: "attachments/trip-1/att-1-ticket.pdf" };
  seed({
    "trip-tracker.json": { locations: [{ ...trip, attachments: [attachment] }] },
    "families.json": [
      { id: "fam-a", createdBy: "owner@example.test", approved: true, permTrip: { attachVisibleShared: false } },
      { id: "fam-b", createdBy: "recipient@example.test", approved: true },
    ],
    "memberships.json": [{ email: "recipient@example.test", familyId: "fam-b", role: "reader", active: true }],
    "family-shares.json": [{ fromFamilyId: "fam-a", toFamilyId: "fam-b", role: "reader" }],
    [attachment.blobName]: Buffer.from("synthetic file"),
  });
  const res = await invoke(attachments, request("GET", "recipient@example.test", {
    query: { tripId: "trip-1", id: "att-1" },
  }));
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "This family has kept attachments private.");
});
