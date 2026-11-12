const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const scripts = "../skills/interactive-architecture-diagram/scripts/";
const { authoringEnvelope, readAuthoringFile } = require(scripts + "authoring.cjs");
const { verifyViewCoverage } = require(scripts + "view_evidence.cjs");
const { orchestrateViewGroup } = require(scripts + "view_group.cjs");
const tmp = fs.mkdtempSync(path.join(__dirname, ".group-proof-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const digest = data => createHash("sha256").update(data).digest("hex");
const caps = { independent_views: { versions: [1], execution: "client_orchestrated_single_diagrams", native_layers: false, manifest_version: 1 } };

test("the production authoring reader wraps bare JSON and preserves valid v1 JSON or HTML envelopes exactly once", () => {
  const model = { kind: "cards", title: "接口" };
  const json = { version: 1, format: "json", source: model };
  const html = { version: 1, format: "html", source: "<article>接口</article>\r\n" };
  const filename = path.join(tmp, "authoring.json");
  for (const [doc, expected] of [[model, json], [json, json], [html, html]]) {
    fs.writeFileSync(filename, JSON.stringify(doc));
    assert.deepEqual(readAuthoringFile(filename), expected);
  }
  for (const invalid of [{ ...json, source: json }, { ...json, version: "1" }, { ...json, source: [] }, { ...html, source: model }, { ...json, extra: 1 }]) {
    assert.equal(authoringEnvelope(invalid).status, "error");
  }
});

const model = { kind: "cards", id: "root", title: "图", items: [{ id: "region", title: "区", items: [
  { id: "a", title: "state_repository" }, { id: "b", title: "Other" }
] }], edges: [{ from: "a", to: "b", label: "写入（存储）" }] };
const a = "n_root.n_region.n_a", b = "n_root.n_region.n_b";
const node = { kind: "node", id: a, label: "state_repo\nsitory" };
const edge = { kind: "edge", id: "n_root.n_region.(n_a -> n_b)[0]", source: a, target: b, label: "写入（存\n储）" };
const note = { id: "detail", text: "state_repository retains the submitted state." };
const nodeFact = { fact_id: "f", view_id: "main", text: note.text, evidence: { kind: "node", id: "a", label: "state_repository", full_text_annotation_id: "detail" } };
const edgeFact = { fact_id: "e", view_id: "main", text: "写入（存储）", evidence: { kind: "edge", from: "a", to: "b", label: "写入（存储）" } };

function product(objects, notes = [note], fact = nodeFact, mutate) {
  const cw = "# cw-annotations:v1 " + JSON.stringify({ version: 1, items: notes }) + "\n# synthetic exact source\n";
  const filename = path.join(tmp, "proof.cw");
  fs.writeFileSync(filename, cw);
  const context = { cw_code: cw, source_sha256: digest(cw), views: [{ id: "", objects }] };
  if (mutate) mutate(context);
  return verifyViewCoverage({ facts: [fact], interfaces: [] }, { view_id: "main", authoring: model },
    { diagram_context: context, authoring_model: model }, { saved_cw_file: filename, source_sha256: digest(cw) });
}

test("short visible labels require the exact node and its full-text note in the bound artifact", () => {
  assert.equal(product([node]).status, "accepted");
  for (const wrong of [{ ...node, id: "n_other.n_region.n_a" }, { ...node, id: a + "_copy" }, { ...node, label: "state_repo wrongly" }]) {
    assert.equal(product([wrong]).status, "rejected");
  }
  for (const notes of [[], [{ ...note, id: "other" }], [{ ...note, text: "state_repository" }], [{ ...note, view: "main" }], [note, note]]) {
    assert.notEqual(product([node], notes).status, "accepted");
  }
  assert.notEqual(product([node], [note], nodeFact, c => c.source_sha256 = "a".repeat(64)).status, "accepted");
  assert.notEqual(product([node], [note], nodeFact, c => c.cw_code += " ").status, "accepted");
});

test("direction, human-readable name and both canonical endpoints must match independently", () => {
  assert.equal(product([edge], [], edgeFact).status, "accepted");
  for (const wrong of [{ ...edge, source: b, target: a }, { ...edge, target: "n_other.n_b" },
    { ...edge, label: "写入（缓存）" }, { ...edge, id: "(n_a -- n_b)[0]" }, { ...edge, id: "(n_a <- n_b)[0]" }]) {
    assert.equal(product([wrong], [], edgeFact).status, "rejected");
  }
});

function groupFiles(key) {
  const views = ["main", "details"].map(view_id => ({ view_id, name: view_id, focus: "系统", abstraction: "组件", authoring: { version: 1, format: "json", source: model } }));
  const facts = views.map(v => ({ fact_id: v.view_id + "_f", view_id: v.view_id, text: "state_repository", evidence: { kind: "node", id: "a", label: "state_repository" } }));
  const plan = { version: 1, source: "Two controlled views", views, facts, interfaces: [] };
  const planFile = path.join(tmp, key + ".json");
  fs.writeFileSync(planFile, JSON.stringify(plan));
  return { planFile, outputDir: path.join(tmp, key) };
}

test("a submitted deterministic failure preserves the original error, skips session export, and settles two actual zeros", async () => {
  const error = { code: "AUTHORING_INVALID_INPUT", message: "invalid model", details: { route: "authoring" } };
  let calls = 0, exports = 0, settlements = 0;
  const snapshot = () => ({ charged_tokens: 0, reserved_tokens: 0, usage_complete: true });
  const budget = {
    reserve: async ({ attempt_id }) => ({ allowed: true, attempt_id, token_limit: 2000, snapshot: { reserved_tokens: 2000 } }),
    settle: async (_, usage) => { assert.deepEqual(usage, { total_tokens: 0, model_calls: 0 }); settlements++; return { snapshot: snapshot() }; },
    snapshot,
  };
  const client = { getCapabilities: async () => caps, runGeneration: async () => ({
    status: "error", route: "authoring", session_id: "no-product-" + ++calls, error, generation: "none", delivery: "none",
    usage: { tokens: 0, model_calls: 0, usage_complete: true }, artifacts: [], outcome_version: 1,
  }), exportCode: async () => { exports++; return { status: "error", error: { code: "SESSION_NOT_FOUND" } }; } };
  const result = await orchestrateViewGroup(client, { ...groupFiles("failure"), budget });
  assert.equal(exports, 0);
  assert.equal(settlements, 2);
  assert.deepEqual(result.views.map(v => v.error), [error, error]);
  assert.deepEqual(result.budget.snapshot, snapshot());
  assert.equal(result.usage.tokens, 0);
  assert.equal(result.usage.subrequests, 2);
  assert.equal(result.usage.usage_complete, true);
});

test("legacy all-accepted manifests recheck the actual stored canonical CW and HTML without generating or reserving", async () => {
  let runs = 0;
  const client = { getCapabilities: async () => caps, runGeneration: async () => {
    const cw = "a: Test " + ++runs + "\n";
    const context = { cw_code: cw, source_sha256: digest(cw), views: [{ id: "", objects: [node] }] };
    return { status: "ok", route: "authoring", delivery: "final", quality: "accepted", session_id: "s" + runs,
      authoring_model: model, cw_code: cw, usage: { model_calls: 0, tokens: 0, usage_complete: true },
      html_content: '<script type="application/json" id="cw-diagram-context">' + JSON.stringify(context) + "</script>", svg_content: "<svg/>" };
  } };
  const paths = groupFiles("legacy");
  const first = await orchestrateViewGroup(client, paths);
  assert.equal(first.status, "accepted");
  const manifest = JSON.parse(fs.readFileSync(first.manifest_path));
  manifest.views.forEach(v => v.coverage = { status: "rejected", issues: [{ code: "OLD_SOFT_WRAP_ERROR" }] });
  fs.writeFileSync(first.manifest_path, JSON.stringify(manifest));
  const recovered = await orchestrateViewGroup(client, { ...paths, resume: true });
  assert.equal(recovered.status, "accepted");
  assert.equal(runs, 2);
  assert.deepEqual(first.views.map(v => v.source_sha256), recovered.views.map(v => v.source_sha256));
});
