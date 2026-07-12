const { BlobServiceClient } = require("@azure/storage-blob");
const { checkRateLimit } = require("../_shared/rateLimit");

// PUBLIC, anonymous, read-only settings for pre-sign-in pages (the landing page).
// Deliberately exposes only non-sensitive fields — never trip data, emails, or
// anything that requires a role. Everything else stays behind /api/families.
//
// GET → { landingVariant: "signin"|"a"|"b"|"c", showPricingSection: boolean, showTestimonials: boolean, testimonials: [{quote,name,family}] }
// "signin" = skip the landing page entirely; unauthenticated visitors go straight to the sign-in prompt (previous/default behavior).

const CONTAINER = process.env.TRIPS_CONTAINER || "data";

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }, body: JSON.stringify(body) };
  };
  try {
    // Anonymous route — rate-limit by a coarse bucket (no principal to key off).
    const rl = checkRateLimit("site-settings", { max: 600, windowMs: 60000 });
    if (!rl.ok) { json(429, { error: "Too many requests." }); return; }

    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) { json(200, { landingVariant: "signin", showPricingSection: false, showTestimonials: false, testimonials: [] }); return; }
    const svc = BlobServiceClient.fromConnectionString(conn);
    const container = svc.getContainerClient(CONTAINER);
    const blob = container.getBlockBlobClient("family-settings.json");
    if (!(await blob.exists())) { json(200, { landingVariant: "signin", showPricingSection: false, showTestimonials: false, testimonials: [] }); return; }
    const dl = await blob.download();
    const text = await streamToString(dl.readableStreamBody);
    let settings = {};
    try { settings = JSON.parse(text); } catch (e) { settings = {}; }
    json(200, {
      landingVariant: ["signin", "a", "b", "c"].includes(settings.landingVariant) ? settings.landingVariant : "signin",
      showPricingSection: !!settings.showPricingSection,
      showTestimonials: !!settings.showTestimonials,
      testimonials: Array.isArray(settings.testimonials) ? settings.testimonials.slice(0, 12).map((t) => ({
        quote: String(t.quote || "").slice(0, 500),
        name: String(t.name || "").slice(0, 80),
        family: String(t.family || "").slice(0, 80),
      })) : [],
    });
  } catch (err) {
    json(200, { landingVariant: "signin", showPricingSection: false, showTestimonials: false, testimonials: [] });
  }
};
