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
    const next = argv[i + 1];
    const value = next && !next.startsWith("-") ? next : "true";
    args[token] = value;
    if (value !== "true") {
      i += 1;
    }
  }
  return args;
}

function normalizeEditResult(result, structured = false) {
  if (structured && result.status === "error") return result;
  result = normalizeAssetResult(result);
  if (result.status === "error") {
    const message = String((result.error || {}).message || "");
    if (message.toLowerCase().includes("session")) {
      return {
        status: "error",
        error: {
          code: "SESSION_INVALID_OR_EXPIRED",
          message: message || "session_id 缺失、无效或已过期",
          recoverable: true,
          recovery_hint: "请先重新执行生成脚本获取新的 session_id，再重试编辑",
        },
      };
    }
  }
  if (result.status === "ok" && !result.svg_url) {
    result.message = "由于图表极为复杂，当前已进入后台专家队列进行深度处理。请告知用户图表正在处理中，并引导用户在 30 分钟后使用 `node scripts/recompile_contextweave.cjs --session_id <session_id>` 脚本来获取最终图表。";
    result.svg_url = "WAITING_FOR_EXPERT_PROCESSING";
  }
  return result;
}

async function main(argv = process.argv.slice(2), Client = CWClient) {
  const args = parseArgs(argv);
  const authoringError = validateAuthoringArgs(args);
  if (authoringError) { printJson(authoringError); process.exit(1); }
  const sessionId = args["--session_id"] || args["-s"];
  const inputFile = args["--input_file"] || args["-i"];
  const authoringFile = args["--authoring_file"];
  const outputName = args["--output_name"] || args["-n"];
  const outputDir = args["--output_dir"] || args["-o"];

  if (!sessionId || (!inputFile && !authoringFile)) {
    printJson({
      status: "error",
      error: {
        code: "MISSING_REQUIRED_ARGS",
        message: "必须提供 session_id，以及 authoring_file 或 input_file",
        recoverable: true,
        recovery_hint: "补充 input_file 参数后重试",
      },
    });
    process.exit(1);
  }

  const client = new Client();
  // Legacy CW edits retain stage2 behavior; structured edits compile directly.
  const originalRequest = client.request.bind(client);
  client.request = async (endpoint, payload, options) => {
    if (!payload.authoring && (endpoint === "/run" || endpoint.startsWith("/run?"))) {
      payload.stage_execution = "stage2_only";
    }
    return originalRequest(endpoint, payload, options);
  };

  const rawResult = await client.runGeneration({ inputFile, authoringFile, sessionId });
  const result = normalizeEditResult(authoringFile ? validateAuthoringResult(rawResult, "svg") : rawResult, Boolean(authoringFile));
  await saveAuthoringArtifacts(client, result, { outputName, outputDir, saveSource: true });

  if (result.status === "ok" && result.cw_code) {
    const fs = require("fs");
    const path = require("path");

    const filename = outputName ? `${outputName}.cw` : (result.session_id ? `${result.session_id}.cw` : "diagram.cw");
    let targetDir = process.cwd();
    if (outputDir) {
      targetDir = path.resolve(outputDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    }
    const filePath = path.join(targetDir, filename);

    let finalCode = result.cw_code;
    if (result.session_id) {
      finalCode = `# session_id: ${result.session_id}\n` + finalCode;
    }
    fs.writeFileSync(filePath, finalCode, "utf8");

    // Remove cw_code from the output to prevent polluting LLM context window
    delete result.cw_code;
    result.saved_cw_file = filePath;
  }

  // Inject feedback URL dynamically if generation is successful
  if (result.status === "ok" && result.session_id) {
    result.feedback_url = `https://pptx.chenxitech.site/feedback?session_id=${result.session_id}`;
  }

  result.output_name = outputName;
  result.output_dir = outputDir;
  await downloadAssetsLocally(result);

  printJson(result);
  if (result.status === "error") {
    process.exit(1);
  }
}

module.exports = { main };
if (require.main === module) main();
