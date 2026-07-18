const test = require("node:test");
const assert = require("node:assert/strict");
const { failBlob, invoke, request, resetBlobs } = require("./helpers");

const cases = [
  { name: "access", handler: require("../access"), blob: "access-list.json", req: () => request("GET", "admin@example.test", { principal: { roles: ["authenticated", "admin"] } }) },
  { name: "attachments", handler: require("../attachments"), blob: "trip-tracker.json", req: () => request("GET", "person@example.test", { query: { tripId: "trip-1", id: "attachment-1" } }) },
  { name: "families", handler: require("../families"), blob: "families.json", req: () => request("GET", "person@example.test") },
  { name: "presence", handler: require("../presence"), blob: "presence.json", req: () => request("GET", "person@example.test") },
  { name: "trips", handler: require("../trips"), blob: "trip-tracker.json", req: () => request("GET", "person@example.test") },
];

for (const item of cases) {
  test(`${item.name} does not disclose storage exception details`, async () => {
    const sensitiveDetail = "synthetic-storage-key-and-private-trip-data";
    resetBlobs({ [item.blob]: {} });
    failBlob("download", item.blob, sensitiveDetail);

    const res = await invoke(item.handler, item.req());

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Internal server error." });
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(sensitiveDetail));
    assert.equal(res.errors.length, 1, "the original failure must remain available to server diagnostics");
    assert.match(String(res.errors[0][0]), new RegExp(sensitiveDetail));
  });
}

test("request-access does not disclose email provider exception details", async () => {
  const sensitiveDetail = "synthetic-email-token-and-private-request-data";
  const previousFetch = global.fetch;
  const previousEnv = [process.env.RESEND_API_KEY, process.env.RESEND_FROM, process.env.ACCESS_REQUEST_TO];
  process.env.RESEND_API_KEY = "synthetic-test-key";
  process.env.RESEND_FROM = "sender@example.test";
  process.env.ACCESS_REQUEST_TO = "recipient@example.test";
  global.fetch = async () => { throw new Error(sensitiveDetail); };
  resetBlobs({ "access-requests.json": [] });
  failBlob("download", "access-requests.json", "synthetic-storage-failure");

  try {
    const res = await invoke(require("../request-access"), request("POST", undefined, { body: { email: "person@example.test" } }));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Internal server error." });
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(sensitiveDetail));
    assert.match(String(res.errors[0][0]), new RegExp(sensitiveDetail));
  } finally {
    global.fetch = previousFetch;
    ["RESEND_API_KEY", "RESEND_FROM", "ACCESS_REQUEST_TO"].forEach((name, index) => {
      if (previousEnv[index] === undefined) delete process.env[name]; else process.env[name] = previousEnv[index];
    });
  }
});
