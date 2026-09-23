const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const variants = ["interactive-architecture-diagram", "interactive-architecture-diagram-pay", "interactive-architecture-diagram-pptx", "interactive-architecture-diagram-workbuddy"];
const capabilities = { authoring: { versions: [1], formats: ["json", "html"], kinds: ["swimlane", "cards", "matrix"] } };
const source = { kind: "cards", title: "能力", items: [{ id: "order", title: "订单管理" }] };
let temporary, jsonFile, htmlFile, server, origin;
const requests = [];

before(async () => {
  temporary = fs.mkdtempSync(path.join(root, ".authoring-test-"));
  jsonFile = path.join(temporary, "cards.json");
  htmlFile = path.join(temporary, "cards.html");
  fs.writeFileSync(jsonFile, JSON.stringify(source));
  fs.writeFileSync(htmlFile, '<main data-kind="cards" data-title="能力"><p id="order">订单管理</p></main>');
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("content-type", req.url === "/capabilities" ? "application/json" : "image/svg+xml");
    res.end(req.url === "/capabilities" ? JSON.stringify(capabilities) : "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
});

for (const variant of variants) {
  const folder = path.join(root, "skills", variant, "scripts");
  const { CWClient } = require(path.join(folder, "cw_client.cjs"));
  test(`${variant}: JSON/HTML compile payload preserves transport and export defaults`, async () => {
    const client = new CWClient();
    let checks = 0;
    client.getCapabilities = async () => { checks++; return capabilities; };
    const captured = [];
    client.request = async (endpoint, payload, options) => { captured.push({ endpoint, payload, options }); return { status: "ok" }; };
    for (const filename of [jsonFile, htmlFile]) {
      const result = await client.runGeneration({ authoringFile: filename, sessionId: "edit-id", validateRequestLength: true, basePalette: { primary: "#123456" } });
      assert.equal(result.status, "ok");
    }
    assert.equal(checks, 2);
    assert.deepEqual(captured[0].payload.authoring, { version: 1, format: "json", source });
    assert.equal(captured[1].payload.authoring.format, "html");
    assert.equal(captured[1].payload.authoring.source, fs.readFileSync(htmlFile, "utf8"));
    for (const { endpoint, payload, options } of captured) {
      assert.equal(payload.session_id, "edit-id");
      assert.equal(payload.include_source, false);
      assert.deepEqual(payload.base_palette, { primary: "#123456" });
      for (const field of ["user_request", "initial_cw_code", "enable_plan", "input_sequence", "test_file"]) assert.equal(field in payload, false, field);
      assert.equal(JSON.stringify(payload).includes(temporary), false);
      assert.equal(payload.export_pptx, variant.endsWith("-pptx"));
      assert.equal(payload.export_svg, !variant.endsWith("-pptx"));
      if (variant.endsWith("-pay")) {
        assert.match(endpoint, /^\/a2m\/run\?request_id=/);
        assert.equal(new URL(endpoint, origin).searchParams.get("request_id"), options.requestId);
      } else assert.equal(endpoint, "/run");
      if (variant.endsWith("-workbuddy")) assert.equal(payload.wrap_svg_in_html, false);
    }
  });

  test(`${variant}: incompatible options and capability absence never submit /run`, async () => {
    const client = new CWClient();
    client.request = async () => { assert.fail("must not submit generation"); };
    client.getCapabilities = async () => capabilities;
    for (const conflict of [{ userRequest: "duplicate" }, { inputFile: jsonFile }, { outlineFile: jsonFile }, { inputSequence: [] }, { enablePlan: true }, { diagramStyle: "logic" }, { morphology: "flow" }, { diagramType: "general" }, { accentTargets: [] }, { n: 2 }, { topK: 2 }]) {
      const result = await client.runGeneration({ authoringFile: jsonFile, ...conflict });
      assert.equal(result.error.code, "AUTHORING_OPTION_CONFLICT", JSON.stringify(conflict));
    }
    client.getCapabilities = async () => ({ authoring: { ...capabilities.authoring, versions: [2] } });
    assert.equal((await client.runGeneration({ authoringFile: jsonFile })).error.code, "AUTHORING_UNSUPPORTED");
    client.getCapabilities = async () => ({ status: "error", error: { code: "API_ERROR", message: "unavailable" } });
    assert.equal((await client.runGeneration({ authoringFile: jsonFile })).error.code, "API_ERROR");
  });

  test(`${variant}: generate/edit CLI do not silently ignore unsupported structured options`, () => {
    for (const script of ["generate_contextweave.cjs", "edit_contextweave.cjs"]) {
      const result = spawnSync(process.execPath, [path.join(folder, script), "--authoring_file", jsonFile, "--session_id", "edit", "--morphology", "flow"], { encoding: "utf8", cwd: root });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "AUTHORING_OPTION_CONFLICT");
    }
  });

  test(`${variant}: capability transport uses GET`, async () => {
    const client = new CWClient();
    client.baseUrl = origin;
    client.validateBaseUrl = () => null;
    const env = {};
    for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]) { env[key] = process.env[key]; delete process.env[key]; }
    try { assert.deepEqual(await client.getCapabilities(), capabilities); }
    finally { for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.deepEqual(requests.at(-1), { method: "GET", url: "/capabilities" });
  });

  test(`${variant}: export recovers model without source and does not print it`, async () => {
    const client = new CWClient();
    client.request = async (endpoint, payload) => {
      assert.equal(endpoint, "/session/export");
      assert.deepEqual(payload, { session_id: "existing", include_source: false });
      return { status: "ok", authoring_model: source };
    };
    const result = await client.exportCode("existing", path.join(temporary, variant), "authoring");
    assert.equal(result.status, "ok");
    assert.deepEqual(JSON.parse(fs.readFileSync(result.saved_authoring_file)), source);
    assert.equal("authoring_model" in result, false);
    assert.equal(fs.existsSync(path.join(temporary, variant, "diagram.cw")), false);
  });
}

test("authoring file validation rejects unsupported/large/invalid input before capability lookup", async () => {
  const { readAuthoringFile, MAX_AUTHORING_BYTES } = require(path.join(root, "skills", variants[0], "scripts/authoring.cjs"));
  assert.equal(readAuthoringFile("relative.json").error.code, "AUTHORING_FILE_NOT_ABSOLUTE");
  assert.equal(readAuthoringFile(temporary).error.code, "AUTHORING_FILE_NOT_REGULAR");
  const invalid = path.join(temporary, "invalid.json");
  fs.writeFileSync(invalid, "{");
  assert.equal(readAuthoringFile(invalid).error.code, "INVALID_AUTHORING_JSON");
  fs.writeFileSync(invalid, "x".repeat(MAX_AUTHORING_BYTES + 1));
  assert.equal(readAuthoringFile(invalid).error.code, "AUTHORING_FILE_TOO_LARGE");
});

test("generation and edit save stable model/source to disk without expanded output or stage2", async () => {
  const folder = path.join(root, "skills", variants[0], "scripts");
  const { main: generate } = require(path.join(folder, "generate_contextweave.cjs"));
  const { main: edit } = require(path.join(folder, "edit_contextweave.cjs"));
  let captured;
  class FakeClient {
    async request(endpoint, payload) {
      if (endpoint === "/run") { assert.equal("stage_execution" in payload, false); return; }
      assert.equal(endpoint, "/session/export");
      return { status: "ok", cw_code: "expanded: source" };
    }
    async runGeneration(options) {
      captured = options;
      await this.request("/run", { authoring: { version: 1 } });
      return { status: "ok", session_id: "structured", svg_url: `${origin}/diagram.svg`, authoring_model: source, swimlane_spec: { title: "legacy model" } };
    }
  }
  const env = {};
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]) { env[key] = process.env[key]; delete process.env[key]; }
  const originalWrite = process.stdout.write;
  try {
    for (const main of [generate, edit]) {
      let output = "";
      process.stdout.write = function(chunk, ...args) {
        if (typeof chunk === "string" && chunk.startsWith("{")) { output += chunk; return true; }
        return originalWrite.call(process.stdout, chunk, ...args);
      };
      await main(["--authoring_file", jsonFile, "--session_id", "structured", "--output_name", "result", "--output_dir", temporary], FakeClient);
      assert.equal(captured.authoringFile, jsonFile);
      assert.equal(captured.inputFile, undefined);
      const result = JSON.parse(output);
      assert.deepEqual(JSON.parse(fs.readFileSync(result.saved_authoring_file)), source);
      assert.equal(fs.readFileSync(result.saved_cw_file, "utf8"), "# session_id: structured\nexpanded: source");
      assert.equal("cw_code" in result, false);
      assert.equal("authoring_model" in result, false);
      assert.equal("swimlane_spec" in result, false);
      assert.equal(output.includes("订单管理"), false);
    }
  } finally {
    process.stdout.write = originalWrite;
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("deterministic errors remain errors instead of expert queue results", () => {
  const { validateAuthoringResult } = require(path.join(root, "skills", variants[0], "scripts/authoring.cjs"));
  const invalid = { status: "error", error: { code: "AUTHORING_INVALID", details: { path: "columns[1].cells[0].span" } } };
  assert.equal(validateAuthoringResult(invalid), invalid);
  assert.equal(validateAuthoringResult({ status: "ok", session_id: "id", authoring_model: source }).error.code, "AUTHORING_RESULT_INCOMPLETE");
});
