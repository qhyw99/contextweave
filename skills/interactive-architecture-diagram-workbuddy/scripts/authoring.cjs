const fs = require("fs");
const path = require("path");

const MAX_AUTHORING_BYTES = 512 * 1024;

function failure(code, message) {
  return { status: "error", error: { code, message, recoverable: true } };
}

function validateAuthoringArgs(args) {
  if (!args["--authoring_file"]) return null;
  const conflicts = ["--user_request", "-u", "--input_file", "-i", "--outline_file", "--input_sequence", "--diagram_style", "-d", "--morphology", "-m", "--diagram_type", "--accent_targets"];
  const present = conflicts.filter(key => Object.hasOwn(args, key));
  if (args["--enable_plan"] === "true") present.push("--enable_plan");
  for (const key of ["--n", "--top_k"]) if (args[key] !== undefined && Number(args[key]) !== 1) present.push(key);
  return present.length ? failure("AUTHORING_OPTION_CONFLICT", `authoring_file 不能与 ${present.join("、")} 同时使用`) : null;
}

function readAuthoringFile(filename) {
  if (!path.isAbsolute(filename)) return failure("AUTHORING_FILE_NOT_ABSOLUTE", "authoring_file 必须使用绝对路径");
  try {
    const resolved = fs.realpathSync(filename);
    const relative = path.relative(fs.realpathSync(process.cwd()), resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return failure("AUTHORING_PATH_OUTSIDE_WORKSPACE", "authoring_file 必须位于当前工作区内");
    }
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) return failure("AUTHORING_FILE_NOT_REGULAR", "authoring_file 必须是普通文件");
    if (stats.size > MAX_AUTHORING_BYTES) return failure("AUTHORING_FILE_TOO_LARGE", `authoring_file 不能超过 ${MAX_AUTHORING_BYTES} bytes`);
    const extension = path.extname(filename).toLowerCase();
    if (![".json", ".html", ".htm"].includes(extension)) return failure("INVALID_AUTHORING_FORMAT", "authoring_file 仅支持 .json、.html 或 .htm");
    const format = extension === ".json" ? "json" : "html";
    const text = fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
    const source = format === "json" ? JSON.parse(text) : text;
    if (!source || (format === "json" && (typeof source !== "object" || Array.isArray(source)))) {
      return failure("INVALID_AUTHORING_SOURCE", "JSON 须为结构对象；HTML 不能为空");
    }
    return { version: 1, format, source };
  } catch (error) {
    return failure(error instanceof SyntaxError ? "INVALID_AUTHORING_JSON" : "AUTHORING_FILE_READ_ERROR", String(error.message || error));
  }
}

async function prepareAuthoring(client, options, payload) {
  const { authoringFile, userRequest, inputFile, outlineFile, inputSequence, enablePlan, diagramStyle, morphology, diagramType, accentTargets, n, topK } = options;
  if (userRequest || inputFile || outlineFile || inputSequence || enablePlan || diagramStyle || morphology || diagramType || accentTargets || n !== 1 || topK !== 1) {
    return failure("AUTHORING_OPTION_CONFLICT", "authoring_file 不与自然语言请求、CW 输入、outline、input_sequence、enable_plan、diagram_style、morphology、diagram_type、accent_targets 或多候选组合；结构和布局由 authoring 内容决定");
  }
  const authoring = readAuthoringFile(authoringFile);
  if (authoring.status === "error") return authoring;
  const capabilities = await client.getCapabilities();
  if (capabilities?.status === "error") return capabilities;
  const supported = capabilities?.authoring;
  if (!supported?.versions?.includes(1) || !supported?.formats?.includes(authoring.format)
      || !["swimlane", "cards", "matrix"].every(kind => supported?.kinds?.includes(kind))) {
    return failure("AUTHORING_UNSUPPORTED", "后端未声明兼容的结构化绘图 v1 能力；升级后端后重试，不自动切换模型生成");
  }
  payload.authoring = authoring;
  payload.include_source = false;
  delete payload.input_sequence;
  delete payload.test_file;
  return null;
}

// Authoring failures are final validation/render errors, never expert-queue work.
function validateAuthoringResult(result, format = "svg") {
  if (result?.status !== "ok") return result;
  const hasAsset = format === "pptx" ? result.pptx_url : result.svg_url;
  if (!result.session_id || !hasAsset || hasAsset === "WAITING_FOR_EXPERT_PROCESSING" || !result.authoring_model) {
    return failure("AUTHORING_RESULT_INCOMPLETE", "结构化生成响应缺少 session_id、规范模型或渲染产物；未进入后台专家队列");
  }
  return result;
}

async function saveAuthoringArtifacts(client, result, { outputName, outputDir, saveSource = true } = {}) {
  if (result?.status !== "ok" || !result.authoring_model) return;
  const model = result.authoring_model;
  delete result.authoring_model;
  delete result.swimlane_spec;
  const targetDir = path.resolve(outputDir || process.cwd());
  const basename = outputName || result.session_id || "diagram";
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const filename = path.join(targetDir, `${basename}.authoring.json`);
    fs.writeFileSync(filename, `${JSON.stringify(model, null, 2)}\n`, "utf8");
    result.saved_authoring_file = filename;
    if (saveSource && !result.cw_code) {
      const exported = await client.request("/session/export", { session_id: result.session_id });
      if (exported.status === "ok" && typeof exported.cw_code === "string" && exported.cw_code) {
        result.cw_code = exported.cw_code;
      } else {
        (result.warnings ||= []).push("图已生成，CW 文件导出失败；可按 session_id 使用 export_contextweave_code.cjs 恢复");
      }
    }
  } catch (error) {
    (result.warnings ||= []).push(`规范模型保存失败：${String(error.message || error)}；可按 session_id 使用 export_contextweave_code.cjs 恢复`);
  }
}

function saveExportedModel(result, directory) {
  if (!result.authoring_model) return {};
  const filename = path.join(directory, "diagram.authoring.json");
  fs.writeFileSync(filename, `${JSON.stringify(result.authoring_model, null, 2)}\n`, "utf8");
  return { saved_authoring_file: filename };
}

module.exports = { MAX_AUTHORING_BYTES, validateAuthoringArgs, readAuthoringFile, prepareAuthoring, validateAuthoringResult, saveAuthoringArtifacts, saveExportedModel };
