const assert = require("assert");
const path = require("path");

const { FORMAT_MAP, SUPPORTED_FORMATS, resolveFormat } = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "export_session_asset.cjs"
));

assert.deepStrictEqual(SUPPORTED_FORMATS, [
  "svg",
  "vsdx",
  "vsdx-native",
  "pptx",
  "pptx-native",
  "pptx-svg",
  "pptx-legacy",
]);
assert.deepStrictEqual(FORMAT_MAP, {
  svg: "svg",
  vsdx: "vsdx-native",
  "vsdx-native": "vsdx-native",
  pptx: "pptx-native",
  "pptx-native": "pptx-native",
  "pptx-svg": "pptx-svg",
  "pptx-legacy": "pptx",
});
assert.strictEqual(resolveFormat("pptx"), "pptx-native");
assert.strictEqual(resolveFormat("pptx-native"), "pptx-native");
assert.strictEqual(resolveFormat("pptx-svg"), "pptx-svg");
assert.strictEqual(resolveFormat("pptx-legacy"), "pptx");
assert.strictEqual(resolveFormat("vsdx"), "vsdx-native");
assert.strictEqual(resolveFormat("vsdx-native"), "vsdx-native");
assert.strictEqual(resolveFormat("svg"), "svg");
assert.strictEqual(resolveFormat("unknown"), null);

console.log("export_session_asset_formats_test passed");
