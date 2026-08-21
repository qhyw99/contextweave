const assert = require("assert");
const path = require("path");

const { SUPPORTED_FORMATS } = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "export_session_asset.cjs"
));

assert.deepStrictEqual(SUPPORTED_FORMATS, [
  "svg",
  "pptx",
  "pptx-svg",
  "pptx-native",
]);

console.log("export_session_asset_formats_test passed");
