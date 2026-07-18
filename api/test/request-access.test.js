const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, readBlob, request, resetBlobs } = require("./helpers");
const requestAccess = require("../request-access");

test("access requests require POST and a syntactically valid email", async () => {
  resetBlobs();
  assert.equal((await invoke(requestAccess, request("GET"))).status, 405);
  const invalid = await invoke(requestAccess, request("POST", undefined, { body: { email: "not-an-email" } }));
  assert.equal(invalid.status, 400);
  assert.equal(readBlob("access-requests.json"), undefined);
});

test("access requests persist bounded normalized data without email configuration", async () => {
  const previous = [process.env.RESEND_API_KEY, process.env.RESEND_FROM, process.env.ACCESS_REQUEST_TO];
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.ACCESS_REQUEST_TO;
  resetBlobs({ "access-requests.json": [] });
  try {
    const res = await invoke(requestAccess, request("POST", undefined, {
      body: { email: " Person@Example.Test ", message: "x".repeat(2100), recipient: "attacker@example.test" },
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.persisted, true);
    const stored = readBlob("access-requests.json");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].email, "person@example.test");
    assert.equal(stored[0].message.length, 2000);
    assert.deepEqual(Object.keys(stored[0]).sort(), ["email", "message", "requestedAt"]);
  } finally {
    ["RESEND_API_KEY", "RESEND_FROM", "ACCESS_REQUEST_TO"].forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    });
  }
});

test("repeat access requests update one pending row instead of duplicating it", async () => {
  resetBlobs({ "access-requests.json": [{ email: "person@example.test", message: "old", requestedAt: "2020-01-01T00:00:00.000Z" }] });
  const res = await invoke(requestAccess, request("POST", undefined, {
    body: { email: "person@example.test", message: "updated" },
  }));
  assert.equal(res.status, 200);
  const stored = readBlob("access-requests.json");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].message, "updated");
});
