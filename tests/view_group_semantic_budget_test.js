const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const backendRoot = path.join(root, "..", "backend");
const temporary = fs.mkdtempSync(path.join(root, ".view-group-semantic-budget-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const modulePath = path.join(root, "skills/interactive-architecture-diagram/scripts/view_group.cjs");
const capabilities = {
  independent_views: { versions: [1], execution: "client_orchestrated_single_diagrams", manifest_version: 1, native_layers: false },
  co_design: { versions: [1, 2], execution: "joint", board_mode: "single" },
  authoring: { versions: [1], formats: ["json"], kinds: ["swimlane", "cards", "matrix"] },
  annotations: { versions: [1] },
};

function planWithNodes(firstLabel, secondLabel) {
  return {
    version: 1,
    source: `${firstLabel}。${secondLabel}。`,
    hard_constraints: ["保留拒绝逻辑"],
    views: [
      { view_id: "api", name: "接口行为", focus: "拒绝逻辑", abstraction: "micro", request: "只表达拒绝逻辑", annotations: { version: 1, items: [] } },
      { view_id: "consumer", name: "调用方", focus: "组件调用", abstraction: "macro", request: "只表达调用方", annotations: { version: 1, items: [] } },
    ],
    facts: [
      { fact_id: "rejection", view_id: "api", text: firstLabel, evidence: { kind: "node", id: "api", label: firstLabel } },
      { fact_id: "component", view_id: "consumer", text: secondLabel, evidence: { kind: "node", id: "consumer", label: secondLabel } },
    ],
    interfaces: [{
      name: "订单提交",
      endpoints: [
        { view_id: "api", fact_id: "rejection", evidence: { kind: "edge", from: "consumer", to: "api", label: "订单提交" } },
        { view_id: "consumer", fact_id: "component", evidence: { kind: "edge", from: "consumer", to: "api", label: "订单提交" } },
      ],
    }],
  };
}

function accepted(view, planValue, { label, coverageSource } = {}) {
  const cw = `${view.view_id}: ${view.name}\n`;
  const objects = planValue.facts.filter(fact => fact.view_id === view.view_id).map(fact => ({ kind: "node", id: fact.evidence.id, label: label || fact.evidence.label }));
  const interfaces = planValue.interfaces.flatMap(relation => relation.endpoints.filter(endpoint => endpoint.view_id === view.view_id && endpoint.evidence).map(endpoint => ({ kind: "edge", id: "(" + endpoint.evidence.from + " -> " + endpoint.evidence.to + ")[0]", source: endpoint.evidence.from, target: endpoint.evidence.to, label: endpoint.evidence.label })));
  const source = coverageSource || require(modulePath).requestFor(planValue, view);
  return {
    status: "ok",
    session_id: `session-${view.view_id}`,
    cw_code: cw,
    quality: "accepted",
    delivery: "final",
    annotations_version: 1,
    co_design: {
      revision: 1,
      status: "accepted",
      usage_complete: true,
      budget_used: { calls: 1, tokens: 100 },
      coverage_evidence: {
        status: "accepted", reason: "jev_review_complete", snapshot_id: "a".repeat(64),
        complete: true,
        source,
        source_sha256: crypto.createHash("sha256").update(source).digest("hex"),
        input_sha256: crypto.createHash("sha256").update(cw).digest("hex"),
      },
    },
    diagram_context: { source_sha256: crypto.createHash("sha256").update(cw).digest("hex"), views: [{ id: "", objects: [...objects, ...interfaces] }] },
    html_url: `https://example.test/${view.view_id}.html`,
    html_content: `<html data-session="session-${view.view_id}"/>`,
    svg_content: `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    receipt: { id: `receipt-${view.view_id}`, status: "succeeded" },
  };
}

function clientFor(planValue, handler) {
  const calls = [];
  return {
    calls,
    getCapabilities: async () => capabilities,
    runGeneration: async options => {
      const view = planValue.views[calls.length];
      calls.push({ view, options });
      return handler(view, options, calls.length);
    },
  };
}

function writePlan(name, value) {
  const filename = path.join(temporary, `${name}.json`);
  fs.writeFileSync(filename, JSON.stringify(value), "utf8");
  return filename;
}

test("node identity alone cannot prove the fact's rejection semantics", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  planValue.facts[0].evidence.label = "API";
  const client = clientFor(planValue, view => accepted(view, planValue, { label: view.view_id === "api" ? "API" : undefined }));
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("semantic-missing", planValue),
    outputDir: path.join(temporary, "semantic-missing"),
  });
  assert.equal(result.status, "incomplete");
  assert(result.coverage.issues.some(issue => issue.code === "FACT_SEMANTIC_EVIDENCE_MISSING" && issue.fact_id === "rejection"));
});

test("component facts and directed interface evidence are independent", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  const client = clientFor(planValue, view => accepted(view, planValue));
  const acceptedResult = await orchestrateViewGroup(client, {
    planFile: writePlan("interface-independent", planValue),
    outputDir: path.join(temporary, "interface-independent"),
  });
  assert.equal(acceptedResult.status, "accepted");

  const missing = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  delete missing.interfaces[0].endpoints[0].evidence;
  const missingClient = clientFor(missing, view => accepted(view, missing));
  const rejected = await orchestrateViewGroup(missingClient, {
    planFile: writePlan("interface-evidence-missing", missing),
    outputDir: path.join(temporary, "interface-evidence-missing"),
  });
  assert.equal(rejected.status, "incomplete");
  assert(rejected.coverage.issues.some(issue => issue.code === "INTERFACE_EVIDENCE_REQUIRED"));
});

test("v2 outline effective source passes normalize_intent with all facts and constraints", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  for (const view of planValue.views) {
    view.outline = { outline_intent_version: 2, source: "短材料", focus: view.focus, budget: { max_tokens: 192000 }, requirements: [] };
    delete view.request;
  }
  const client = clientFor(planValue, (view, options) => {
    const outline = JSON.parse(fs.readFileSync(options.outlineFile, "utf8"));
    return accepted(view, planValue, { coverageSource: outline.source });
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("outline-effective", planValue),
    outputDir: path.join(temporary, "outline-effective"),
    budget: {
      reserve: async ({ attempt_id }) => ({ allowed: true, attempt_id, token_limit: 4096 }),
      settle: async () => ({}),
      release: async () => ({}),
    },
  });
  assert.equal(result.status, "accepted");
  for (const call of client.calls) {
    const source = JSON.parse(fs.readFileSync(call.options.outlineFile, "utf8"));
    const script = "import json,sys;sys.path.insert(0,sys.argv[1]);from interleaved_thinking.co_design.contract import normalize_intent;intent=normalize_intent(json.load(open(sys.argv[2],encoding='utf-8')),'');print(json.dumps({'source':intent.source,'max_tokens':intent.budget.max_tokens},ensure_ascii=False))";
    const normalized = spawnSync("python", ["-c", script, backendRoot, call.options.outlineFile], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(normalized.status, 0, normalized.stderr);
    const effective = JSON.parse(normalized.stdout.trim().split(/\r?\n/).at(-1));
    assert(effective.source.includes("API 拒绝未授权请求"));
    assert(effective.source.includes("保留拒绝逻辑"));
    assert(effective.source.includes("订单提交"));
    assert.equal(effective.max_tokens, 4096);
  }
});

test("continuation requires verified old remaining budget within the new reservation", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  const outputDir = path.join(temporary, "continuation-budget");
  const first = clientFor(planValue, view => {
    const result = accepted(view, planValue);
    if (view.view_id === "api") {
      result.status = "error";
      result.quality = "rejected";
      result.delivery = "draft";
      result.co_design = { ...result.co_design, revision: 3, status: "needs_revision", budget_used: { calls: 1, tokens: 100 } };
      result.error = { code: "CO_DESIGN_NOT_ACCEPTED" };
    }
    return result;
  });
  await orchestrateViewGroup(first, { planFile: writePlan("continuation-budget", planValue), outputDir });
  const second = {
    getCapabilities: async () => capabilities,
    getCoDesignBudget: async () => ({ status: "ok", usage_complete: true, max_tokens: 192000, tokens: 100, remaining_tokens: 191900, revision: 3 }),
    runGeneration: async () => assert.fail("unsafe continuation must not run"),
  };
  const resumed = await orchestrateViewGroup(second, {
    planFile: writePlan("continuation-budget", planValue),
    outputDir,
    resume: true,
    budget: {
      reserve: async ({ attempt_id }) => ({ allowed: true, attempt_id, token_limit: 1024 }),
      settle: async () => ({}),
      release: async () => ({}),
    },
  });
  assert.equal(resumed.views[0].status, "pending");
  assert.equal(resumed.views[0].error.code, "CONTINUATION_BUDGET_UNSAFE");
});

test("short evidence.text and wrong-view annotations cannot replace full fact text", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  planValue.facts[0].evidence.text = "API";
  planValue.facts[0].evidence.label = "API";
  planValue.facts[0].evidence.full_text_annotation_id = "full-rejection";
  const client = clientFor(planValue, view => {
    const result = accepted(view, planValue, { label: view.view_id === "api" ? "API" : undefined });
    const annotations = { version: 1, items: [{ id: "full-rejection", text: "API", view: "other" }] };
    result.cw_code = `# cw-annotations:v1 ${JSON.stringify(annotations)}\napi: API\n`;
    result.diagram_context.source_sha256 = crypto.createHash("sha256").update(result.cw_code).digest("hex");
    result.co_design.coverage_evidence.input_sha256 = result.diagram_context.source_sha256;
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("short-evidence-annotation", planValue),
    outputDir: path.join(temporary, "short-evidence-annotation"),
  });
  assert.equal(result.status, "incomplete");
  assert(result.coverage.issues.some(issue => ["FULL_TEXT_ANNOTATION_INVALID", "FACT_SEMANTIC_EVIDENCE_MISSING"].includes(issue.code)));
});

test("full-text annotation in exact CW supports a short visible label", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  planValue.facts[0].evidence.label = "API";
  planValue.facts[0].evidence.full_text_annotation_id = "full-rejection";
  const client = clientFor(planValue, view => {
    const result = accepted(view, planValue, { label: view.view_id === "api" ? "API" : undefined });
    const annotations = { version: 1, items: [{ id: "full-rejection", text: "API 拒绝未授权请求" }] };
    result.cw_code = `# cw-annotations:v1 ${JSON.stringify(annotations)}\napi: API\n`;
    result.diagram_context.source_sha256 = crypto.createHash("sha256").update(result.cw_code).digest("hex");
    result.co_design.coverage_evidence.input_sha256 = result.diagram_context.source_sha256;
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("full-evidence-annotation", planValue),
    outputDir: path.join(temporary, "full-evidence-annotation"),
  });
  assert.equal(result.status, "accepted");
});

test("entity_reference validates same entity without inventing a directed business edge", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  planValue.facts[0].evidence.label = "API";
  planValue.facts[0].evidence.full_text_annotation_id = "full-rejection";
  planValue.interfaces = [{ kind: "entity_reference", entity_id: "api", name: "API", endpoints: [
    { view_id: "api", fact_id: "rejection", evidence: { kind: "node", id: "api", label: "API" } },
    { view_id: "consumer", fact_id: "component", evidence: { kind: "node", id: "api", label: "API" } },
  ] }];
  const client = clientFor(planValue, view => {
    const result = accepted(view, planValue);
    const annotations = { version: 1, items: [{ id: "full-rejection", text: "API 拒绝未授权请求" }] };
    result.cw_code = `# cw-annotations:v1 ${JSON.stringify(annotations)}\n${result.cw_code}`;
    result.diagram_context = { source_sha256: crypto.createHash("sha256").update(result.cw_code).digest("hex"), views: [{ id: "", objects: [{ kind: "node", id: "api", label: "API" }, { kind: "node", id: "consumer", label: "调用方提交订单" }] }] };
    result.co_design.coverage_evidence.input_sha256 = result.diagram_context.source_sha256;
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("entity-reference", planValue),
    outputDir: path.join(temporary, "entity-reference"),
  });
  assert.equal(result.status, "accepted", JSON.stringify(result.coverage));
});

test("missing wire usage_complete stays unknown even with numeric budget_used", () => {
  const { usageFromResult } = require(modulePath);
  const usage = usageFromResult({ co_design: { budget_used: { calls: 2, tokens: 100 }, last_error: { code: "MODEL_CALL_FAILED" } } });
  assert.equal(usage.kind, "unknown");
  assert.equal(usage.usage_complete, false);
  assert.equal(usage.tokens, null);
});

test("continuation workflow ID is distinct from the display draft session", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = planWithNodes("API 拒绝未授权请求", "调用方提交订单");
  const outputDir = path.join(temporary, "continuation-identity");
  const first = clientFor(planValue, view => {
    const result = accepted(view, planValue);
    if (view.view_id === "api") {
      result.session_id = "display-draft";
      result.status = "error";
      result.quality = "rejected";
      result.delivery = "draft";
      result.co_design = { ...result.co_design, continuation_session_id: "workflow-original", revision: 3, status: "needs_revision", budget_used: { calls: 1, tokens: 100 } };
      result.error = { code: "CO_DESIGN_NOT_ACCEPTED" };
    }
    return result;
  });
  await orchestrateViewGroup(first, { planFile: writePlan("continuation-identity", planValue), outputDir });
  const seen = [];
  const second = {
    getCapabilities: async () => capabilities,
    getCoDesignBudget: async sessionId => {
      seen.push(sessionId);
      return { status: "ok", usage_complete: true, remaining_tokens: 191900, revision: 3 };
    },
    runGeneration: async options => {
      assert.equal(options.sessionId, "workflow-original");
      const result = accepted(planValue.views[0], planValue);
      result.co_design.continuation_session_id = "workflow-original";
      return result;
    },
  };
  const resumed = await orchestrateViewGroup(second, { planFile: writePlan("continuation-identity", planValue), outputDir, resume: true });
  assert.equal(resumed.status, "accepted");
  assert.deepEqual(seen, ["workflow-original"]);
  assert.equal(resumed.views[0].session_id, "session-api");
  assert.equal(resumed.views[0].continuation_session_id, "workflow-original");
});
