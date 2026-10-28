const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const variants = ["interactive-architecture-diagram", "interactive-architecture-diagram-pay", "interactive-architecture-diagram-workbuddy"];
const html = Buffer.from('<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><text>草稿</text></svg></body></html>');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>草稿</text></svg>');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-html-assets-"));
  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
  const proxies = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  proxyKeys.forEach(key => delete process.env[key]);
  const receipt = "a".repeat(32), artifactId = "b".repeat(32), svgId = "c".repeat(32);
  const artifactPath = `/requests/${receipt}/artifacts/${artifactId}`;
  const svgPath = `/requests/${receipt}/artifacts/${svgId}`;
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith("/missing")) { res.writeHead(404); return res.end(); }
    if ([artifactPath, svgPath].includes(req.url)) {
      assert.equal(req.headers["x-api-key"], "test-key");
      assert.equal(req.headers["x-receipt-token"], "test-token");
    } else {
      assert.equal(req.headers["x-api-key"], undefined, "public asset downloads must not receive API credentials");
      assert.equal(req.headers["x-receipt-token"], undefined);
    }
    const body = req.url.startsWith("/diagram.svg") || req.url === svgPath ? svg : html;
    res.writeHead(200, { "Content-Type": body === svg ? "image/svg+xml" : "text/html" });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const variant of variants) {
      const scripts = path.join(__dirname, "../skills", variant, "scripts");
      const { normalizeAssetResult, downloadAssetsLocally } = require(path.join(scripts, "cw_client.cjs"));
      const urls = { html_url: `${origin}/diagram.html?signature=x`, svg_url: `${origin}/diagram.svg?signature=x`, raw_svg_url: `${origin}/diagram.svg?signature=x` };
      for (const delivery of ["draft", "final"]) {
        const result = normalizeAssetResult({ status: "ok", quality: delivery === "draft" ? "rejected" : "accepted", delivery,
          ...urls, output_dir: temp, output_name: `${variant}-${delivery}` });
        assert.equal(result.html_url, urls.html_url, `${variant} must retain HTML URL`);
        await downloadAssetsLocally(result);
        assert.deepEqual(fs.readFileSync(result.saved_html_file), html);
        assert.deepEqual(fs.readFileSync(result.saved_svg_file), svg);
        assert.notEqual(result.saved_html_file, result.saved_svg_file);
        assert.equal(result.quality, delivery === "draft" ? "rejected" : "accepted");
      }
      const legacy = normalizeAssetResult({ status: "ok", svg_url: urls.html_url, raw_svg_url: urls.raw_svg_url,
        output_dir: temp, output_name: `${variant}-legacy` });
      await downloadAssetsLocally(legacy);
      assert.deepEqual(fs.readFileSync(legacy.saved_html_file), html, "legacy HTML primary must also download");
      assert.deepEqual(fs.readFileSync(legacy.saved_svg_file), svg);

      const htmlOnly = { status: "error", html_url: `${origin}/html-without-extension`, output_dir: temp, output_name: `${variant}-html-only` };
      await downloadAssetsLocally(htmlOnly);
      assert.deepEqual(fs.readFileSync(htmlOnly.saved_html_file), html, "HTML must survive failed overall status");
      assert.equal(htmlOnly.saved_svg_file, undefined, "HTML must not be reported as an SVG file");

      const inline = { status: "error", quality: "rejected", delivery: "draft",
        html_content: html.toString("utf8"), svg_content: svg.toString("utf8"),
        output_dir: temp, output_name: `${variant}-inline` };
      const hitsBeforeInline = hits.length;
      await downloadAssetsLocally(inline);
      assert.deepEqual(fs.readFileSync(inline.saved_html_file), html, "non-ledger routes must save inline HTML");
      assert.deepEqual(fs.readFileSync(inline.saved_svg_file), svg);
      assert.equal(hits.length, hitsBeforeInline, "inline delivery must not request another network resource");
      assert.equal(inline.html_content, undefined, "large inline files should not remain in CLI output after saving");
      assert.equal(inline.svg_content, undefined);

      const mixed = { status: "ok", html_url: `${origin}/missing.html`, html_content: html.toString("utf8"),
        svg_content: svg.toString("utf8"), output_dir: temp, output_name: `${variant}-inline-mixed` };
      await downloadAssetsLocally(mixed);
      assert.equal(mixed.saved_html_file, undefined, "failed URL must not be hidden by a fallback to inline HTML");
      assert.deepEqual(fs.readFileSync(mixed.saved_svg_file), svg);

      const partial = { status: "ok", ...urls, html_url: `${origin}/missing.html`, output_dir: temp, output_name: `${variant}-partial` };
      await downloadAssetsLocally(partial);
      assert.equal(partial.saved_html_file, undefined);
      assert.deepEqual(fs.readFileSync(partial.saved_svg_file), svg, "one asset failure must not suppress another");
      assert(partial.warnings.some(w => /HTML.*下载失败/.test(w)));

      const client = { baseUrl: origin, headers: () => ({ "X-API-Key": "test-key" }) };
      const privateUrls = { status: "error", quality: "rejected", delivery: "draft", html_url: artifactPath, svg_url: svgPath,
        output_dir: temp, output_name: `${variant}-private-urls` };
      await downloadAssetsLocally(privateUrls, client, "test-token");
      assert.deepEqual(fs.readFileSync(privateUrls.saved_html_file), html);
      assert.deepEqual(fs.readFileSync(privateUrls.saved_svg_file), svg);
      const withoutAuth = { ...privateUrls, saved_html_file: undefined, saved_svg_file: undefined, warnings: [], output_name: `${variant}-missing-auth` };
      await downloadAssetsLocally(withoutAuth);
      assert.equal(withoutAuth.saved_html_file, undefined);
      assert.equal(withoutAuth.saved_svg_file, undefined);
      assert.equal(withoutAuth.warnings.length, 2);

      const publicWithAuth = { status: "ok", ...urls, output_dir: temp, output_name: `${variant}-public-with-auth` };
      await downloadAssetsLocally(publicWithAuth, client, "test-token");

      if (!variant.endsWith("-pay")) {
        const protectedResult = { status: "error", quality: "rejected", delivery: "draft", output_dir: temp, output_name: `${variant}-protected`,
          artifacts: [{ id: artifactId, available: true, editable: false, kind: "preview", format: "html", download_path: artifactPath,
            bytes: html.length, sha256: crypto.createHash("sha256").update(html).digest("hex") }] };
        await downloadAssetsLocally(protectedResult, client, "test-token");
        assert.equal(protectedResult.saved_artifacts[0].format, "html");
        assert.equal(path.extname(protectedResult.saved_artifacts[0].file_path), ".html");
        assert.deepEqual(fs.readFileSync(protectedResult.saved_artifacts[0].file_path), html);

        const corrupt = { status: "error", html_url: artifactPath, output_dir: temp, output_name: `${variant}-corrupt`,
          artifacts: [{ ...protectedResult.artifacts[0], sha256: "0".repeat(64) }] };
        await downloadAssetsLocally(corrupt, client, "test-token");
        assert.equal(corrupt.saved_artifacts.length, 0);
        assert.equal(corrupt.saved_html_file, undefined, "HTML alias must not bypass artifact integrity checks");
        assert(!fs.existsSync(path.join(temp, `${variant}-corrupt.html`)));
      }

      const { main: generate } = require(path.join(scripts, "generate_contextweave.cjs"));
      class Client {
        async runGeneration() { return { status: "ok", session_id: "root", choices: [
          { status: "ok", session_id: "draft", quality: "rejected", delivery: "draft", cw_code: "a -> b", ...urls },
          { status: "ok", session_id: "final", quality: "accepted", delivery: "final", cw_code: "b -> c", ...urls },
          { status: "ok", session_id: "inline", quality: "rejected", delivery: "draft", cw_code: "c -> d",
            html_content: html.toString("utf8"), svg_content: svg.toString("utf8") },
        ] }; }
      }
      let printed = "";
      const write = process.stdout.write;
      process.stdout.write = chunk => { printed += chunk; return true; };
      try { await generate(["--user_request", "绘制完整连线图", "--output_name", `${variant}-choices`, "--output_dir", temp], Client); }
      finally { process.stdout.write = write; }
      const generated = JSON.parse(printed);
      for (const choice of generated.choices) {
        assert.deepEqual(fs.readFileSync(choice.saved_html_file), html);
        assert.deepEqual(fs.readFileSync(choice.saved_svg_file), svg);
        assert.match(fs.readFileSync(choice.saved_cw_file, "utf8"), new RegExp(`# session_id: ${choice.session_id}`));
        assert.equal(choice.html_content, undefined);
        assert.equal(choice.svg_content, undefined);
      }
    }
    assert(hits.includes("/diagram.html?signature=x"), "the actual HTML URL must be downloaded");
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(proxies)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("HTML, SVG, CW and protected HTML deliveries verified for standard, paid and WorkBuddy clients.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
