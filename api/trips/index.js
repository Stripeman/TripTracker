const { BlobServiceClient } = require("@azure/storage-blob");

// Reads/writes a single JSON document (the whole Trip Tracker dataset) to Blob Storage.
// App settings required on the Static Web App / Function:
//   AZURE_STORAGE_CONNECTION_STRING  — connection string of your storage account
// Optional:
//   TRIPS_CONTAINER (default "data")  TRIPS_BLOB (default "trip-tracker.json")

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const BLOB = process.env.TRIPS_BLOB || "trip-tracker.json";

function clientPrincipal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}

async function getContainer() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  return container;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  };

  try {
    const container = await getContainer();
    const blob = container.getBlockBlobClient(BLOB);

    if (req.method === "GET") {
      if (!(await blob.exists())) { json(204); return; }
      const dl = await blob.download();
      const text = await streamToString(dl.readableStreamBody);
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: text,
      };
      return;
    }

    // POST / PUT — write. Requires an authenticated user (also enforced by routes).
    if (!clientPrincipal(req)) { json(401, { error: "Sign in required to save." }); return; }

    let payload = req.body;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    if (!payload || !Array.isArray(payload.locations)) { json(400, { error: "Expected { locations: [...] }" }); return; }

    const text = JSON.stringify(payload, null, 2);
    await blob.upload(text, Buffer.byteLength(text), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
    json(200, { ok: true, count: payload.locations.length });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String(err && err.message || err) });
  }
};
