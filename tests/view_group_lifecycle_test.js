const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(root, ".view-group-test-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const capabilities = {
  independent_views: {
    versions: [1],
    execution: "client_orchestrated_single_diagrams",
    manifest_version: 1,
    native_layers: false,
  },
  co_design: { versions: [1, 2], execution: "joint", board_mode: "single" },
  authoring: { versions: [1], formats: ["json"], kinds: ["cards"] },
  annotations: { versions: [1] },
};

function notes(viewId, count) {
  return {
    version: 1,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${viewId}-note-${index + 1}`,
      text: `${viewId} 的第 ${index + 1} 条合成备注`,
    })),
  };
}

function plan() {
  return {
    version: 1,
    source: "合成系统包含网关、订单和库存；本计划只用于生命周期验证。",
    views: [
      {
        view_id: "architecture",
        name: "系统架构",
        focus: "网关到订单的依赖",
        abstraction: "macro",
        request: "为合成系统单独生成系统架构图，只表达网关、订单、库存的依赖，不包含流程或源码容器。",
        annotations: notes("architecture", 4),
      },
      {
        view_id: "process",
        name: "下单流程",
        focus: "下单到库存锁定",
        abstraction: "meso",
        request: "为合成系统单独生成下单流程图，只表达提交订单、校验和锁定库存的步骤，不包含架构容器。",
        annotations: notes("process", 3),
      },
      {
        view_id: "code_map",
        name: "代码地图",
        focus: "处理器与仓库接口",
        abstraction: "micro",
        request: "为合成系统单独生成代码地图，只表达订单处理器与库存仓库接口，不包含架构或流程容器。",
        annotations: notes("code_map", 3),
      },
    ],
    facts: [
      { fact_id: "fact-architecture", view_id: "architecture", text: "系统架构", evidence: { kind: "node", id: "architecture", label: "系统架构", text: "系统架构" } },
      { fact_id: "fact-process", view_id: "process", text: "库存锁定接口", evidence: { kind: "node", id: "process", label: "库存锁定接口", text: "库存锁定接口" } },
      { fact_id: "fact-code", view_id: "code_map", text: "库存锁定接口", evidence: { kind: "node", id: "code_map", label: "库存锁定接口", text: "库存锁定接口" } },
    ],
    interfaces: [
      {
        name: "库存锁定接口",
        endpoints: [
          { view_id: "process", fact_id: "fact-process", evidence: { kind: "edge", from: "process", to: "code_map", label: "库存锁定接口" } },
          { view_id: "code_map", fact_id: "fact-code", evidence: { kind: "edge", from: "process", to: "code_map", label: "库存锁定接口" } },
        ],
      },
    ],
  };
}

function writePlan(name, value = plan()) {
  const filename = path.join(temporary, `${name}.json`);
  fs.writeFileSync(filename, JSON.stringify(value), "utf8");
  return filename;
}

function accepted(view, tokens) {
  const cw = `# cw-annotations:v1 ${JSON.stringify(view.annotations)}\n${view.view_id}: ${view.name}\n`;
  const label = view.view_id === "architecture" ? "系统架构" : "库存锁定接口";
  const coverageSource = require(modulePath).requestFor(plan(), view);
  return {
    status: "ok",
    session_id: `session-${view.view_id}`,
    cw_code: cw,
    quality: "accepted",
    delivery: "final",
    annotations_version: 1,
    co_design: { revision: 1, status: "accepted", usage_complete: true, budget_used: { calls: 2, tokens },
      coverage_evidence: { status: "accepted", reason: "jev_review_complete", snapshot_id: "a".repeat(64), complete: true, source: coverageSource,
        source_sha256: crypto.createHash("sha256").update(coverageSource).digest("hex"),
        input_sha256: crypto.createHash("sha256").update(cw).digest("hex") } },
    authoring_model: view.authoring,
    diagram_context: {
      source_sha256: crypto.createHash("sha256").update(cw).digest("hex"),
      views: [{ id: "", objects: [{ kind: "node", id: view.view_id, label },
        { kind: "edge", id: "(process -> code_map)[0]", source: "process", target: "code_map", label: "库存锁定接口" }] }],
    },
    html_url: `https://example.test/${view.view_id}.html`,
    html_content: `<html><body data-session="session-${view.view_id}">${view.name}</body></html>`,
    svg_content: `<svg xmlns="http://www.w3.org/2000/svg" data-view="${view.view_id}"/>`,
    receipt: { id: `receipt-${view.view_id}`, status: "succeeded", quota: { status: "settled" } },
  };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    getCapabilities: async () => capabilities,
    runGeneration: async options => {
      const view = plan().views.find(item => options.userRequest.includes(item.view_id === "architecture" ? "系统架构图" : item.view_id === "process" ? "下单流程图" : "代码地图"));
      calls.push({ viewId: view.view_id, options });
      return handler(view, calls.length, options);
    },
  };
}

const modulePath = path.join(root, "skills/interactive-architecture-diagram/scripts/view_group.cjs");

test("three views retain independent source, sessions, artifacts, and 4/3/3 notes", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planFile = writePlan("three-views");
  const outputDir = path.join(temporary, "three-views");
  const client = fakeClient(view => accepted(view, 100));

  const result = await orchestrateViewGroup(client, { planFile, outputDir });

  assert.equal(result.status, "accepted");
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls.map(call => call.options.annotationsFile === null), [false, false, false]);
  const manifest = JSON.parse(fs.readFileSync(result.manifest_path, "utf8"));
  assert.equal(manifest.version, 1);
  assert.match(manifest.plan_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.views.map(view => view.annotations.count), [4, 3, 3]);
  assert.equal(new Set(manifest.views.map(view => view.session_id)).size, 3);
  assert.equal(new Set(manifest.views.map(view => view.source_sha256)).size, 3);
  for (const view of manifest.views) {
    assert.equal(view.quality, "accepted");
    assert.equal(view.revision, 1);
    const source = fs.readFileSync(view.artifacts.saved_cw_file, "utf8");
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), view.source_sha256);
    assert(!source.includes("architecture:") || view.view_id === "architecture");
    assert(fs.existsSync(view.artifacts.saved_html_file));
    assert(fs.readFileSync(view.artifacts.saved_html_file, "utf8").includes(view.session_id));
  }
  const index = fs.readFileSync(result.index_file, "utf8");
  assert(index.includes("系统架构") && index.includes("下单流程") && index.includes("代码地图"));
  assert(!index.includes("native layers"));
  assert.deepEqual(manifest.usage, {
    subrequests: 3,
    model_calls: 6,
    tokens: 300,
    known_model_calls: 6,
    known_tokens: 300,
    usage_complete: true,
    usage_kinds: ["workflow_total"],
    receipts: 3,
  });
});

test("second-view failure survives cold resume and only regenerates that view", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planFile = writePlan("resume");
  const outputDir = path.join(temporary, "resume");
  let processAttempts = 0;
  const firstClient = fakeClient(view => {
    if (view.view_id === "process" && processAttempts++ === 0) {
      return {
        status: "error",
        error: { code: "MODEL_BUSY", message: "合成繁忙" },
        co_design: { status: "failed", revision: 0, usage_complete: true, budget_used: { calls: 0, tokens: 0 } },
        receipt: { id: "receipt-process-failed", status: "failed", quota: { status: "refunded" } },
      };
    }
    return accepted(view, 120);
  });

  const partial = await orchestrateViewGroup(firstClient, { planFile, outputDir });
  assert.equal(partial.status, "incomplete");
  assert.deepEqual(partial.views.map(view => view.status), ["accepted", "failed", "accepted"]);
  assert.equal(partial.usage.subrequests, 3);
  assert.equal(partial.usage.receipts, 3);
  const retained = partial.views.filter(view => view.view_id !== "process").map(view => ({
    id: view.view_id,
    source: fs.readFileSync(view.artifacts.saved_cw_file, "utf8"),
    sha: view.source_sha256,
  }));

  const secondClient = fakeClient(view => accepted(view, 120));
  const resumed = await orchestrateViewGroup(secondClient, { planFile, outputDir, resume: true });

  assert.equal(resumed.status, "accepted");
  assert.deepEqual(secondClient.calls.map(call => call.viewId), ["process"]);
  for (const item of retained) {
    const view = resumed.views.find(candidate => candidate.view_id === item.id);
    assert.equal(view.source_sha256, item.sha);
    assert.equal(fs.readFileSync(view.artifacts.saved_cw_file, "utf8"), item.source);
  }
  assert.equal(resumed.views.find(view => view.view_id === "process").attempts.length, 2);
  assert.equal(resumed.usage.subrequests, 4);
  assert.equal(resumed.usage.model_calls, 6);
  assert.equal(resumed.usage.tokens, 360);
  assert.equal(resumed.usage.receipts, 4);
  assert(resumed.views.find(view => view.view_id === "process").attempts[0].receipt.quota.status === "refunded");
});

test("unassigned facts and incomplete cross-view interfaces cannot be accepted", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const invalid = plan();
  invalid.facts.push({ fact_id: "unowned", text: "没有负责视图" });
  invalid.interfaces[0].endpoints.pop();
  const planFile = writePlan("coverage", invalid);
  const client = fakeClient(view => accepted(view, 100));

  const result = await orchestrateViewGroup(client, {
    planFile,
    outputDir: path.join(temporary, "coverage"),
  });

  assert.equal(result.status, "error");
  assert.equal(result.error.code, "VIEW_COVERAGE_INVALID");
  assert(result.error.details.issues.some(issue => issue.code === "FACT_VIEW_REQUIRED"));
  assert(result.error.details.issues.some(issue => issue.code === "INTERFACE_ENDPOINTS_REQUIRED"));
  assert.equal(client.calls.length, 0);
});

test("budget admission can pause later views without spending a subrequest", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const planFile = writePlan("budget");
  const client = fakeClient(view => accepted(view, 100));
  const admissions = [];

  const result = await orchestrateViewGroup(client, {
    planFile,
    outputDir: path.join(temporary, "budget"),
    admission: {
      beforeView: async context => {
        admissions.push(context);
        return context.view.view_id === "code_map"
          ? { allowed: false, code: "GROUP_BUDGET_EXHAUSTED", message: "合成组预算不足" }
          : { allowed: true };
      },
    },
  });

  assert.equal(result.status, "incomplete");
  assert.deepEqual(client.calls.map(call => call.viewId), ["architecture", "process"]);
  assert.equal(result.views[2].status, "pending");
  assert.equal(result.views[2].error.code, "GROUP_BUDGET_EXHAUSTED");
  assert.equal(result.usage.subrequests, 2);
  assert.equal(admissions[2].usage.tokens, 200);
});

test("an old backend without orchestration capability fails before generation", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const client = fakeClient(view => accepted(view, 100));
  client.getCapabilities = async () => ({ co_design: capabilities.co_design });

  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("unsupported"),
    outputDir: path.join(temporary, "unsupported"),
  });

  assert.equal(result.error.code, "INDEPENDENT_VIEWS_UNSUPPORTED");
  assert.equal(client.calls.length, 0);
});

test("authoring child usage stays exact without inventing co_design metadata", () => {
  const { usageFromResult } = require(modulePath);
  assert.deepEqual(usageFromResult({
    status: "ok",
    route: "authoring",
    usage: { model_calls: 0, tokens: 0, usage_complete: true },
  }), { kind: "authoring_zero", model_calls: 0, tokens: 0, usage_complete: true });
  assert.deepEqual(usageFromResult({ status: "error" }), {
    kind: "unknown",
    model_calls: null,
    tokens: null,
    usage_complete: false,
  });
});

test("authoring views do not receive the ordinary-diagram default palette flag", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const authored = plan();
  authored.interfaces = []; // This test checks authoring option selection only.
  for (const view of authored.views) {
    delete view.request;
    view.authoring = { kind: "cards", title: view.name, items: [{ id: view.view_id, title: view.view_id === "architecture" ? "系统架构" : "库存锁定接口" }] };
  }
  const client = {
    calls: [],
    getCapabilities: async () => capabilities,
    runGeneration: async options => {
      client.calls.push(options);
      const view = authored.views[client.calls.length - 1];
      return accepted(view, 0);
    },
  };
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("authoring-options", authored),
    outputDir: path.join(temporary, "authoring-options"),
  });
  assert.equal(result.status, "accepted");
  assert.equal(client.calls.length, 3);
  for (const options of client.calls) {
    assert(options.authoringFile.endsWith(".authoring.json"));
    assert.equal(JSON.parse(fs.readFileSync(options.authoringFile, "utf8")).kind, "cards");
    assert.notEqual(options.useDefaultPalette, true);
  }
});

test("client-side preflight rejection is not counted as a submitted child request", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const client = {
    getCapabilities: async () => capabilities,
    runGeneration: async () => ({ status: "error", error: { code: "PALETTE_UNSUPPORTED", message: "合成预检拒绝" } }),
  };
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("preflight-usage"),
    outputDir: path.join(temporary, "preflight-usage"),
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.usage.subrequests, 0);
  assert.equal(result.usage.receipts, 0);
});

test("accepted generation without an independent interactive HTML page remains incomplete", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const client = fakeClient(view => {
    const result = accepted(view, 100);
    delete result.html_url;
    delete result.html_content;
    return result;
  });
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("interactive-required"),
    outputDir: path.join(temporary, "interactive-required"),
  });
  assert.equal(result.status, "incomplete");
  assert(result.views.every(view => view.status !== "accepted"));
  assert(result.views.every(view => view.error.code === "VIEW_INTERACTIVE_DELIVERY_MISSING"));
});

test("accepted authoring exports exact CW from its own session when include_source is false", async () => {
  const { orchestrateViewGroup } = require(modulePath);
  const client = fakeClient(view => {
    const result = accepted(view, 0);
    delete result.cw_code;
    return result;
  });
  client.exported = [];
  client.exportCode = async (sessionId, targetDir, format) => {
    client.exported.push({ sessionId, targetDir, format });
    const viewId = sessionId.replace("session-", "");
    const filePath = path.join(targetDir, "diagram.cw");
    const view = plan().views.find(item => item.view_id === viewId);
    fs.writeFileSync(filePath, accepted(view, 0).cw_code, "utf8");
    return { status: "ok", file_path: filePath };
  };
  const result = await orchestrateViewGroup(client, {
    planFile: writePlan("source-export"),
    outputDir: path.join(temporary, "source-export"),
  });
  assert.equal(result.status, "accepted");
  assert.equal(client.exported.length, 3);
  for (const view of result.views) {
    const exported = client.exported.find(item => item.sessionId === view.session_id);
    assert(exported);
    assert.equal(exported.format, "cw");
    assert.equal(view.source_sha256, crypto.createHash("sha256").update(fs.readFileSync(view.artifacts.saved_cw_file, "utf8")).digest("hex"));
  }
});
