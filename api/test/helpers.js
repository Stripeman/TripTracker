const Module = require("node:module");
const { Readable } = require("node:stream");

const blobs = new Map();
const blobFailures = new Map();

function throwBlobFailure(operation, name) {
  const error = blobFailures.get(`${operation}:${name}`);
  if (error) throw error;
}

function blobClient(name) {
  return {
    async exists() { return blobs.has(name); },
    async download() {
      throwBlobFailure("download", name);
      if (!blobs.has(name)) { const error = new Error("not found"); error.statusCode = 404; throw error; }
      const value = blobs.get(name);
      return { readableStreamBody: Readable.from([value]), etag: '"test-etag"' };
    },
    async upload(value) { throwBlobFailure("upload", name); blobs.set(name, Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value))); },
    async deleteIfExists() { throwBlobFailure("delete", name); return { succeeded: blobs.delete(name) }; },
  };
}

const container = {
  async createIfNotExists() {},
  getBlockBlobClient: blobClient,
};

const azureMock = {
  BlobServiceClient: {
    fromConnectionString() { return { getContainerClient() { return container; } }; },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@azure/storage-blob") return azureMock;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.AZURE_STORAGE_CONNECTION_STRING = "synthetic-test-connection";

function resetBlobs(initial = {}) {
  blobs.clear();
  blobFailures.clear();
  for (const [name, value] of Object.entries(initial)) {
    const text = Buffer.isBuffer(value) ? value : (typeof value === "string" ? value : JSON.stringify(value));
    blobs.set(name, Buffer.from(text));
  }
}

function failBlob(operation, name, message) {
  blobFailures.set(`${operation}:${name}`, new Error(message));
}

function readBlob(name) {
  const value = blobs.get(name);
  if (!value) return undefined;
  return JSON.parse(value.toString("utf8"));
}

function principal(email, { id = "user-1", roles = ["authenticated", "reader", "editor"] } = {}) {
  return Buffer.from(JSON.stringify({ userId: id, userDetails: email, userRoles: roles })).toString("base64");
}

function request(method, email, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (email) headers["x-ms-client-principal"] = principal(email, options.principal || {});
  return { method, headers, query: options.query || {}, body: options.body };
}

async function invoke(handler, req) {
  const errors = [];
  const context = { log: { error(...args) { errors.push(args); } } };
  await handler(context, req);
  const res = context.res;
  let body = res && res.body;
  if (typeof body === "string" && (res.headers || {})["Content-Type"] === "application/json") body = JSON.parse(body);
  return { ...res, body, errors };
}

module.exports = { failBlob, invoke, principal, readBlob, request, resetBlobs };
