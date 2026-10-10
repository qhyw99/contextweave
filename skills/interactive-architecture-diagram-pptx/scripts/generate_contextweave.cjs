#!/usr/bin/env node
const { validateAuthoringArgs, validateAuthoringResult, saveAuthoringArtifacts } = require("./authoring.cjs");
const { CWClient, normalizeAssetResult, downloadAssetsLocally, printJson } = require("./cw_client.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      continue;
    }
    const key = token;
    const next = argv[i + 1];
    const value = next && !next.startsWith("-") ? next : "true";
    args[key] = value;
    if (value !== "true") {
      i += 1;
    }
  }
  return args;
}

const { validateBasePalette, COLOR_NAME_MAP, STYLE_PRESET_ENUM } = require("./palette.cjs");

function normalizeGenerationResult(result) {
  if (result.status === "ok" && Array.isArray(result.choices)) {
    result.choices = result.choices.map(choice => {
      const normalized = normalizeAssetResult(choice);
      if (!normalized.pptx_url) {
        normalized.message = EXPERT_QUEUE_MESSAGE;
        normalized.pptx_url = "WAITING_FOR_EXPERT_PROCESSING";
      }
      return normalized;
    });
    if (!result.session_id) {
      return missingSessionError(result);
    }
    return result;
  }

  result = normalizeAssetResult(result);
  if (result.status === "ok" && !result.session_id) {
    return missingSessionError(result);
  }
  if (result.status === "ok" && !result.pptx_url) {
    result.message = EXPERT_QUEUE_MESSAGE;
    result.pptx_url = "WAITING_FOR_EXPERT_PROCESSING";
  }
  return result;
}

async function main(argv = process.argv.slice(2), Client = CWClient) {
  const args = parseArgs(argv);
  const authoringError = validateAuthoringArgs(args);
  if (authoringError) { printJson(authoringError); process.exit(1); }
  const userRequest = args["--user_request"] || args["-u"];
  const inputFile = args["--input_file"] || args["-i"];
  const enablePlan = args["--enable_plan"] === "true";
  const outlineFile = args["--outline_file"];
  const authoringFile = args["--authoring_file"];
  const diagramType = args["--diagram_type"];
  const sessionId = args["--session_id"] || args["-s"];
  const diagramStyle = args["--diagram_style"] || args["-d"];
  const morphology = args["--morphology"] || args["-m"];
  const accentTargetsRaw = args["--accent_targets"];
  const basePaletteRaw = args["--base_palette"];
  const outputName = args["--output_name"] || args["-n"];
  const outputDir = args["--output_dir"] || args["-o"];
  const n = parseInt(args["--n"] || "1", 10);
  const topK = parseInt(args["--top_k"] || "1", 10);

  if (!userRequest && !inputFile && !authoringFile && !outlineFile) {
    printJson({
      status: "error",
      error: {
        code: "MISSING_INPUT",
        message: "必须提供 authoring_file、outline_file、user_request 或 input_file",
        recoverable: true,
        recovery_hint: "补充生成请求文本或输入文件后重试",
      },
    });
    process.exit(1);
  }

  let accentTargets = null;
  if (accentTargetsRaw) {
    try {
      accentTargets = JSON.parse(accentTargetsRaw);
    } catch (error) {
      printJson({
        status: "error",
        error: {
          code: "INVALID_ACCENT_TARGETS",
          message: "accent_targets 必须是合法 JSON",
          recoverable: true,
          recovery_hint: "按 JSON 数组格式传参后重试，如 [{\"name\":\"节点名\",\"color\":\"暖橙\"}]",
        },
      });
      process.exit(1);
    }
  }

  let basePalette = null;
  if (basePaletteRaw) {
    const validation = validateBasePalette(basePaletteRaw);
    if (validation.error) {
      printJson(validation.error);
      process.exit(1);
    }
    basePalette = validation.value;
  }

  let coDesignRevision = null, coDesignEditPaths = null, coDesignUpstreamUsage = null;
  try {
    if (args["--co_design_revision"]) {
      coDesignRevision = Number(args["--co_design_revision"]);
      if (!Number.isSafeInteger(coDesignRevision) || coDesignRevision < 0) throw new Error("revision must be a nonnegative integer");
    }
    if (args["--co_design_edit_paths"]) coDesignEditPaths = JSON.parse(args["--co_design_edit_paths"]);
    if (args["--co_design_upstream_usage"]) coDesignUpstreamUsage = JSON.parse(args["--co_design_upstream_usage"]);
  } catch (error) {
    printJson({status:"error",error:{code:"INVALID_CO_DESIGN_OPTIONS",message:String(error.message)}});
    process.exit(1);
  }
  const client = new Client();
  const rawResult = await client.runGeneration({
    userRequest,
    inputFile,
    enablePlan,
    outlineFile,
    coDesignRevision,
    coDesignEditPaths,
    coDesignUpstreamUsage,
    diagramType,
    authoringFile,
    sessionId,
    validateRequestLength: true,
    diagramStyle,
    morphology,
    accentTargets,
    basePalette,
    useDefaultPalette: args["--use_default_palette"] === "true",
    n,
    topK,
  });

  const result = normalizeGenerationResult(authoringFile ? validateAuthoringResult(rawResult, "pptx") : rawResult);
  await saveAuthoringArtifacts(client, result, { outputName, outputDir, saveSource: false });

  // 简化版：不落盘 CW 代码，仅下载 PPTX 产物
  if (result.status === "ok" && Array.isArray(result.choices)) {
    for (let i = 0; i < result.choices.length; i++) {
      const choice = result.choices[i];
      const suffix = `_choice_${i + 1}`;
      const tempObj = {
        status: "ok",
        session_id: choice.session_id || result.session_id,
        output_name: outputName ? `${outputName}${suffix}` : `${result.session_id || "diagram"}${suffix}`,
        output_dir: outputDir,
        pptx_url: choice.pptx_url,
      };
      await downloadAssetsLocally(tempObj);
      if (tempObj.saved_pptx_file) choice.saved_pptx_file = tempObj.saved_pptx_file;
      if (tempObj.message) choice.message = tempObj.message;
    }
  } else if (result.status === "ok") {
    result.output_name = outputName;
    result.output_dir = outputDir;
    await downloadAssetsLocally(result);
  }

  printJson(result);
  if (result.status === "error") {
    process.exit(1);
  }
}

module.exports = { validateBasePalette, COLOR_NAME_MAP, STYLE_PRESET_ENUM, main };

if (require.main === module) {
  main();
}
