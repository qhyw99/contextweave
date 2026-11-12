const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(root, ".view-group-p0-review-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const modulePath = path.join(root, "skills/interactive-architecture-diagram/scripts/view_group.cjs");
const capabilities = {
  independent_views: { versions: [1], execution: "client_orchestrated_single_diagrams", manifest_version: 1, native_layers: false },
  co_design: { versions: [1, 2], execution: "joint", board_mode: "single" },
  authoring: { versions: [1], formats: ["json"], kinds: ["swimlane", "cards", "matrix"] },
  annotations: { versions: [1] },
};

function reviewPlan() {
  return {
    version: 1,
    source: "共享材料：网关调用订单，订单通过库存锁定接口写入仓库。",
    hard_constraints: ["不得遗漏库存锁定接口"],
    views: [
      {
        view_id: "architecture", name: "架构", focus: "网关到订单", abstraction: "macro",
        request: "只画网关到订单的架构依赖。",
        hard_constraints: ["架构图必须保留网关"],
        annotations: { version: 1, items: [] },
      },
      {
        view_id: "process", name: "流程", focus: "订单锁定库存", abstraction: "meso",
        request: "只画订单锁定库存的处理过程。",
        annotations: { version: 1, items: [] },
      },
    ],
    facts: [
      { fact_id: "gateway-orders", view_id: "architecture", text: "网关调用订单", evidence: { kind: "node", id: "gateway", label: "网关调用订单" } },
      { fact_id: "inventory-interface", view_id: "process", text: "库存锁定接口", evidence: { kind: "node", id: "inventory", label: "库存锁定接口" } },
      { fact_id: "process-repository", view_id: "process", text: "订单写入仓库", evidence: { kind: "edge", from: "orders", to: "repository", label: "订单写入仓库" } },
    ],
    interfaces: [
      {
        name: "库存锁定接口",
        endpoints: [
          { view_id: "process", fact_id: "inventory-interface", evidence: { kind: "edge", from: "orders", to: "repository", label: "库存锁定接口" } },
          { view_id: "architecture", fact_id: "gateway-orders", evidence: { kind: "edge", from: "orders", to: "repository", label: "库存锁定接口" } },
        ],
      },
    ],
  };
}

function writePlan(name, value = reviewPlan()) {
  const filename = path.join(temporary, `${name}.json`);
  fs.writeFileSync(filename, JSON.stringify(value), "utf8");
  return filename;
}

function contextFor(cw, objects) {
  return { version: 1, primary_view: "", cw_code: cw, source_sha256: crypto.createHash("sha256").update(cw).digest("hex"), views: [{ id: "", svg_sha256: "a".repeat(64), objects }] };
}

function accepted(view, planValue, overrides = {}) {
  const cw = `${view.view_id}: ${view.name}\n`;
  const facts = planValue.facts.filter(fact => fact.view_id === view.view_id);
  const objects = facts.map(fact => ({ kind: fact.evidence.kind, id: fact.evidence.id || `( ${fact.evidence.from} -> ${fact.evidence.to} )[0]`, label: fact.evidence.text || fact.text, source: fact.evidence.from, target: fact.evidence.to }));
  const interfaces = planValue.interfaces.flatMap(relation => relation.endpoints.filter(endpoint => endpoint.view_id === view.view_id).map(endpoint => ({ kind: "edge", id: "(" + endpoint.evidence.from + " -> " + endpoint.evidence.to + ")[0]", source: endpoint.evidence.from, target: endpoint.evidence.to, label: endpoint.evidence.label })));
  const coverageSource = require(modulePath).requestFor(planValue, view);
  return {
    status: "ok",
    session_id: `session-${view.view_id}`,
    cw_code: cw,
    quality: "accepted",
    delivery: "final",
    annotations_version: 1,
    authoring_model: view.authoring,
    co_design: { revision: 1, status: "accepted", usage_complete: true, budget_used: { calls: 2, tokens: 100 },
      coverage_evidence: { status: "accepted", reason: "jev_review_complete", snapshot_id: "a".repeat(64), complete: true, source: coverageSource,
        source_sha256: crypto.createHash("sha256").update(coverageSource).digest("hex"),
        input_sha256: crypto.createHash("sha256").update(cw).digest("hex") } },
    diagram_context: contextFor(cw, [...objects, ...interfaces]),
    html_url: `https://example.test/${view.view_id}.html`,
    html_content: `<html><body data-session="session-${view.view_id}">${view.name}</body></html>`,
    svg_content: `<svg xmlns="http://www.w3.org/2000/svg" data-view="${view.view_id}"/>`,
    receipt: { id: `receipt-${view.view_id}-${Date.now()}`, status: "succeeded", quota: { status: "settled" } },
    ...overrides,
  };
}

function clientFor(planValue, handler) {
  const calls = [];
  return {
    calls,
    getCapabilities: async () => capabilities,
    runGeneration: async options => {
      const view = planValue.views[calls.length];
      calls.push({ viewId: view.view_id, options });
      return handler(view, calls.length, options);
    },
  };
}

test("ordinary request payload contains shared source, owned facts/interfaces, focus and hard constraints", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const client = clientFor(planValue, (view, _index, options) => {
    const text = options.userRequest;
    assert(text.includes(planValue.source));
    assert(text.includes(view.request));
    assert(text.includes(view.focus));
    for (const fact of planValue.facts.filter(fact => fact.view_id === view.view_id)) assert(text.includes(fact.text));
    if (view.view_id === "process") {
      assert(text.includes("库存锁定接口"));
      assert(!text.includes("只画网关到订单的架构依赖"));
      assert(!text.includes("网关调用订单\",") || text.includes("跨视图接口"));
    } else {
      assert(text.includes("不得遗漏库存锁定接口"));
      assert(text.includes("架构图必须保留网关"));
      assert(!text.includes("只画订单锁定库存的处理过程"));
    }
    return accepted(view, planValue);
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("payload", planValue),
    outputDir: path.join(temporary, "payload"),
  });
  assert.equal(result.status, "accepted");
  assert.equal(client.calls.length, 2);
});

test("child accepted with a missing product fact cannot accept group coverage", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const client = clientFor(planValue, view => {
    const result = accepted(view, planValue);
    if (view.view_id === "process") result.diagram_context = contextFor(result.cw_code, []);
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("product-missing", planValue),
    outputDir: path.join(temporary, "product-missing"),
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.coverage.status, "rejected");
  assert(result.coverage.issues.some(issue => issue.code === "FACT_SEMANTIC_EVIDENCE_MISSING" && issue.fact_id === "inventory-interface"));
  assert(result.coverage.issues.some(issue => issue.code === "INTERFACE_PRODUCT_INCOMPLETE"));
  assert(result.views.every(view => view.status === "accepted"));
});

test("authoring coverage uses returned model and real diagram context, not plan intent", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  for (const view of planValue.views) {
    delete view.request;
    view.authoring = { kind: "cards", title: view.name, items: [{ id: "unexpected", title: "无关节点" }] };
  }
  const client = clientFor(planValue, view => {
    const result = accepted(view, planValue);
    result.authoring_model = view.authoring;
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("authoring-product-missing", planValue),
    outputDir: path.join(temporary, "authoring-product-missing"),
  });
  assert.equal(result.status, "incomplete");
  assert(result.coverage.issues.some(issue => issue.code === "AUTHORING_PRODUCT_MISMATCH"));
});

test("cold resume continues the same draft workflow with exact source and cumulative usage deltas", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const firstClient = clientFor(planValue, view => {
    if (view.view_id !== "process") return accepted(view, planValue);
    const draft = accepted(view, planValue);
    return {
      ...draft,
      status: "error",
      quality: "rejected",
      delivery: "draft",
      co_design: { ...draft.co_design, revision: 3, status: "needs_revision", budget_used: { calls: 2, tokens: 100 } },
      error: { code: "CO_DESIGN_NOT_ACCEPTED", message: "合成草稿" },
    };
  });
  const partial = await orchestrateViewGroup(firstClient, {
    planFile: writePlan("resume-draft", planValue),
    outputDir: path.join(temporary, "resume-draft"),
  });
  assert.equal(partial.views[1].status, "draft");
  const draftSource = fs.readFileSync(partial.views[1].artifacts.saved_cw_file, "utf8");

  const resumedCalls = [];
  const secondClient = {
    getCapabilities: async () => capabilities,
    getCoDesignBudget: async () => ({ status: "ok", usage_complete: true, remaining_tokens: 191900, revision: 3 }),
    runGeneration: async options => {
      resumedCalls.push(options);
      const result = accepted(planValue.views[1], planValue);
      result.co_design = { ...result.co_design, revision: 4, status: "accepted", usage_complete: true, budget_used: { calls: 3, tokens: 150 } };
      return result;
    },
  };
  const resumed = await orchestrateViewGroup(secondClient, {
    planFile: writePlan("resume-draft", planValue),
    outputDir: path.join(temporary, "resume-draft"),
    resume: true,
  });
  assert.equal(resumed.status, "accepted", JSON.stringify(resumed.views[1].coverage));
  assert.equal(resumedCalls.length, 1);
  const options = resumedCalls[0];
  assert.equal(options.sessionId, "session-process");
  assert.equal(options.coDesignRevision, 3);
  assert.equal(options.cwSourceFile, partial.views[1].artifacts.saved_cw_file);
  assert.equal(fs.readFileSync(options.cwSourceFile, "utf8"), draftSource);
  assert(options.userRequest.includes("在现有子工作流上继续"));
  assert.equal(resumed.usage.tokens, 250, JSON.stringify(resumed.views.map(view => view.attempts.map(attempt => attempt.usage))));
  assert.equal(resumed.usage.model_calls, 5);
  assert.equal(resumed.views[1].attempts[1].usage.tokens, 50);
  assert.equal(resumed.views[1].attempts[1].usage.model_calls, 1);
});

test("unconfirmed request is queried before resume and never blindly resubmitted", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const outputDir = path.join(temporary, "resume-unknown");
  const record = path.join(temporary, "unknown.receipt.json");
  fs.writeFileSync(record, JSON.stringify({ request_id: "unknown-request", request_token: "local-test-token" }), "utf8");
  const firstClient = clientFor(planValue, view => {
    if (view.view_id !== "process") return accepted(view, planValue);
    return { status: "error", error: { code: "API_ERROR", message: "合成网络中断" }, saved_request_record: record, request_id: "unknown-request" };
  });
  const partial = await orchestrateViewGroup(firstClient, {
    planFile: writePlan("resume-unknown", planValue),
    outputDir,
  });
  assert.equal(partial.views[1].attempts[0].submitted, true);

  const querying = {
    getCapabilities: async () => capabilities,
    getRequestReceipt: async () => ({ receipt: { status: "pending" } }),
    runGeneration: async () => assert.fail("unconfirmed request must not be resubmitted"),
  };
  const pending = await orchestrateViewGroup(querying, { planFile: writePlan("resume-unknown", planValue), outputDir, resume: true });
  assert.equal(pending.views[1].status, "pending");
  assert.equal(pending.views[1].error.code, "VIEW_RECEIPT_UNCONFIRMED");

  const recoveredClient = {
    getCapabilities: async () => capabilities,
    getCoDesignBudget: async () => ({ status: "ok", usage_complete: true, remaining_tokens: 191900, revision: 1 }),
    getRequestReceipt: async ({ requestId, token }) => {
      assert.equal(requestId, "unknown-request");
      assert.equal(token, "local-test-token");
      return { receipt: { status: "succeeded", quota: { status: "settled" } }, result: accepted(planValue.views[1], planValue) };
    },
    runGeneration: async () => assert.fail("recovered request must not be resubmitted"),
  };
  const recovered = await orchestrateViewGroup(recoveredClient, { planFile: writePlan("resume-unknown", planValue), outputDir, resume: true });
  assert.equal(recovered.status, "accepted", JSON.stringify(recovered.views[1]));
  assert.equal(recovered.views[1].attempts.length, 1);
  assert.equal(recovered.usage.subrequests, 2);
});

test("usage distinguishes increments, workflow totals, authoring zero, not_called and unknown", () => {
  const { usageFromResult, summarizeUsage } = require(modulePath);
  const authoring = usageFromResult({ route: "authoring", usage: { model_calls: 0, tokens: 0, usage_complete: true } });
  const notCalled = usageFromResult({ status: "error", co_design: { budget_used: { calls: 0, tokens: 0 }, provider: { outcome: "not_called" } } });
  const first = usageFromResult({ session_id: "one", co_design: { usage_complete: true, budget_used: { calls: 2, tokens: 100 } } });
  const second = usageFromResult({ session_id: "one", co_design: { usage_complete: true, budget_used: { calls: 3, tokens: 150 } } }, [{ session_id: "one", usage: first }]);
  const unknown = usageFromResult({ status: "error", saved_request_record: "record" });
  assert.equal(authoring.kind, "authoring_zero");
  assert.equal(notCalled.kind, "not_called");
  assert.equal(notCalled.tokens, 0);
  assert.equal(second.kind, "workflow_total");
  assert.equal(second.tokens, 50);
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.tokens, null);
  const total = summarizeUsage([{ attempts: [
    { submitted: true, usage: authoring },
    { submitted: true, usage: notCalled },
    { submitted: true, usage: first },
    { submitted: true, usage: second },
    { submitted: true, usage: unknown },
  ] }]);
  assert.equal(total.tokens, null);
  assert.equal(total.known_tokens, 150);
  assert.equal(total.usage_complete, false);
});

test("R6 adapter reserves per attempt, caps child tokens and settles only deltas", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const calls = { reserve: [], settle: [], release: [] };
  const budget = {
    reserve: async ({ attempt_id }) => {
      calls.reserve.push(attempt_id);
      return { allowed: true, attempt_id, token_limit: 4096, remaining_tokens: 10000 };
    },
    settle: async (attemptId, usage) => { calls.settle.push({ attemptId, usage }); return { charged_tokens: usage?.total_tokens ?? 4096 }; },
    release: async attemptId => { calls.release.push(attemptId); },
  };
  const client = clientFor(planValue, (view, _index, options) => {
    assert.equal(options.tokenLimit, 4096);
    return accepted(view, planValue);
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("budget-adapter", planValue),
    outputDir: path.join(temporary, "budget-adapter"),
    budget,
  });
  assert.equal(result.status, "accepted");
  assert.equal(calls.reserve.length, 2);
  assert.deepEqual(calls.settle.map(item => item.usage.total_tokens), [100, 100]);
  assert.equal(calls.release.length, 0);
  assert.equal(result.budget.status, "adapter_verified");
});

test("budget settles unknown as null and releases only proven unsubmitted preflight failures", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  for (const mode of ["unknown", "preflight"]) {
    const planValue = reviewPlan();
    const calls = { settle: [], release: [] };
    const budget = {
      reserve: async ({ attempt_id }) => ({ allowed: true, attempt_id, token_limit: 4096 }),
      settle: async (attemptId, usage) => { calls.settle.push({ attemptId, usage }); return {}; },
      release: async attemptId => { calls.release.push(attemptId); },
    };
    const client = clientFor(planValue, view => {
      if (view.view_id === "architecture") return accepted(view, planValue);
      if (mode === "unknown") {
        const record = path.join(temporary, `${mode}.receipt.json`);
        fs.writeFileSync(record, JSON.stringify({ request_id: mode, request_token: "local-only" }), "utf8");
        return { status: "error", error: { code: "API_ERROR" }, saved_request_record: record };
      }
      return { status: "error", error: { code: "PALETTE_UNSUPPORTED" } };
    });
    const result = await orchestrateViewGroup(client, {
      planFile: writePlan(`budget-${mode}`, planValue),
      outputDir: path.join(temporary, `budget-${mode}`),
      budget,
    });
    assert.equal(result.status, "incomplete");
    if (mode === "unknown") {
      assert.equal(calls.settle.length, 2);
      assert.equal(calls.settle[1].usage, null);
      assert.equal(calls.release.length, 0);
      assert.equal(result.usage.tokens, null);
    } else {
      assert.equal(calls.settle.length, 1);
      assert.equal(calls.release.length, 1);
    }
  }
});

test("index keeps technical diagnostics behind a details disclosure", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planValue = reviewPlan();
  const client = clientFor(planValue, view => accepted(view, planValue));
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("index-details", planValue),
    outputDir: path.join(temporary, "index-details"),
  });
  const html = fs.readFileSync(result.index_file, "utf8");
  assert(html.includes("<details><summary>技术诊断</summary>"));
  assert(!html.includes("<p><code>session="));
});

test("real clients forward the per-attempt token limit in the run payload", async () => {
  for (const variant of ["", "-pay", "-pptx", "-workbuddy"]) {
    const { CWClient } = require(path.join(root, `skills/interactive-architecture-diagram${variant}/scripts/cw_client.cjs`));
    const client = new CWClient();
    let captured;
    client.request = async (_endpoint, payload) => { captured = payload; return { status: "error", error: { code: "SYNTHETIC_STOP" } }; };
    await client.runGeneration({ userRequest: "只生成一个合成单图，用于核对子请求预算字段，不调用线上服务。", tokenLimit: 4096, useDefaultPalette: true });
    assert.equal(captured.token_limit, 4096, variant || "main");
  }
});

test("authoring drafts recover exact source/model and do not query receipts as unknown", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const authored = reviewPlan();
  for (const view of authored.views) {
    delete view.request;
    view.authoring = { kind: "cards", title: view.name, items: [{ id: view.view_id === "architecture" ? "gateway" : view.view_id, title: view.view_id === "architecture" ? "网关调用订单" : "库存锁定接口" }] };
  }
  authored.views[1].authoring = { kind: "cards", title: "下单流程", items: [
    { id: "inventory", title: "库存锁定接口" }, { id: "orders", title: "库存锁定接口" }, { id: "repository", title: "库存锁定接口" },
  ], edges: [{ from: "orders", to: "repository", label: "订单写入仓库" }] };
  // Both independent models contain the directed interface under review.
  authored.views[0].authoring.items.push({ id: "orders", title: "订单" }, { id: "repository", title: "仓库" });
  for (const view of authored.views) {
    (view.authoring.edges ||= []).push({ from: "orders", to: "repository", label: "库存锁定接口" });
  }
  const planFile = writePlan("authoring-draft-source", authored);
  const outputDir = path.join(temporary, "authoring-draft-source");
  const record = path.join(temporary, "authoring-draft.receipt.json");
  fs.writeFileSync(record, JSON.stringify({ request_id: "draft", request_token: "local" }), "utf8");
  const client = clientFor(authored, view => {
    if (view.view_id !== "process") return accepted(view, authored);
    const result = accepted(view, authored);
    delete result.cw_code;
    delete result.authoring_model;
    result.status = "error";
    result.quality = "rejected";
    result.delivery = "draft";
    result.co_design.status = "needs_revision";
    result.error = { code: "CO_DESIGN_NOT_ACCEPTED" };
    result.saved_request_record = record;
    return result;
  });
  const exports = [];
  client.exportCode = async (sessionId, targetDir, format) => {
    exports.push({ sessionId, format });
    if (format === "authoring") {
      const file = path.join(targetDir, "diagram.authoring.json");
      fs.writeFileSync(file, JSON.stringify(authored.views.find(view => `session-${view.view_id}` === sessionId).authoring), "utf8");
      return { status: "ok", saved_authoring_file: file };
    }
    const file = path.join(targetDir, "diagram.cw");
    fs.writeFileSync(file, "process: 下单流程\n", "utf8");
    return { status: "ok", file_path: file };
  };
  const partial = await orchestrateViewGroup(client, { planFile, outputDir });
  assert.equal(partial.views[1].status, "draft", partial.views[1].error?.message);
  assert.equal(partial.views[1].source_sha256, crypto.createHash("sha256").update("process: 下单流程\n").digest("hex"));
  assert(exports.some(item => item.format === "authoring"));

  let queried = false;
  client.runGeneration = async () => accepted(authored.views[1], authored);
  client.getRequestReceipt = async () => { queried = true; return { receipt: { status: "pending" } }; };
  const resumed = await orchestrateViewGroup(client, { planFile, outputDir, resume: true });
  assert.equal(resumed.status, "accepted", JSON.stringify(resumed.coverage));
  assert.equal(queried, false);
});
