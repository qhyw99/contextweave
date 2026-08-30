const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { downloadAssetsLocally } = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "cw_client.cjs"
));

async function main() {
  const payload = Buffer.from("native-vsdx-test");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/vnd.ms-visio.drawing" });
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-vsdx-test-"));
  try {
    const address = server.address();
    const result = await downloadAssetsLocally({
      status: "ok",
      format: "vsdx-native",
      session_id: "vsdx-test",
      output_name: "native-diagram",
      output_dir: outputDir,
      download_url: `http://127.0.0.1:${address.port}/native-diagram.vsdx`,
    });

    assert.strictEqual(result.saved_vsdx_file, path.join(outputDir, "native-diagram.vsdx"));
    assert.deepStrictEqual(fs.readFileSync(result.saved_vsdx_file), payload);
    assert.match(result.message, /VSDX/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log("cw_client_vsdx_download_test passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
