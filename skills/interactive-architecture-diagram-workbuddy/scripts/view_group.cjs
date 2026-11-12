const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { normalizeAnnotations } = require("./annotations.cjs");
const { verifyViewCoverage } = require("./view_evidence.cjs");
const { authoringEnvelope } = require("./authoring.cjs");
const { downloadAssetsLocally } = require("./cw_client.cjs");

const PLAN_VERSION = 1;
const MANIFEST_VERSION = 1;
const MANIFEST_FILENAME = "view-group-manifest.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function planHash(plan) {
  return sha256(JSON.stringify(canonical(plan)));
}

function failure(code, message, details) {
  return { status: "error", error: { code, message, ...(details ? { details } : {}) } };
}

function withinWorkingDirectory(filename) {
  const relative = path.relative(process.cwd(), filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

function atomicJson(filename, value) {
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filename);
}

function validatePlan(raw) {
  const issues = [];
  const coverage = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== PLAN_VERSION) {
    return { fatal: [{ code: "VIEW_PLAN_VERSION_REQUIRED", message: "view plan requires version:1" }] };
  }
  const plan = JSON.parse(JSON.stringify(raw));
  if (typeof plan.source !== "string" || !plan.source.trim()) {
    issues.push({ code: "VIEW_SOURCE_REQUIRED", message: "shared source material is required" });
  }
  if (!Array.isArray(plan.views) || plan.views.length < 2 || plan.views.length > 16) {
    issues.push({ code: "VIEWS_REQUIRED", message: "an independent view group requires 2 to 16 views" });
    return { fatal: issues };
  }
  const viewIds = new Set();
  for (const [index, view] of plan.views.entries()) {
    const prefix = `views[${index}]`;
    if (!view || typeof view !== "object" || Array.isArray(view)) {
      issues.push({ code: "VIEW_INVALID", path: prefix });
      continue;
    }
    if (typeof view.view_id !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(view.view_id) || viewIds.has(view.view_id)) {
      issues.push({ code: "VIEW_ID_INVALID", path: `${prefix}.view_id` });
    }
    viewIds.add(view.view_id);
    for (const field of ["name", "focus", "abstraction"]) {
      if (typeof view[field] !== "string" || !view[field].trim()) issues.push({ code: "VIEW_FIELD_REQUIRED", path: `${prefix}.${field}` });
    }
    const inputs = [view.request, view.authoring, view.outline].filter(value => value !== undefined);
    if (inputs.length !== 1 || (view.request !== undefined && (typeof view.request !== "string" || !view.request.trim()))) {
      issues.push({ code: "VIEW_INPUT_REQUIRED", path: prefix, message: "provide exactly one of request, authoring, or outline" });
    }
    if (view.authoring !== undefined) {
      const document = authoringEnvelope(view.authoring);
      if (document.error) issues.push({ ...document.error, path: prefix + ".authoring" });
      else if (view.annotations === undefined && document.format === "json" && document.source.annotations) {
        view.annotations = document.source.annotations;
      }
    }
    if (view.annotations !== undefined) {
      try { view.annotations = normalizeAnnotations(view.annotations); }
      catch (error) { issues.push({ code: "VIEW_ANNOTATIONS_INVALID", path: `${prefix}.annotations`, message: String(error.message) }); }
    } else {
      view.annotations = { version: 1, items: [] };
    }
  }
  if (!Array.isArray(plan.facts) || plan.facts.length === 0) {
    coverage.push({ code: "FACTS_REQUIRED", message: "every required fact must have exactly one responsible view" });
    plan.facts = Array.isArray(plan.facts) ? plan.facts : [];
  }
  const facts = new Map();
  for (const [index, fact] of plan.facts.entries()) {
    const prefix = `facts[${index}]`;
    if (!fact || typeof fact !== "object" || typeof fact.fact_id !== "string" || !fact.fact_id.trim()) {
      coverage.push({ code: "FACT_ID_REQUIRED", path: prefix });
      continue;
    }
    if (facts.has(fact.fact_id)) {
      coverage.push({ code: "FACT_OWNERSHIP_CONFLICT", fact_id: fact.fact_id });
      continue;
    }
    facts.set(fact.fact_id, fact);
    if (typeof fact.text !== "string" || !fact.text.trim()) coverage.push({ code: "FACT_TEXT_REQUIRED", fact_id: fact.fact_id });
    if (typeof fact.view_id !== "string" || !fact.view_id) {
      coverage.push({ code: "FACT_VIEW_REQUIRED", fact_id: fact.fact_id });
    } else if (!viewIds.has(fact.view_id)) {
      coverage.push({ code: "FACT_VIEW_UNKNOWN", fact_id: fact.fact_id, view_id: fact.view_id });
    }
  }
  if (plan.interfaces !== undefined && !Array.isArray(plan.interfaces)) {
    coverage.push({ code: "INTERFACES_INVALID", path: "interfaces" });
    plan.interfaces = [];
  }
  for (const [index, relation] of (plan.interfaces || []).entries()) {
    const prefix = `interfaces[${index}]`;
    if (!relation || typeof relation !== "object" || typeof relation.name !== "string" || !relation.name.trim()) {
      coverage.push({ code: "INTERFACE_NAME_REQUIRED", path: prefix });
      continue;
    }
    if (!Array.isArray(relation.endpoints) || relation.endpoints.length < 2) {
      coverage.push({ code: "INTERFACE_ENDPOINTS_REQUIRED", interface: relation.name });
      continue;
    }
    const endpoints = new Set();
    if (new Set(relation.endpoints.map(endpoint => endpoint?.view_id)).size < 2) {
      coverage.push({ code: "INTERFACE_DISTINCT_VIEWS_REQUIRED", interface: relation.name });
    }
    for (const endpoint of relation.endpoints) {
      const key = `${endpoint?.view_id}:${endpoint?.fact_id}`;
      if (endpoints.has(key)) coverage.push({ code: "INTERFACE_ENDPOINT_CONFLICT", interface: relation.name });
      endpoints.add(key);
      const fact = facts.get(endpoint?.fact_id);
      if (!fact || !viewIds.has(endpoint?.view_id) || fact.view_id !== endpoint.view_id) {
        coverage.push({ code: "INTERFACE_ENDPOINT_MISMATCH", interface: relation.name, endpoint });
      }
    }
  }
  return { plan, fatal: issues, coverage };
}

function sanitizeReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  const result = JSON.parse(JSON.stringify(receipt));
  delete result.access_token;
  delete result.request_token;
  return result;
}

function unknownUsage() {
  return { kind: "unknown", model_calls: null, tokens: null, usage_complete: false };
}

function usageFromResult(result, previousAttempts = []) {
  const wire = result?.usage;
  const co = result?.co_design;
  const cumulative = wire?.kind === "workflow_total" || (!wire && !!co?.budget_used);
  const tokens = wire ? wire.tokens : co?.budget_used?.tokens;
  const calls = wire ? wire.model_calls : co?.budget_used?.calls;
  if (![tokens, calls].every(n => Number.isSafeInteger(n) && n >= 0)) return unknownUsage();
  const explicitlyUncalled = !wire && co.provider?.outcome === "not_called" && !tokens && !calls && co.usage_complete !== false;
  const complete = (wire ? wire.usage_complete : co.usage_complete) === true || explicitlyUncalled;
  const workflowId = co?.continuation_session_id || result.session_id;
  const previous = cumulative && workflowId && [...previousAttempts].reverse().find(a =>
    (a.workflow_session_id || a.session_id) === workflowId && a.usage?.workflow_total);
  const usedTokens = tokens - (previous?.usage?.workflow_total?.tokens || 0);
  const usedCalls = calls - (previous?.usage?.workflow_total?.model_calls || 0);
  if (usedTokens < 0 || usedCalls < 0) return unknownUsage();
  const total = cumulative ? { workflow_total: { model_calls: calls, tokens } } : {};
  if (!complete) return { ...unknownUsage(), ...total, known_tokens: usedTokens, known_model_calls: usedCalls };
  const kind = result.route === "authoring" && !calls && !tokens ? "authoring_zero" :
    explicitlyUncalled ? "not_called" : cumulative ? "workflow_total" : "increment";
  return { kind, model_calls: usedCalls, tokens: usedTokens, ...total, usage_complete: true };
}

function summarizeUsage(views) {
  const attempts = views.flatMap(view => view.attempts || []);
  const unknown = attempts.some(attempt => attempt.usage?.usage_complete !== true);
  return {
    subrequests: attempts.filter(attempt => attempt.submitted !== false).length,
    model_calls: unknown ? null : attempts.reduce((sum, attempt) => sum + attempt.usage.model_calls, 0),
    tokens: unknown ? null : attempts.reduce((sum, attempt) => sum + attempt.usage.tokens, 0),
    known_model_calls: attempts.reduce((sum, attempt) => sum + (attempt.usage?.known_model_calls ?? attempt.usage?.model_calls ?? 0), 0),
    known_tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage?.known_tokens ?? attempt.usage?.tokens ?? 0), 0),
    usage_complete: !unknown,
    usage_kinds: [...new Set(attempts.map(attempt => attempt.usage?.kind || "unknown"))].sort(),
    receipts: attempts.filter(attempt => attempt.receipt).length,
  };
}

function emptyView(view) {
  return {
    view_id: view.view_id,
    name: view.name,
    focus: view.focus,
    abstraction: view.abstraction,
    status: "pending",
    quality: "not_checked",
    revision: null,
    session_id: null,
    source_sha256: null,
    annotations: { count: view.annotations.items.length, ids: view.annotations.items.map(item => item.id) },
    artifacts: {},
    coverage: { status: "unverified", issues: [{ code: "PRODUCT_NOT_GENERATED" }] },
    attempts: [],
    error: null,
  };
}

function createManifest(plan, plan_sha256) {
  return {
    version: MANIFEST_VERSION,
    group_id: `view-group-${plan_sha256.slice(0, 16)}`,
    status: "incomplete",
    plan_sha256,
    plan,
    coverage: { status: "unverified", issues: [{ code: "PRODUCT_NOT_GENERATED", message: "输入计划有效，但产物覆盖尚未核验" }] },
    budget: { status: "unverified", message: "未接入 R6 预留账本；事后累计不证明组上限受保护" },
    views: plan.views.map(emptyView),
    usage: { subrequests: 0, model_calls: 0, tokens: 0, usage_complete: true, receipts: 0 },
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function buildIndexHtml(manifest) {
  const items = manifest.views.map(view => {
    const official = view.artifacts.html_url;
    const local = view.artifacts.saved_html_file ? pathToFileURL(view.artifacts.saved_html_file).href : null;
    const href = official || local;
    const link = href ? `<a href="${escapeHtml(href)}">打开官方交互页</a>` : "尚无交互页";
    const localLink = local && official ? ` · <a href="${escapeHtml(local)}">本地副本</a>` : "";
    const source = view.artifacts.saved_cw_file ? `<a href="${escapeHtml(pathToFileURL(view.artifacts.saved_cw_file).href)}">本图 CW</a>` : "尚无图源";
    return `<li data-view-id="${escapeHtml(view.view_id)}" data-session-id="${escapeHtml(view.session_id)}" data-source-sha256="${escapeHtml(view.source_sha256)}"><h2>${escapeHtml(view.name)}</h2><p>${escapeHtml(view.focus)} · ${escapeHtml(view.abstraction)}</p><p>状态：${escapeHtml(view.status)}；备注：${view.annotations.count} 条</p><p>${link}${localLink} · ${source}</p><details><summary>技术诊断</summary><code>session=${escapeHtml(view.session_id || "无")}</code><br><code>source_sha256=${escapeHtml(view.source_sha256 || "无")}</code></details></li>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>独立视图目录</title><style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem}li{margin:1rem 0;padding:1rem;border:1px solid #ccd;border-radius:8px}code{overflow-wrap:anywhere}</style></head><body><h1>独立视图目录</h1><p>每个条目链接到独立单图及其自己的会话、图源和备注。本目录不是原生 layers 或多画板。</p><p>整组状态：${escapeHtml(manifest.status)}</p><ol>${items}</ol></body></html>\n`;
}

function persist(outputDir, manifest) {
  const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
  const indexPath = path.join(outputDir, "index.html");
  manifest.usage = summarizeUsage(manifest.views);
  manifest.updated_at = new Date().toISOString();
  atomicJson(manifestPath, manifest);
  fs.writeFileSync(indexPath, buildIndexHtml(manifest), "utf8");
  return { manifest_path: manifestPath, index_file: indexPath };
}

function publicResult(outputDir, manifest) {
  const files = persist(outputDir, manifest);
  return { ...manifest, ...files };
}

function requestFor(plan, view) {
  const facts = (plan.facts || []).filter(fact => fact.view_id === view.view_id);
  const interfaces = (plan.interfaces || []).filter(relation => relation.endpoints.some(endpoint => endpoint.view_id === view.view_id));
  const constraints = [...(plan.hard_constraints || []), ...(view.hard_constraints || [])];
  return [
    "共享原始材料：",
    plan.source,
    "",
    `当前独立视图：view_id=${view.view_id}，名称=${view.name}，焦点=${view.focus}，抽象层级=${view.abstraction}。`,
    `本图任务：${view.request || "按上述焦点生成这一张独立单图。"}`,
    "本图负责事实（均为硬约束）：",
    JSON.stringify(facts, null, 2),
    "涉及本图的跨视图接口（均为硬约束）：",
    JSON.stringify(interfaces, null, 2),
    "其他硬约束：",
    JSON.stringify(constraints, null, 2),
    "只生成这一张独立单图，不使用 layers，不合并其他视图，也不以容器替代独立页面。",
  ].join("\n");
}

function outlineFor(plan, view, tokenLimit) {
  const outline = JSON.parse(JSON.stringify(view.outline));
  outline.source = `${requestFor(plan, view)}\n\n原始 outline 材料：\n${outline.source}`;
  if (tokenLimit !== null) outline.budget = { ...(outline.budget || {}), max_tokens: tokenLimit };
  return outline;
}

async function generateOne(client, plan, view, outputDir, recovery = null, tokenLimit = null, edits = null) {
  const rootDir = path.join(outputDir, "views", view.view_id);
  const viewDir = recovery ? path.join(rootDir, "attempt-" + (recovery.attempts.length + 1)) : rootDir;
  const workDir = path.join(outputDir, ".work");
  fs.mkdirSync(viewDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  const annotationsFile = path.join(workDir, `${view.view_id}.annotations.json`);
  fs.writeFileSync(annotationsFile, JSON.stringify(view.annotations), "utf8");
  const options = {
    userRequest: requestFor(plan, view),
    annotationsFile,
    validateRequestLength: true,
    useDefaultPalette: !view.authoring && !recovery,
  };
  if (tokenLimit !== null) options.tokenLimit = tokenLimit;
  if (recovery) {
    options.sessionId = recovery.continuation_session_id || recovery.session_id;
    if (recovery.revision !== null && recovery.revision !== undefined) options.coDesignRevision = recovery.revision;
    if (view.authoring) {
      delete options.userRequest;
      const exported = await client.exportCode(recovery.session_id, viewDir, "authoring");
      if (exported?.status === "error" || !exported.saved_authoring_file) throw new Error("VIEW_RECOVERY_SOURCE_INVALID: 无法恢复当前 authoring 规范模型");
      options.authoringFile = exported.saved_authoring_file;
      if (edits?.[view.view_id]) {
        options.authoringFile = path.join(workDir, view.view_id + ".edit.authoring.json");
        fs.writeFileSync(options.authoringFile, JSON.stringify(edits[view.view_id]), "utf8");
      }
    } else {
      options.cwSourceFile = recovery.artifacts.saved_cw_file;
      options.userRequest = `${requestFor(plan, view)}\n\n在现有子工作流上继续，保留原 session、revision、精确 CW 和全部硬约束。`;
    }
  }
  if (view.authoring && !recovery) {
    options.authoringFile = path.join(workDir, `${view.view_id}.authoring.json`);
    fs.writeFileSync(options.authoringFile, JSON.stringify(view.authoring), "utf8");
    delete options.userRequest;
    if (authoringEnvelope(view.authoring).format === "html" && !view.annotations.items.length) delete options.annotationsFile;
  }
  if (view.outline && !recovery) {
    options.outlineFile = path.join(workDir, `${view.view_id}.outline.json`);
    fs.writeFileSync(options.outlineFile, JSON.stringify(outlineFor(plan, view, tokenLimit)), "utf8");
  }
  const result = await client.runGeneration(options);
  return { result, viewDir };
}

const COVERAGE_VALIDATOR_VERSION = 2;

function htmlContext(filename) {
  if (!filename || !fs.existsSync(filename)) return null;
  const html = fs.readFileSync(filename, "utf8");
  const match = html.match(/<script\b[^>]*\bid="cw-diagram-context"[^>]*>([\s\S]*?)<\/script>/u);
  return match ? JSON.parse(match[1]) : null;
}

function assessCoverage(plan, planned, result, artifacts) {
  const input = planned.outline ? outlineFor(plan, planned, null).source : requestFor(plan, planned);
  return { ...verifyViewCoverage(plan, planned, result, artifacts, input), validator_version: COVERAGE_VALIDATOR_VERSION };
}

function restoreCoverage(plan, planned, view) {
  if (view.coverage?.validator_version === COVERAGE_VALIDATOR_VERSION) return;
  const dir = path.dirname(view.artifacts.saved_cw_file);
  const canonical = view.artifacts.saved_authoring_file || path.join(dir, "diagram.authoring.json");
  try {
    const result = { diagram_context: htmlContext(view.artifacts.saved_html_file) };
    if (planned.authoring && fs.existsSync(canonical)) result.authoring_model = readJson(canonical);
    if (view.artifacts.saved_coverage_evidence_file) result.co_design = { coverage_evidence: readJson(view.artifacts.saved_coverage_evidence_file) };
    view.coverage = assessCoverage(plan, planned, result, view.artifacts);
    if (view.coverage.annotations) view.annotations = view.coverage.annotations;
  } catch (error) {
    view.coverage = { status: "unverified", issues: [{ code: "SAVED_EVIDENCE_UNAVAILABLE", message: String(error.message || error) }] };
  }
}

function summarizeCoverage(manifest) {
  const issues = manifest.views.flatMap(view => (view.coverage?.issues || []).map(issue => ({ view_id: view.view_id, ...issue })));
  const rejected = manifest.views.some(view => view.coverage?.status === "rejected");
  const complete = manifest.views.every(view => view.status === "accepted" && view.coverage?.status === "accepted");
  return { status: rejected ? "rejected" : complete ? "accepted" : "unverified", issues };
}

async function saveAssets(client, result, viewDir, status, planned = null) {
  const artifacts = {
    html_url: result.html_url || null,
    svg_url: result.raw_svg_url || result.svg_url || null,
  };
  if (status === "failed" && result.status === "error" && !result.cw_code && !result.co_design?.candidate?.d2_code &&
      !result.html_url && !result.svg_url && !result.svg_content && !result.html_content &&
      !result.artifacts?.some(item => item.available)) return artifacts;
  let source = result.cw_code;
  let sourceName = "diagram.cw";
  const candidate = result.co_design?.candidate?.d2_code;
  const published = status === "accepted" || hasInteractiveDelivery(result) ||
    result.artifacts?.some(item => item.available) || result.svg_url || result.svg_content;
  if (typeof source !== "string" && result.session_id && published) {
    const exported = await client.exportCode(result.session_id, viewDir, "cw");
    if (exported?.status === "error") throw new Error("VIEW_SOURCE_RECOVERY_FAILED: " + (exported.error?.message || "session export failed"));
    const filename = exported?.file_path || path.join(viewDir, "diagram.cw");
    source = fs.readFileSync(filename, "utf8");
    if (planned?.authoring && exported.saved_authoring_file) result.authoring_model = readJson(exported.saved_authoring_file);
  }
  if (planned?.authoring && published && !result.authoring_model && result.session_id) {
    const exported = await client.exportCode(result.session_id, viewDir, "authoring");
    if (!exported?.saved_authoring_file) throw new Error("VIEW_SOURCE_RECOVERY_FAILED: " + (exported?.error?.message || "missing canonical authoring model"));
    result.authoring_model = readJson(exported.saved_authoring_file);
  }
  if (typeof source !== "string" && typeof candidate === "string") {
    source = candidate;
    sourceName = "candidate.cw";
  }
  if (typeof source === "string") {
    artifacts.saved_cw_file = path.join(viewDir, sourceName);
    fs.writeFileSync(artifacts.saved_cw_file, source, "utf8");
    artifacts.source_sha256 = sha256(source);
  }
  for (const format of ["html", "svg"]) {
    const content = result[`${format}_content`];
    if (typeof content === "string" && content.trim()) {
      artifacts[`saved_${format}_file`] = path.join(viewDir, `diagram.${format}`);
      fs.writeFileSync(artifacts[`saved_${format}_file`], content, "utf8");
    }
  }
  if (published && (!artifacts.saved_html_file || !artifacts.saved_svg_file)) {
    const downloaded = await downloadAssetsLocally({ ...result, output_name: "diagram", output_dir: viewDir }, client);
    for (const format of ["html", "svg"]) {
      if (downloaded[`saved_${format}_file`]) artifacts[`saved_${format}_file`] = downloaded[`saved_${format}_file`];
    }
    artifacts.warnings = downloaded.warnings || [];
  }
  result.diagram_context = htmlContext(artifacts.saved_html_file) || result.diagram_context;
  if (planned?.authoring && result.authoring_model) {
    artifacts.saved_authoring_file = path.join(viewDir, "diagram.authoring.json");
    atomicJson(artifacts.saved_authoring_file, result.authoring_model);
  }
  if (result.co_design?.coverage_evidence) {
    artifacts.saved_coverage_evidence_file = path.join(viewDir, "coverage-evidence.json");
    atomicJson(artifacts.saved_coverage_evidence_file, result.co_design.coverage_evidence);
  }
  if (status === "accepted" && !artifacts.saved_html_file) throw new Error("VIEW_INTERACTIVE_DELIVERY_MISSING: accepted response has no accessible HTML");
  if (status === "accepted" && !artifacts.saved_cw_file) throw new Error("VIEW_SOURCE_MISSING: accepted response has no exact CW source");
  return artifacts;
}

function hasInteractiveDelivery(result) {
  return Boolean(result.html_url || result.html_content || result.artifacts?.some(artifact => artifact.available && artifact.format === "html"));
}

function viewOutcome(result) {
  const accepted = result.status === "ok" && result.quality === "accepted" && result.delivery === "final" && result.session_id &&
    (!result.co_design || result.co_design.status === "accepted");
  if (accepted) return hasInteractiveDelivery(result) ? "accepted" : "failed";
  if (result.status === "error" && result.delivery === "none" && !result.artifacts?.some(item => item.available)) return "failed";
  if (result.status === "ok" || result.quality === "rejected" || result.delivery === "draft" || result.artifacts?.length || result.co_design?.candidate?.d2_code) return "draft";
  return "failed";
}

function applyResult(view, result, artifacts, status, coverage, replaceLatest = false) {
  view.status = status;
  view.coverage = coverage;
  if (coverage.annotations) view.annotations = coverage.annotations;
  view.quality = status === "accepted" ? "accepted" : result.quality || "not_checked";
  const hasPreviousSource = !artifacts.saved_cw_file && !!view.artifacts?.saved_cw_file;
  if (!hasPreviousSource) {
    view.session_id = artifacts.saved_cw_file ? result.session_id || null : null;
    view.revision = result.co_design?.revision ?? result.source_revision ?? null;
    view.continuation_session_id = result.co_design?.continuation_session_id || view.session_id;
    view.source_sha256 = artifacts.source_sha256 || null;
    view.artifacts = artifacts;
  } else if (result.co_design?.revision !== undefined && (result.co_design.continuation_session_id || result.session_id) === view.continuation_session_id) {
    view.revision = result.co_design.revision;
  }
  view.error = status === "accepted" ? null : result.error ||
    (result.quality === "accepted" && !hasInteractiveDelivery(result) ? { code: "VIEW_INTERACTIVE_DELIVERY_MISSING", message: "该图缺少独立官方交互页，PPTX/SVG-only 不能完成多视图交付" } :
      { code: "VIEW_NOT_ACCEPTED", message: "该图仍是草稿，整组不能验收" });
  const serverResult = result.saved_request_record || result.receipt || result.usage || result.outcome_version || result.co_design ||
    result.session_id || result.cw_code || result.artifacts?.length || result.status === "ok";
  const localRejection = /^(?:INVALID_(?:REQUEST_LENGTH|DIAGRAM_TYPE|AUTHORING_(?:SOURCE|JSON|FORMAT)|OUTLINE_(?:FILE|INTENT|JSON)|ANNOTATIONS)|OUTLINE_(?:FILE_.+|PATH_OUTSIDE_WORKSPACE)|PALETTE_(?:UNSUPPORTED|REQUIRED|CONFLICT)|AUTHORING_(?:OPTION_CONFLICT|FILE_.+|PATH_OUTSIDE_WORKSPACE|UNSUPPORTED)|CW_SOURCE_CONFLICT|FILE_NOT_FOUND)$/u;
  const submitted = Boolean(serverResult || !localRejection.test(result.error?.code || ""));
  const attempt = {
    status,
    session_id: result.session_id || null,
    workflow_session_id: result.co_design?.continuation_session_id || result.session_id || null,
    submitted,
    usage: submitted ? usageFromResult(result, replaceLatest ? view.attempts.slice(0, -1) : view.attempts) :
      { kind: "not_called", model_calls: 0, tokens: 0, usage_complete: true },
    receipt: sanitizeReceipt(result.receipt),
    request_id: result.request_id || null,
    saved_request_record: result.saved_request_record || null,
    error: result.error || null,
    outcome_confirmed: !!result.outcome_version || !!result.usage?.usage_complete,
    completed_at: new Date().toISOString(),
  };
  if (replaceLatest && view.attempts.length) view.attempts[view.attempts.length - 1] = attempt;
  else view.attempts.push(attempt);
}

function verifyAcceptedSource(view) {
  const sourcePath = view.artifacts?.saved_cw_file;
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`accepted view ${view.view_id} has no recoverable source`);
  const actual = sha256(fs.readFileSync(sourcePath, "utf8"));
  if (actual !== view.source_sha256) throw new Error(`accepted view ${view.view_id} source hash mismatch`);
}

function recoverySource(view) {
  const sourcePath = view.artifacts?.saved_cw_file;
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("VIEW_RECOVERY_SOURCE_INVALID: 当前视图缺少可恢复 CW");
  const source = fs.readFileSync(sourcePath, "utf8");
  if (sha256(source) !== view.source_sha256) throw new Error("VIEW_RECOVERY_SOURCE_INVALID: 当前 CW 与 manifest 摘要不一致");
  return source;
}

async function resolveUnknownResult(client, view) {
  const attempt = view.attempts?.[view.attempts.length - 1];
  if (!attempt || attempt.receipt || !attempt.saved_request_record) return { unconfirmed: Boolean(attempt && !attempt.receipt) };
  try {
    const record = readJson(attempt.saved_request_record);
    if (!record.request_id || !record.request_token || typeof client.getRequestReceipt !== "function") return { unconfirmed: true };
    const queried = await client.getRequestReceipt({ requestId: record.request_id, token: record.request_token });
    if (queried?.receipt?.status === "succeeded" && queried.result) {
      return { result: { ...queried.result, receipt: queried.receipt, request_id: record.request_id, saved_request_record: attempt.saved_request_record } };
    }
    if (["failed", "refunded", "cancelled"].includes(queried?.receipt?.status)) return { knownFailure: true, receipt: queried.receipt };
    return { unconfirmed: true };
  } catch (_) {
    return { unconfirmed: true };
  }
}

function settleUsage(attempt) {
  if (attempt.usage.usage_complete) return { total_tokens: attempt.usage.tokens, model_calls: attempt.usage.model_calls };
  if (attempt.usage.known_tokens > 0) return { usage_complete: false, known_tokens: attempt.usage.known_tokens };
  return null;
}

function updateBudgetSnapshot(manifest, snapshot) {
  if (!snapshot) return;
  manifest.budget.snapshot = snapshot;
  for (const view of manifest.views) {
    const attempt = view.budget_attempt;
    const entry = attempt && snapshot.attempts?.[attempt.attempt_id];
    if (entry) attempt.state = entry.status;
  }
}

async function finishReservation(budget, manifest, view, submitted, usage, receiptConfirmed = false) {
  const attempt = view.budget_attempt;
  try {
    const result = !submitted ? await budget.release(attempt.attempt_id) :
      (receiptConfirmed && usage?.total_tokens !== undefined && attempt.state === "settled" && budget.reconcile ?
        await budget.reconcile(attempt.attempt_id, usage) : await budget.settle(attempt.attempt_id, usage));
    attempt.state = submitted ? "settled" : "released";
    updateBudgetSnapshot(manifest, result?.snapshot);
    delete attempt.error;
  } catch (error) {
    attempt.error = { code: "VIEW_BUDGET_SETTLEMENT_FAILED", message: String(error.message || error) };
    // The server persists overages before returning an error. Never re-settle
    // known usage as unknown, and never count a settlement error as a child run.
    if (budget.snapshot) {
      try { updateBudgetSnapshot(manifest, await budget.snapshot()); }
      catch { manifest.budget.status = "state_unconfirmed"; }
    }
  }
}

async function consumeResult(client, plan, planned, view, result, viewDir, replaceLatest = false) {
  let status = viewOutcome(result);
  let artifacts = {};
  let coverage;
  try {
    artifacts = await saveAssets(client, result, viewDir, status, planned);
    coverage = assessCoverage(plan, planned, result, artifacts);
  } catch (error) {
    const message = String(error.message || error);
    const assetError = { code: message.match(/^VIEW_[A-Z_]+(?=:)/)?.[0] || "VIEW_ARTIFACT_RECOVERY_FAILED", message };
    coverage = { status: "unverified", issues: [assetError] };
    result = { ...result, error: result.error || assetError };
    status = "failed";
  }
  applyResult(view, result, artifacts, status, coverage, replaceLatest);
  return view.attempts.at(-1);
}

function updateGroupStatus(manifest) {
  manifest.coverage = summarizeCoverage(manifest);
  const ready = manifest.views.every(v => v.status === "accepted" && !v.budget_attempt?.error);
  const accounted = manifest.budget.status !== "state_unconfirmed" && manifest.budget.snapshot?.usage_complete !== false;
  manifest.status = ready && manifest.coverage.status === "accepted" && accounted ? "accepted" : "incomplete";
}

async function orchestrateViewGroup(client, { planFile, outputDir, resume = false, admission = null, budget = null, edits = null }) {
  try {
    if (typeof outputDir !== "string" || !path.isAbsolute(outputDir)) return failure("VIEW_OUTPUT_PATH_INVALID", "outputDir 必须是工作区内的绝对路径");
    outputDir = path.resolve(outputDir);
    if (!withinWorkingDirectory(outputDir)) return failure("VIEW_OUTPUT_PATH_INVALID", "outputDir 必须位于工作区内");
    const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
    if (!resume && fs.existsSync(manifestPath)) return failure("VIEW_GROUP_EXISTS", "已有 manifest；使用 resume 恢复，避免覆盖已接受图源");
    let plan;
    let manifest;
    if (resume) {
      if (!fs.existsSync(manifestPath)) return failure("VIEW_GROUP_MANIFEST_NOT_FOUND", "没有可恢复的 view-group manifest");
      manifest = readJson(manifestPath);
      if (manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.views)) return failure("VIEW_GROUP_MANIFEST_INVALID", "manifest 版本或结构不受支持");
      plan = manifest.plan;
      if (planFile) {
        if (!path.isAbsolute(planFile)) return failure("VIEW_PLAN_PATH_INVALID", "planFile 必须是绝对路径");
        const supplied = readJson(fs.realpathSync(planFile));
        if (planHash(supplied) !== manifest.plan_sha256 && planHash(validatePlan(supplied).plan || {}) !== manifest.plan_sha256) return failure("VIEW_PLAN_CHANGED", "计划摘要与 manifest 不一致；创建新视图组，不能覆盖旧组");
      }
      const checked = validatePlan(plan);
      if (checked.fatal?.length || checked.coverage?.length) return failure("VIEW_GROUP_MANIFEST_INVALID", "保存的计划未通过校验", { issues: [...(checked.fatal || []), ...(checked.coverage || [])] });
      for (const view of manifest.views) {
        if (view.status === "accepted") verifyAcceptedSource(view);
        if (view.status === "running") {
          view.status = "pending";
          view.error = { code: "VIEW_RECEIPT_UNCONFIRMED", message: "上次执行中断，原请求结果未知；必须先查询回执，不能自动重试" };
        }
      }
    } else {
      if (typeof planFile !== "string" || !path.isAbsolute(planFile)) return failure("VIEW_PLAN_PATH_INVALID", "planFile 必须是工作区内的绝对路径");
      const resolved = fs.realpathSync(planFile);
      if (!withinWorkingDirectory(resolved)) return failure("VIEW_PLAN_PATH_INVALID", "planFile 必须位于工作区内");
      const raw = readJson(resolved);
      const checked = validatePlan(raw);
      if (checked.fatal?.length) return failure("VIEW_PLAN_INVALID", "独立视图计划无效", { issues: checked.fatal });
      if (checked.coverage?.length) return failure("VIEW_COVERAGE_INVALID", "跨视图事实或接口归属不完整", { issues: checked.coverage });
      plan = checked.plan;
      manifest = createManifest(plan, planHash(raw));
    }

    const capabilities = await client.getCapabilities();
    if (capabilities?.status === "error") return capabilities;
    const support = capabilities?.independent_views;
    if (!support?.versions?.includes(1) || support.execution !== "client_orchestrated_single_diagrams" || support.manifest_version !== 1 || support.native_layers !== false) {
      return failure("INDEPENDENT_VIEWS_UNSUPPORTED", "后端未声明独立单图编排 v1；不得把多视图请求退化为单画布 layers 或三个容器");
    }
    if (budget?.remote && support.budget?.execution !== "server_token_budget_ledger") {
      return failure("GROUP_BUDGET_UNSUPPORTED", "后端未声明公共 TokenBudgetLedger 接口；不执行无上限视图组");
    }
    fs.mkdirSync(outputDir, { recursive: true });
    if (resume && budget?.snapshot && manifest.budget?.snapshot) {
      updateBudgetSnapshot(manifest, await budget.snapshot());
    }
    persist(outputDir, manifest);

    for (let index = 0; index < plan.views.length; index += 1) {
      const planned = plan.views[index];
      const view = manifest.views[index];
      if (view.view_id !== planned.view_id) return failure("VIEW_GROUP_MANIFEST_INVALID", "manifest 视图顺序与计划不一致");
      const savedAttempt = view.attempts.at(-1);
      if (resume && budget && savedAttempt?.budget_attempt_id && savedAttempt.budget_attempt_id === view.budget_attempt?.attempt_id &&
          (view.budget_attempt.state === "reserved" || view.budget_attempt.error)) {
        await finishReservation(budget, manifest, view, savedAttempt.submitted, settleUsage(savedAttempt), Boolean(savedAttempt.receipt));
        persist(outputDir, manifest);
      }
      if (view.status === "accepted") {
        restoreCoverage(plan, planned, view);
        continue;
      }
      if (view.status === "running") {
        view.status = "pending";
        view.error = { code: "VIEW_RECEIPT_UNCONFIRMED", message: "原请求结果未知；未自动发起新收费请求" };
        persist(outputDir, manifest);
        continue;
      }
      let recovery = null;
      if (resume) {
        const latest = view.attempts?.[view.attempts.length - 1];
        if (view.error?.code === "VIEW_RECEIPT_UNCONFIRMED" && !latest?.saved_request_record) {
          view.status = "pending";
          persist(outputDir, manifest);
          continue;
        }
        if (latest?.submitted && !latest.receipt && !latest.outcome_confirmed && ["failed", "pending"].includes(view.status) && latest.saved_request_record) {
          const resolved = await resolveUnknownResult(client, view);
          if (resolved.result) {
            const result = resolved.result;
            const viewDir = path.join(outputDir, "views", view.view_id);
            const attempt = await consumeResult(client, plan, planned, view, result, viewDir, true);
            if (budget && view.budget_attempt) {
              attempt.budget_attempt_id = view.budget_attempt.attempt_id;
              await finishReservation(budget, manifest, view, attempt.submitted, settleUsage(attempt), true);
            }
            updateGroupStatus(manifest);
            persist(outputDir, manifest);
            continue;
          }
          if (resolved.knownFailure) latest.receipt = sanitizeReceipt(resolved.receipt);
          if (resolved.unconfirmed) {
            view.status = "pending";
            view.error = { code: "VIEW_RECEIPT_UNCONFIRMED", message: "原请求回执仍不可确认；未自动重发收费请求" };
            persist(outputDir, manifest);
            continue;
          }
        }
        if (view.session_id && view.artifacts?.saved_cw_file && ["draft", "failed"].includes(view.status)) {
          try {
            recoverySource(view);
            recovery = view;
          } catch (error) {
            view.status = "pending";
            view.error = { code: "VIEW_RECOVERY_SOURCE_INVALID", message: String(error.message || error) };
            persist(outputDir, manifest);
            continue;
          }
        }
      }
      let reservation = null;
      if (budget) {
        const sequence = Math.max(view.budget_attempt?.sequence || 0, view.attempts.length) + 1;
        const attemptId = `${manifest.group_id}:${view.view_id}:${sequence}`;
        reservation = await budget.reserve({ attempt_id: attemptId, token_limit: planned.token_limit || plan.attempt_token_limit, plan, view: planned, manifest, usage: summarizeUsage(manifest.views) });
        if (!reservation || reservation.allowed === false) {
          if (reservation?.snapshot) manifest.budget = { status: "server_ledger_active", snapshot: reservation.snapshot };
          view.status = "pending";
          view.error = { code: reservation?.code || "BUDGET_EXCEEDED", message: reservation?.message || "组预算预留拒绝，未发起子请求" };
          persist(outputDir, manifest);
          continue;
        }
        if (!Number.isInteger(reservation.token_limit) || reservation.token_limit <= 0) return failure("BUDGET_RESERVATION_INVALID", "R6 reserve 必须返回每次调用的正整数 token_limit");
        view.budget_attempt = { attempt_id: attemptId, sequence, token_limit: reservation.token_limit, state: "reserved" };
        manifest.budget = { status: reservation.snapshot ? "server_ledger_active" : "adapter_verified", snapshot: reservation.snapshot || null, message: "R6 适配器已执行逐次预留；质量与覆盖独立验收" };
        persist(outputDir, manifest);
      }
      if (admission?.beforeView) {
        const decision = await admission.beforeView({ plan, view: planned, manifest, usage: summarizeUsage(manifest.views) });
        if (decision && decision.allowed === false) {
          if (reservation) {
            await finishReservation(budget, manifest, view, false, null);
          }
          view.status = "pending";
          view.error = { code: decision.code || "GROUP_ADMISSION_DENIED", message: decision.message || "组预算准入拒绝，未发起子请求" };
          persist(outputDir, manifest);
          continue;
        }
      }
      if (recovery && !planned.authoring) {
        const persisted = typeof client.getCoDesignBudget === "function" ? await client.getCoDesignBudget(recovery.continuation_session_id || recovery.session_id) : null;
        const remaining = persisted?.remaining_tokens;
        const unsafe = persisted?.status !== "ok" || persisted.usage_complete !== true ||
          !Number.isInteger(remaining) || persisted.revision !== recovery.revision ||
          (reservation && remaining > reservation.token_limit);
        if (unsafe) {
          if (reservation) {
            await finishReservation(budget, manifest, view, false, null);
          }
          view.status = "pending";
          view.error = { code: "CONTINUATION_BUDGET_UNSAFE", message: "旧工作流剩余额度无法核实、revision 不符或大于本次预留；未发送 continuation" };
          persist(outputDir, manifest);
          continue;
        }
      }
      view.status = "running";
      view.error = null;
      persist(outputDir, manifest);
      let attempt;
      try {
        const { result, viewDir } = await generateOne(client, plan, planned, outputDir, recovery, reservation?.token_limit ?? null, edits);
        attempt = await consumeResult(client, plan, planned, view, result, viewDir);
      } catch (error) {
        view.status = "failed";
        view.error = { code: "VIEW_ORCHESTRATION_FAILED", message: String(error.message || error) };
        attempt = { status: "failed", submitted: true, usage: unknownUsage(), receipt: null, error: view.error, completed_at: new Date().toISOString() };
        view.attempts.push(attempt);
      }
      if (reservation) {
        attempt.budget_attempt_id = reservation.attempt_id;
        persist(outputDir, manifest);
        await finishReservation(budget, manifest, view, attempt.submitted, settleUsage(attempt));
      }
      updateGroupStatus(manifest);
      persist(outputDir, manifest);
    }
    if (budget?.snapshot && manifest.budget.snapshot) {
      try { updateBudgetSnapshot(manifest, await budget.snapshot()); }
      catch (error) { manifest.budget = { ...manifest.budget, status: "state_unconfirmed", error: String(error.message || error) }; }
    }
    updateGroupStatus(manifest);
    return publicResult(outputDir, manifest);
  } catch (error) {
    return failure(error.message?.startsWith("VIEW_") ? error.message.split(":", 1)[0] : "VIEW_GROUP_RECOVERY_FAILED", String(error.message || error));
  }
}

module.exports = {
  PLAN_VERSION,
  MANIFEST_VERSION,
  MANIFEST_FILENAME,
  planHash,
  validatePlan,
  requestFor,
  buildIndexHtml,
  usageFromResult,
  summarizeUsage,
  orchestrateViewGroup,
};
