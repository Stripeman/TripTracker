const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, resetBlobs } = require("./helpers");
const roles = require("../roles");

test("roles grants the highest active family role and ignores inactive memberships", async () => {
  resetBlobs({ "memberships.json": [
    { email: "person@example.test", familyId: "one", role: "reader", active: true },
    { email: "person@example.test", familyId: "two", role: "editor", active: true },
    { email: "person@example.test", familyId: "three", role: "admin", active: false },
  ] });
  const res = await invoke(roles, { body: { userDetails: " PERSON@EXAMPLE.TEST " } });
  assert.equal(res.status, 200);
  assert.deepEqual(new Set(res.body.roles), new Set(["editor", "reader"]));
});

test("roles falls back to the legacy access list only when memberships are absent", async () => {
  resetBlobs({ "access-list.json": { list: [{ email: "legacy@example.test", role: "admin", active: true }] } });
  const res = await invoke(roles, { body: { userDetails: "legacy@example.test" } });
  assert.deepEqual(new Set(res.body.roles), new Set(["admin", "editor", "reader"]));
});

test("configured primary site administrators receive the full role hierarchy", async () => {
  const previous = process.env.SITE_ADMIN_EMAIL;
  process.env.SITE_ADMIN_EMAIL = "owner@example.test";
  resetBlobs({ "memberships.json": [] });
  const res = await invoke(roles, { body: { userDetails: "OWNER@example.test" } });
  if (previous === undefined) delete process.env.SITE_ADMIN_EMAIL; else process.env.SITE_ADMIN_EMAIL = previous;
  assert.deepEqual(new Set(res.body.roles), new Set(["admin", "editor", "reader"]));
});
