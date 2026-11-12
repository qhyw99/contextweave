const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(root, ".view-group-cli-test-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("CLI prints a compact machine receipt and returns the resumable manifest", async t => {
  const script = path.join(root, "skills/interactive-architecture-diagram/scripts/generate_view_group.cjs");
  const { main } = require(script);
  const planFile = path.join(temporary, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ version: 1, views: [] }), "utf8");
  const outputDir = path.join(temporary, "output");
  const seen = [];
  class Client {}
  const orchestrate = async (client, options) => {
    seen.push({ client, options });
    return {
      status: "incomplete",
      group_id: "view-group-synthetic",
      plan_sha256: "a".repeat(64),
      coverage: { status: "accepted", issues: [] },
      usage: { subrequests: 2, model_calls: 1, tokens: 20, usage_complete: true, receipts: 2 },
      views: [{ view_id: "architecture", name: "架构", status: "accepted", session_id: "one", source_sha256: "b".repeat(64), quality: "accepted", revision: 1, annotations: { count: 4 }, artifacts: { html_url: "https://example.test/one.html" }, error: null }],
      manifest_path: path.join(outputDir, "view-group-manifest.json"),
      index_file: path.join(outputDir, "index.html"),
    };
  };
  const chunks = [];
  const write = t.mock.method(process.stdout, "write", chunk => { chunks.push(String(chunk)); return true; });
  let result;
  const budget = { name: "remote-ledger" };
  try { result = await main(["--plan_file", planFile, "--output_dir", outputDir, "--resume"], Client, orchestrate, () => budget); }
  finally { write.mock.restore(); }

  assert(seen[0].client instanceof Client);
  assert.deepEqual(seen[0].options, { planFile, outputDir, resume: true, budget, edits: null });
  const printed = JSON.parse(chunks.join(""));
  assert.equal(printed.status, "incomplete");
  assert.equal(printed.manifest_path, seen[0].options.outputDir + path.sep + "view-group-manifest.json");
  assert.equal("plan" in printed, false);
  assert.deepEqual(result, printed);
});
