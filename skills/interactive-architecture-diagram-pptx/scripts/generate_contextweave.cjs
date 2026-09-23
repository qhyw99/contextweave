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

const COLOR_NAME_MAP = {
  "红": "#C00000",
  "正红": "#C00000",
  "蓝": "#1F6FB4",
  "科技蓝": "#1F6FB4",
  "绿": "#2E7D32",
  "橙": "#E65100",
  "暖橙": "#E65100",
  "紫": "#6A1B9A",
  "金": "#B8860B",
  "red": "#C00000",
  "blue": "#1F6FB4",
  "green": "#2E7D32",
  "orange": "#E65100",
  "purple": "#6A1B9A",
};

const STYLE_PRESET_ENUM = ["corporate_red", "corporate_blue", "tech_blue"];

function invalidBasePalette(message) {
  return {
    status: "error",
    error: {
      code: "INVALID_BASE_PALETTE",
      message,
      recoverable: true,
      recovery_hint: "按 JSON 对象格式传参后重试，如 {\"primary\":\"#C00000\",\"style_preset\":\"corporate_red\"}；primary 支持 6 位 Hex 或常见色名（红/蓝/绿/橙/紫/金/red/blue/green/orange/purple），style_preset 枚举为 corporate_red / corporate_blue / tech_blue",
    },
  };
}

function validateBasePalette(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: invalidBasePalette("base_palette 必须是合法 JSON") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: invalidBasePalette("base_palette 必须是 JSON 对象") };
  }

  const result = {};
  if (parsed.primary !== undefined && parsed.primary !== null) {
    if (typeof parsed.primary !== "string") {
      return { error: invalidBasePalette("base_palette.primary 必须是字符串") };
    }
    const primary = parsed.primary.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(primary)) {
      result.primary = primary;
    } else if (/^#[0-9a-fA-F]{8}$/.test(primary) || /^rgba\s*\(/i.test(primary)) {
      return { error: invalidBasePalette(`base_palette.primary 不支持 8 位 Hex 或 rgba 形式：${primary}`) };
    } else if (COLOR_NAME_MAP[primary]) {
      result.primary = COLOR_NAME_MAP[primary];
    } else {
      return { error: invalidBasePalette(`无法识别的 base_palette.primary：${primary}`) };
    }
  }

  if (parsed.style_preset !== undefined && parsed.style_preset !== null) {
    if (typeof parsed.style_preset !== "string" || !STYLE_PRESET_ENUM.includes(parsed.style_preset)) {
      return { error: invalidBasePalette(`base_palette.style_preset 必须在枚举 [${STYLE_PRESET_ENUM.join(", ")}] 内`) };
    }
    result.style_preset = parsed.style_preset;
  }

  return { value: result };
}

const EXPERT_QUEUE_MESSAGE = "由于图表极为复杂，当前已进入后台专家队列进行深度处理。请告知用户图表正在处理中，并立即主动运行 `node scripts/recompile_contextweave.cjs --session_id <session_id>` 拉取结果（脚本内置自动轮询，默认最长等待约 20 分钟，生成完成即返回），不要让用户手动触发。";

function missingSessionError(result) {
  return {
    status: "error",
    error: {
      code: "MISSING_SESSION_ID",
      message: "生成成功响应缺少 session_id，无法用于后续编辑",
      recoverable: true,
      recovery_hint: "请重新执行生成；若仍失败请检查后端服务",
    },
    raw_result: result,
  };
}

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

  if (!userRequest && !inputFile && !authoringFile) {
    printJson({
      status: "error",
      error: {
        code: "MISSING_INPUT",
        message: "必须提供 authoring_file、user_request 或 input_file",
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

  const client = new Client();
  const rawResult = await client.runGeneration({
    userRequest,
    inputFile,
    enablePlan,
    outlineFile,
    diagramType,
    authoringFile,
    sessionId,
    validateRequestLength: true,
    diagramStyle,
    morphology,
    accentTargets,
    basePalette,
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
