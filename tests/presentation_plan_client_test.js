const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(root, ".presentation-plan-test-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

function inputFile(name = "input.json") {
  const filename = path.join(temporary, name);
  fs.writeFileSync(filename, JSON.stringify({
    version: 1,
    source: "合成解析模块复用合成存储模块。",
    focus: "模块职责和复用",
    facts: [
      { id: "parser", kind: "entity", text: "解析模块", source_quote: "合成解析模块" },
      { id: "store", kind: "entity", text: "存储模块", source_quote: "合成存储模块" },
    ],
    requirements: [],
  }), "utf8");
  return filename;
}

function capabilities() {
  return {
    presentation_planning: {
      versions: [1], candidate_set_version: "presentation-candidates-v4", out_of_scope_route: "general",
      default_enabled: false, decision_stage: "before_authoring_model_materialization",
      independent_view_plan_version: 1,
      evidence_kinds: ["node", "edge", "annotation"], reference_kinds: ["entity_reference"],
    },
    independent_views: {
      versions: [1], execution: "client_orchestrated_single_diagrams",
      manifest_version: 1, native_layers: false,
    },
  };
}

function record() {
  const mainModel = { kind: "cards", title: "主图", items: [{ id: "parser", title: "解析模块" }] };
  const detailModel = { kind: "cards", title: "详情", items: [{ id: "parser", title: "解析模块" }], annotations: { version: 1, items: [{ id: "evidence", text: "src/parser.js:1-9 完整证据" }] } };
  return {
    version: 1,
    candidate_set_version: "presentation-candidates-v4",
    status: "selected",
    decision: { candidate_id: "main_detail", origin: "trusted_input" },
    selected: { route: "independent_views", plan: {
      version: 1,
      source: "合成解析模块复用合成存储模块。",
      views: [
        { view_id: "main", name: "主图", focus: "职责", abstraction: "macro", authoring: { version: 1, format: "json", source: mainModel }, annotations: { version: 1, items: [] } },
        { view_id: "details", name: "详情", focus: "证据", abstraction: "micro", authoring: { version: 1, format: "json", source: detailModel }, annotations: detailModel.annotations },
      ],
      facts: [
        { fact_id: "parser", view_id: "main", text: "解析模块", evidence: { kind: "node", id: "parser", label: "解析模块" } },
        { fact_id: "evidence", view_id: "details", text: "src/parser.js:1-9 完整证据", evidence: { kind: "annotation", id: "evidence" } },
      ],
      interfaces: [{ kind: "entity_reference", entity_id: "parser", name: "解析模块", endpoints: [
        { view_id: "main", fact_id: "parser", evidence: { kind: "node", id: "parser", label: "解析模块" } },
        { view_id: "details", fact_id: "evidence", evidence: { kind: "node", id: "parser", label: "解析模块" } },
      ] }],
    } },
    stage_events: [
      { stage: "presentation_plan_requested" },
      { stage: "candidates_constructed" },
      { stage: "presentation_decided" },
      { stage: "authoring_model_normalized" },
      { stage: "authoring_compiled" },
    ],
    usage: { provider_calls: 0, tokens: 0 },
    selection_issue: null,
  };
}

function clientFor(response, capability = capabilities()) {
  const calls = [];
  return {
    calls,
    getCapabilities: async () => capability,
    request: async (endpoint, payload) => { calls.push({ endpoint, payload }); return typeof response === "function" ? response() : response; },
  };
}

test("capability negotiation fails before submitting presentation facts", async () => {
  const { planPresentation } = require(path.join(root, "skills/interactive-architecture-diagram/scripts/generate_presentation_plan.cjs"));
  const client = clientFor(record(), { independent_views: capabilities().independent_views });
  const result = await planPresentation(client, { inputFile: inputFile(), outputDir: path.join(temporary, "unsupported"), choose: "main_detail" });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "PRESENTATION_PLANNING_UNSUPPORTED");
  assert.equal(client.calls.length, 0);
});

test("selected main/detail plan is validated and saved for the existing R2 executor", async () => {
  const { planPresentation } = require(path.join(root, "skills/interactive-architecture-diagram/scripts/generate_presentation_plan.cjs"));
  const client = clientFor(record());
  const outputDir = path.join(temporary, "selected");
  const result = await planPresentation(client, { inputFile: inputFile(), outputDir, choose: "main_detail" });
  assert.equal(result.status, "selected");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].endpoint, "/presentation-plan");
  assert.equal(client.calls[0].payload.choose, "main_detail");
  assert.equal(client.calls[0].payload.execute_jev, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.view_plan_file, "utf8")), record().selected.plan);
  assert.equal(result.authoring_file, null);
  assert(fs.existsSync(result.record_file));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.stage_events_file, "utf8")), record().stage_events);
});

test("selection_required is durable but never emits an executable plan", async () => {
  const { planPresentation } = require(path.join(root, "skills/interactive-architecture-diagram/scripts/generate_presentation_plan.cjs"));
  const pending = { ...record(), status: "selection_required", selected: null, decision: { candidate_id: null, origin: "not_selected" }, selection_issue: { code: "LOW_CONFIDENCE", reviewed: false } };
  const outputDir = path.join(temporary, "pending");
  const result = await planPresentation(clientFor(pending), { inputFile: inputFile(), outputDir, executeJev: true });
  assert.equal(result.status, "selection_required");
  assert.equal(result.selection_issue.code, "LOW_CONFIDENCE");
  assert.equal(result.view_plan_file, null);
  assert.equal(fs.existsSync(path.join(outputDir, "view-plan.json")), false);
});

test("post-decision model events cannot be relabelled as pre-authoring planning", async () => {
  const { planPresentation } = require(path.join(root, "skills/interactive-architecture-diagram/scripts/generate_presentation_plan.cjs"));
  const invalid = record();
  invalid.stage_events = [invalid.stage_events[0], invalid.stage_events[3], invalid.stage_events[4], invalid.stage_events[2]];
  const outputDir = path.join(temporary, "bad-stages");
  const result = await planPresentation(clientFor(invalid), { inputFile: inputFile(), outputDir, choose: "main_detail" });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "PRESENTATION_STAGE_ORDER_INVALID");
  assert.equal(fs.existsSync(path.join(outputDir, "view-plan.json")), false);
});

test("unknown evidence kinds and broken annotation/reference bindings are rejected", async () => {
  const { planPresentation } = require(path.join(root, "skills/interactive-architecture-diagram/scripts/generate_presentation_plan.cjs"));
  for (const mode of ["unknown", "annotation", "reference"]) {
    const invalid = record();
    if (mode === "unknown") invalid.selected.plan.facts[1].evidence.kind = "static_list";
    if (mode === "annotation") invalid.selected.plan.views[1].annotations.items[0].text = "被截短的备注";
    if (mode === "reference") delete invalid.selected.plan.interfaces[0].endpoints[1].evidence;
    const outputDir = path.join(temporary, `invalid-${mode}`);
    const result = await planPresentation(clientFor(invalid), { inputFile: inputFile(), outputDir, choose: "main_detail" });
    assert.equal(result.status, "error", mode);
    assert.equal(result.error.code, "PRESENTATION_EVIDENCE_INVALID", mode);
    assert.equal(fs.existsSync(path.join(outputDir, "view-plan.json")), false, mode);
  }
});

test("all public variants share capability preflight and direct authoring handoff", async () => {
  for (const variant of ["", "-pay", "-pptx", "-workbuddy"]) {
    const { planPresentation } = require(path.join(root, `skills/interactive-architecture-diagram${variant}/scripts/generate_presentation_plan.cjs`));
    const direct = record();
    direct.selected = { route: "authoring", authoring: { version: 1, format: "json", source: { kind: "cards", template: "stack-arch", template_version: 2 } } };
    const outputDir = path.join(temporary, `direct${variant || "-main"}`);
    const result = await planPresentation(clientFor(direct), { inputFile: inputFile(), outputDir, choose: "single_cards" });
    assert.equal(result.status, "selected", variant || "main");
    assert.equal(result.view_plan_file, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.authoring_file, "utf8")), direct.selected.authoring);
  }
});

test("each client rejects mismatched versions, entity IDs and invalid selection budgets", async () => {
  for (const variant of ["", "-pay", "-pptx", "-workbuddy"]) {
    const { planPresentation } = require(path.join(root, `skills/interactive-architecture-diagram${variant}/scripts/generate_presentation_plan.cjs`));
    for (const mode of ["version", "entity", "budget", "optin"]) {
      const response = record();
      const args = { inputFile: inputFile(), outputDir: path.join(temporary, `guard-${mode}${variant}`) };
      if (mode === "version") response.candidate_set_version = "presentation-candidates-v2";
      if (mode === "entity") response.selected.plan.interfaces[0].endpoints[1].evidence.id = "wrong_entity";
      if (mode === "budget") args.tokenLimit = 1000.5;
      if (mode === "optin") args.executeJev = "false";
      const client = clientFor(response);
      const result = await planPresentation(client, args);
      assert.equal(result.status, "error", `${variant} ${mode}`);
      if (mode === "budget" || mode === "optin") assert.equal(client.calls.length, 0);
      assert.equal(fs.existsSync(args.outputDir), false);
    }
  }
});

test("comparison input preserves its source and never produces authoring, including with an older planner", async () => {
  const filename = path.join(temporary, "comparison.json");
  const input = {
    source: "请作供应商对比矩阵。甲为十元，乙为十二元。", focus: "比较采购价格",
    facts: [
      { id: "a_price", kind: "comparison", text: "十元", source_quote: "甲为十元" },
      { id: "b_price", kind: "comparison", text: "十二元", source_quote: "乙为十二元" },
    ],
    comparison: {
      rows: [{ id: "price", title: "价格" }], columns: [{ id: "a", title: "甲" }, { id: "b", title: "乙" }],
      cells: [{ row_id: "price", column_id: "a", fact_id: "a_price" }, { row_id: "price", column_id: "b", fact_id: "b_price" }],
    },
  };
  fs.writeFileSync(filename, JSON.stringify(input));
  for (const suffix of ["", "-pay", "-pptx", "-workbuddy"]) {
    const { planPresentation } = require(path.join(root, `skills/interactive-architecture-diagram${suffix}/scripts/generate_presentation_plan.cjs`));
    for (const mode of ["current", "v3", "absent", "unexpected_matrix"]) {
      const cap = capabilities();
      const response = record();
      if (mode === "v3") {
        cap.presentation_planning.candidate_set_version = "presentation-candidates-v3";
        delete cap.presentation_planning.out_of_scope_route;
      } else if (mode === "absent") {
        delete cap.presentation_planning;
      } else if (mode === "current") {
        Object.assign(response, { status: "not_applicable", next_route: "general", candidates: [], selected: null, input });
      } else {
        response.selected = { route: "authoring", authoring: { version: 1, format: "json", source: { kind: "matrix" } } };
      }
      const client = clientFor(response, cap);
      const outputDir = path.join(temporary, `comparison${suffix}-${mode}`);
      const result = await planPresentation(client, { inputFile: filename, outputDir, choose: "comparison_matrix" });
      assert.equal(result.status, "not_applicable");
      assert.equal(result.next_route, "general");
      assert.equal(result.authoring_file, null);
      assert.deepEqual(JSON.parse(fs.readFileSync(result.presentation_input_file)), input);
      assert.equal(fs.existsSync(path.join(outputDir, "authoring.json")), false);
      assert.equal(client.calls.length, ["current", "unexpected_matrix"].includes(mode) ? 1 : 0);
    }
  }
});
