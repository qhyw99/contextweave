const assert = require("assert");
const path = require("path");

const architectureClient = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "cw_client.cjs"
));

const infographicClient = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-infographic",
  "scripts",
  "cw_client.cjs"
));

function runSharedAssertions(normalizeAssetResult) {
  const withHtml = normalizeAssetResult({
    delivery_file_type: "html",
    download_url: "https://example.com/diagram.html",
    svg_url: "https://example.com/diagram.html",
    raw_svg_url: "https://example.com/diagram.svg",
    html_url: "https://example.com/diagram.html",
    primary_asset_url: "https://example.com/diagram.html",
  });

  assert.strictEqual(withHtml.svg_url, "https://example.com/diagram.html");
  assert.strictEqual(withHtml.raw_svg_url, "https://example.com/diagram.svg");
  assert.strictEqual(withHtml.html_url, undefined);
  assert.strictEqual(withHtml.primary_asset_url, undefined);

  const svgOnly = normalizeAssetResult({
    delivery_file_type: "svg",
    download_url: "https://example.com/diagram.svg",
    svg_url: "https://example.com/diagram.svg",
    raw_svg_url: "https://example.com/diagram.svg",
  });

  assert.strictEqual(svgOnly.svg_url, "https://example.com/diagram.svg");
  assert.strictEqual(svgOnly.raw_svg_url, "https://example.com/diagram.svg");
}

runSharedAssertions(architectureClient.normalizeAssetResult);
runSharedAssertions(infographicClient.normalizeAssetResult);

console.log("normalize_asset_result_test passed");
