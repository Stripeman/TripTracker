const test = require("node:test");
const assert = require("node:assert/strict");
const { invoke, request, resetBlobs } = require("./helpers");
const siteSettings = require("../site-settings");

test("public site settings use safe defaults for missing and malformed storage", async () => {
  for (const stored of [undefined, "{bad"]) {
    resetBlobs(stored === undefined ? {} : { "family-settings.json": stored });
    const res = await invoke(siteSettings, request("GET"));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { landingVariant: "signin", showPricingSection: false, showTestimonials: false, testimonials: [] });
  }
});

test("public site settings expose only bounded landing-page fields", async () => {
  resetBlobs({ "family-settings.json": {
    landingVariant: "b", showPricingSection: 1, showTestimonials: true,
    secretInvitationUrl: "synthetic-sensitive-value",
    testimonials: [{ quote: "q".repeat(600), name: "n".repeat(100), family: "f".repeat(100), email: "private@example.test" }],
  } });
  const res = await invoke(siteSettings, request("GET"));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["landingVariant", "showPricingSection", "showTestimonials", "testimonials"].sort());
  assert.deepEqual(Object.keys(res.body.testimonials[0]).sort(), ["family", "name", "quote"]);
  assert.equal(res.body.testimonials[0].quote.length, 500);
  assert.equal(res.body.testimonials[0].name.length, 80);
  assert.equal(res.body.testimonials[0].family.length, 80);
});
