const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");

const skills = path.resolve(__dirname, "../skills");
const variants = ["interactive-architecture-diagram", "interactive-architecture-diagram-pay",
  "interactive-architecture-diagram-pptx", "interactive-architecture-diagram-workbuddy", "interactive-infographic"];
const presets = {
  "16:9": [1600, 900], "4:3": [1200, 900], "1:1": [1000, 1000], "2:3": [700, 1050],
  "3:4": [900, 1200], "3:2": [1500, 1000], "9:16": [900, 1600],
  a4_portrait: [840, 1188], a4_landscape: [1188, 840],
};
const fields = ["canvas_aspect", "target_width", "target_height", "min_font_size", "visual_style", "style_ink"];
const generateArgs = ["--user_request", "A diagram showing how orders move from checkout through inventory to dispatch.",
  "--use_default_palette", "true"];
const style = { min_font_size: 9.5, visual_style: "scientific_editorial", style_ink: "#1a2B3c" };
const valid = [
  [{}, {}],
  [{ canvas_aspect: " A4_PORTRAIT " }, { canvas_aspect: "a4_portrait" }],
  [{ canvas_aspect: " 16 ： 9 " }, { canvas_aspect: "16:9" }],
  [{ target_width: 320, target_height: 240 }, { target_width: 320, target_height: 240 }],
  [{ target_width: 777, target_height: 999, ...style }, { target_width: 777, target_height: 999, ...style }],
  [{ target_width: 10000, target_height: 10000, min_font_size: 100 }, { target_width: 10000, target_height: 10000, min_font_size: 100 }],
  [{ min_font_size: "1e0", visual_style: "auto" }, { min_font_size: 1, visual_style: "auto" }],
  ...["default", "scientific_omics"].map(visual_style => [{ visual_style }, { visual_style }]),
  // Python math.isclose uses the larger ratio for its relative tolerance.
  [{ canvas_aspect: "1:1", target_width: 1010, target_height: 1000 },
    { canvas_aspect: "1:1", target_width: 1010, target_height: 1000 }],
  ...Object.entries(presets).map(([canvas_aspect, [target_width, target_height]]) => {
    const value = { canvas_aspect, target_width, target_height, ...style };
    return [value, value];
  }),
];
const invalid = [
  [["--target_width", "900"]], [["--target_height", "900"]],
  [["--target_width", "319", "--target_height", "240"]], [["--target_width", "10001", "--target_height", "240"]],
  [["--target_width", "320", "--target_height", "239"]], [["--target_width", "320", "--target_height", "10001"]],
  [["--target_width", "500.5", "--target_height", "700"]],
  [["--canvas_aspect", "1:1", "--target_width", "1011", "--target_height", "1000"]],
  [["--canvas_aspect", "16:10"]], [["--canvas_aspect"]],
  [["--min_font_size", "0.9"]], [["--min_font_size", "100.1"]], [["--min_font_size", "NaN"]],
  [["--min_font_size", "Infinity"]], [["--min_font_size", "0x10"]],
  [["--visual_style", "scientific"], "INVALID_VISUAL_STYLE"], [["--visual_style"], "INVALID_VISUAL_STYLE"],
  [["--style_ink", "red"], "INVALID_STYLE_INK"], [["--style_ink", "#123"], "INVALID_STYLE_INK"],
];

function flags(fields) {
  return Object.entries(fields).flatMap(([key, value]) => ["--" + key, String(value)]);
}

function renderingFields(body) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
}

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canvas-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function preloadEnvironment(dir, source) {
  const file = path.join(dir, "transport.cjs");
  fs.writeFileSync(file, source);
  return { ...process.env, CODEX_THREAD_ID: "fixture", CW_REQUEST_MAX_RETRIES: "1",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--require=" + JSON.stringify(file.replace(/\\/g, "/"))].filter(Boolean).join(" ") };
}

function rejectedCli(t, script, prefix) {
  const dir = sandbox(t);
  const env = preloadEnvironment(dir, [
    'require("node:net").Socket.prototype.connect = () => {',
    '  require("node:fs").writeFileSync("unexpected-network", "called");',
    '  throw Error("Unexpected network call");',
    '};',
  ].join("\n"));
  for (const [args, code = "INVALID_CANVAS"] of invalid) {
    const run = spawnSync(process.execPath, [script, ...prefix, ...args], { cwd: dir, env, encoding: "utf8" });
    assert.equal(run.status, 1, args.join(" ") + " " + run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, "error");
    assert.equal(result.error.code, code, args.join(" "));
    assert.deepEqual(fs.readdirSync(dir), ["transport.cjs"], args.join(" "));
  }
}

for (const variant of variants) {
  const scripts = path.join(skills, variant, "scripts");
  const { CWClient } = require(path.join(scripts, "cw_client.cjs"));
  test(variant + " package version agrees with SKILL.md", () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(skills, variant, "_meta.json"), "utf8"));
    const guide = fs.readFileSync(path.join(skills, variant, "SKILL.md"), "utf8");
    assert.equal(guide.match(/^version: (\S+)$/m)?.[1], metadata.version);
  });
  for (const action of ["generate", "edit"]) {
    const script = path.join(scripts, action + "_contextweave.cjs");
    const prefix = action === "generate" ? generateArgs : ["--session_id", "saved", "--input_file", __filename];
    test(variant + " " + action + " wire payload", async () => {
      let body;
      class LocalClient extends CWClient {
        async request(endpoint, payload) {
          assert.match(endpoint, /\/run(?:\?|$)/);
          body = payload;
          return { status: "ok", session_id: "saved", choices: [] };
        }
      }
      const write = process.stdout.write;
      try {
        process.stdout.write = () => true;
        for (const [input, expected] of valid) {
          body = undefined;
          await require(script).main([...prefix, ...flags(input)], LocalClient);
          assert.deepEqual(renderingFields(body), expected);
          if (action === "edit") assert.equal(body.session_id, "saved");
        }
      } finally { process.stdout.write = write; }
    });
    test(variant + " " + action + " rejects before side effects", t => rejectedCli(t, script, prefix));
  }
}

const probe = path.join(skills, "interactive-architecture-diagram-pay/scripts/contextweave_paid.mjs");
test("paid probe rejects before creating billing state", t => rejectedCli(t, probe,
  ["probe", "--state_dir", "unused", ...generateArgs]));

test("paid probe preserves canvas and style in the fixed-price 402 request", async t => {
  const dir = sandbox(t);
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    const bill = {
      protocol: { out_trade_no: "fixture-order", amount: "0.05", currency: "CNY", resource_id: req.url,
        pay_before: new Date(Date.now() + 3600000).toISOString(), seller_signature: "fixture",
        seller_sign_type: "RSA2", seller_unique_id: "fixture" },
      method: { seller_name: "Fixture", seller_id: "fixture", seller_app_id: "fixture",
        goods_name: "Example diagram", seller_unique_id_key: "seller_id", service_id: "fixture" },
    };
    res.writeHead(402, { "Payment-Needed": Buffer.from(JSON.stringify(bill)).toString("base64url") });
    res.end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = preloadEnvironment(dir, [
    'require("node:https").request = (options, callback) => require("node:http").request({',
    '  hostname: "127.0.0.1", port: ' + server.address().port + ', method: options.method,',
    '  path: options.path, headers: options.headers, agent: false,',
    '}, callback);',
  ].join("\n"));
  for (const [input, expected] of valid) {
    const { stdout } = await promisify(execFile)(process.execPath,
      [probe, "probe", "--state_dir", "bill", ...generateArgs, ...flags(input)], { cwd: dir, env });
    const result = JSON.parse(stdout);
    assert.equal(result.status, "payment_required");
    assert.equal(result.payment.amount, "0.05");
    assert.equal(result.payment.currency, "CNY");
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "bill", "resource-request.json"), "utf8"));
    assert.deepEqual(JSON.parse(snapshot.body), bodies.at(-1));
    assert.deepEqual(renderingFields(bodies.at(-1)), expected);
  }
  assert.equal(bodies.length, valid.length);
});
