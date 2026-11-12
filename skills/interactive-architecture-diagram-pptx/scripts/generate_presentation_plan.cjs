#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { CWClient, printJson } = require("./cw_client.cjs");
const { validatePlan } = require("./view_group.cjs");

function failure(code, message, details) {
  return { status: "error", error: { code, message, ...(details ? { details } : {}) } };
}

function generalHandoff(inputFile) {
  return {
    status: "not_applicable", next_route: "general", presentation_input_file: inputFile,
    selected_route: null, authoring_file: null, view_plan_file: null,
  };
}

function withinWorkingDirectory(filename) {
  const relative = path.relative(fs.realpathSync(process.cwd()), filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readInput(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("PRESENTATION_INPUT_PATH_INVALID: inputFile 必须是绝对路径");
  const resolved = fs.realpathSync(filename);
  if (!withinWorkingDirectory(resolved) || !fs.statSync(resolved).isFile()) throw new Error("PRESENTATION_INPUT_PATH_INVALID: inputFile 必须是工作区内的普通文件");
  const value = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PRESENTATION_INPUT_INVALID: 输入必须是呈现事实 JSON 对象");
  return value;
}

function validateCapability(capabilities) {
  const support = capabilities?.presentation_planning;
  if (!support?.versions?.includes(1) || support.default_enabled !== false ||
      support.decision_stage !== "before_authoring_model_materialization" ||
      typeof support.candidate_set_version !== "string" || support.independent_view_plan_version !== 1 ||
      !support.evidence_kinds?.includes("annotation") || !support.reference_kinds?.includes("entity_reference")) {
    return failure("PRESENTATION_PLANNING_UNSUPPORTED", "后端未声明前置呈现规划 v1；不提交事实，也不改用事后 reading_views 冒充");
  }
  const independent = capabilities?.independent_views;
  if (!independent?.versions?.includes(1) || independent.execution !== "client_orchestrated_single_diagrams" ||
      independent.manifest_version !== 1 || independent.native_layers !== false) {
    return failure("PRESENTATION_PLANNING_UNSUPPORTED", "前置规划需要既有 independent_views v1 执行能力");
  }
  return null;
}

function validateStages(events) {
  const stages = Array.isArray(events) ? events.map(event => event?.stage) : [];
  const decided = stages.indexOf("presentation_decided");
  const normalized = stages.indexOf("authoring_model_normalized");
  const compiled = stages.indexOf("authoring_compiled");
  return decided >= 0 && normalized > decided && compiled > normalized;
}

function validateEvidenceContract(plan, support) {
  const views = new Map(plan.views.map(view => [view.view_id, view]));
  for (const fact of plan.facts) {
    const evidence = fact.evidence;
    if (!support.evidence_kinds.includes(evidence?.kind)) return false;
    const annotations = views.get(fact.view_id)?.annotations?.items || [];
    if (evidence.kind === "annotation") {
      const note = annotations.find(item => item.id === evidence.id);
      if (!note || !note.text.includes(fact.text)) return false;
    }
    if (evidence.full_text_annotation_id) {
      const note = annotations.find(item => item.id === evidence.full_text_annotation_id);
      if (!note || !note.text.includes(fact.text)) return false;
    }
  }
  for (const reference of plan.interfaces || []) {
    const kind = reference.kind || "directed_interface";
    if (!support.reference_kinds.includes(kind)) return false;
    if (kind === "entity_reference") {
      if (!reference.entity_id || new Set(reference.endpoints.map(endpoint => endpoint.view_id)).size < 2) return false;
      for (const endpoint of reference.endpoints) {
        if (endpoint.evidence?.kind !== "node" || endpoint.evidence.id !== reference.entity_id ||
            endpoint.evidence.label !== reference.name) return false;
      }
    }
  }
  return true;
}

function persist(outputDir, record) {
  const staging = `${outputDir}.pending-${process.pid}-${Date.now()}`;
  fs.mkdirSync(staging, { recursive: false });
  const write = (name, value) => fs.writeFileSync(path.join(staging, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  write("presentation-record.json", record);
  write("stage-events.json", record.stage_events);
  write("usage.json", record.usage);
  const result = {
    status: record.status,
    selected_route: record.selected?.route || null,
    selection_issue: record.selection_issue || null,
    usage: record.usage,
    record_file: path.join(outputDir, "presentation-record.json"),
    stage_events_file: path.join(outputDir, "stage-events.json"),
    view_plan_file: null,
    authoring_file: null,
  };
  if (record.selected?.route === "independent_views") {
    write("view-plan.json", record.selected.plan);
    result.view_plan_file = path.join(outputDir, "view-plan.json");
  } else if (record.selected?.route === "authoring") {
    write("authoring.json", record.selected.authoring);
    result.authoring_file = path.join(outputDir, "authoring.json");
  }
  fs.renameSync(staging, outputDir);
  return result;
}

async function planPresentation(client, { inputFile, outputDir, choose = null, executeJev = false, tokenLimit = null }) {
  let input;
  try {
    if (typeof executeJev !== "boolean" || (executeJev && choose)) {
      return failure("PRESENTATION_DECISION_INVALID", "模型选择需要显式布尔授权，并与指定候选互斥");
    }
    if (tokenLimit !== null && (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1024 || tokenLimit > 256000)) {
      return failure("PRESENTATION_BUDGET_INVALID", "选择预算应为 1024 到 256000 之间的整数");
    }
    input = readInput(inputFile);
    const outsidePlanner = input.comparison != null || (Array.isArray(input.requirements) &&
      input.requirements.some(rule => rule?.strength === "hard" && ["grid_columns", "grid_rows"].includes(rule.kind)));
    if (typeof outputDir !== "string" || !path.isAbsolute(outputDir)) return failure("PRESENTATION_OUTPUT_PATH_INVALID", "outputDir 必须是工作区内的绝对路径");
    outputDir = path.resolve(outputDir);
    if (!withinWorkingDirectory(outputDir) || fs.existsSync(outputDir)) return failure("PRESENTATION_OUTPUT_PATH_INVALID", "outputDir 必须位于工作区内且尚不存在");
    const capabilities = await client.getCapabilities();
    if (capabilities?.status === "error") return capabilities;
    if (outsidePlanner && capabilities?.presentation_planning?.out_of_scope_route !== "general") {
      return { ...generalHandoff(inputFile), origin: "client_scope", usage: { provider_calls: 0, tokens: 0 } };
    }
    const unsupported = validateCapability(capabilities);
    if (unsupported) return unsupported;
    const payload = { input, execute_jev: executeJev };
    if (choose) payload.choose = choose;
    if (tokenLimit !== null) payload.token_limit = tokenLimit;
    const record = await client.request("/presentation-plan", payload);
    if (record?.status === "error") return record;
    if (record?.version !== 1 || record.candidate_set_version !== capabilities.presentation_planning.candidate_set_version) {
      return failure("PRESENTATION_VERSION_MISMATCH", "规划回执与已协商的候选版本不一致");
    }
    if (record?.status === "not_applicable" && record.next_route === "general" &&
        record.selected === null && Array.isArray(record.candidates) && record.candidates.length === 0) {
      return { ...persist(outputDir, record), ...generalHandoff(inputFile) };
    }
    if (record?.status === "selection_required") {
      if (record.selected !== null) return failure("PRESENTATION_DECISION_INVALID", "待选择结果不得附带可执行模型");
      return persist(outputDir, record);
    }
    if (record?.status !== "selected" || !record.selected || !validateStages(record.stage_events)) {
      return failure("PRESENTATION_STAGE_ORDER_INVALID", "生产记录未证明选择先于规范模型物化与编译");
    }
    if (outsidePlanner || record.selected.authoring?.source?.kind === "matrix" ||
        record.selected.plan?.views?.some(view => view?.authoring?.source?.kind === "matrix")) {
      return { ...generalHandoff(inputFile), origin: "client_scope", usage: record.usage };
    }
    if (record.selected.route === "independent_views") {
      const checked = validatePlan(record.selected.plan);
      if (checked.fatal?.length || checked.coverage?.length) {
        return failure("VIEW_COVERAGE_INVALID", "后端返回的 R2 独立视图计划未通过事实与接口校验", { issues: [...(checked.fatal || []), ...(checked.coverage || [])] });
      }
      if (!validateEvidenceContract(record.selected.plan, capabilities.presentation_planning)) {
        return failure("PRESENTATION_EVIDENCE_INVALID", "全文 annotation 或 entity_reference 证据绑定不完整，或包含未协商类型");
      }
    } else if (record.selected.route === "authoring") {
      const authoring = record.selected.authoring;
      if (authoring?.version !== 1 || authoring.format !== "json" || !authoring.source || typeof authoring.source !== "object" || Array.isArray(authoring.source)) {
        return failure("PRESENTATION_DECISION_INVALID", "单图选择缺少可执行 authoring v1 JSON");
      }
    } else {
      return failure("PRESENTATION_DECISION_INVALID", "未知呈现执行路由");
    }
    return persist(outputDir, record);
  } catch (error) {
    const message = String(error.message || error);
    const match = message.match(/^([A-Z][A-Z0-9_]+):/);
    return failure(match?.[1] || "PRESENTATION_PLAN_CLIENT_FAILED", message);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith("-") ? next : "true";
    args[token] = value;
    if (value !== "true") index += 1;
  }
  return args;
}

async function main(argv = process.argv.slice(2), Client = CWClient) {
  const args = parseArgs(argv);
  const inputFile = args["--input_file"];
  const outputDir = args["--output_dir"];
  if (!inputFile || !outputDir) {
    const result = failure("MISSING_PRESENTATION_OPTIONS", "必须提供 --input_file 和 --output_dir；可选 --choose 或 --execute_jev");
    printJson(result);
    return result;
  }
  const tokenLimit = args["--token_limit"] === undefined ? null : Number(args["--token_limit"]);
  const result = await planPresentation(new Client(), {
    inputFile, outputDir, choose: args["--choose"] || null,
    executeJev: args["--execute_jev"] === "true", tokenLimit,
  });
  printJson(result);
  return result;
}

module.exports = { planPresentation, validateCapability, validateStages, main };

if (require.main === module) {
  main().then(result => {
    if (result.status !== "selected") process.exitCode = 1;
  }).catch(error => {
    printJson(failure("PRESENTATION_PLAN_CLI_FAILED", String(error.message || error)));
    process.exitCode = 1;
  });
}
