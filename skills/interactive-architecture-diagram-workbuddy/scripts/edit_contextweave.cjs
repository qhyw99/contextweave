#!/usr/bin/env node
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

function normalizeEditResult(result) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = args["--session_id"] || args["-s"];
  const inputFile = args["--input_file"] || args["-i"];
  const mode = args["--mode"] || args["-m"] || "3";
  const outputName = args["--output_name"] || args["-n"];
  const outputDir = args["--output_dir"] || args["-o"];

  if (!sessionId || !inputFile) {
    printJson({
      status: "error",
      error: {
        code: "MISSING_REQUIRED_ARGS",
        message: "必须提供 session_id 和 input_file（为保证上下文完整，编辑操作强制要求使用文件）",
        recoverable: true,
        recovery_hint: "补充 input_file 参数后重试",
      },
    });
    process.exit(1);
  }

  const client = new CWClient();
  // Monkey patch to inject stage_execution: "stage2_only" for testing
  const originalRequest = client.request.bind(client);
  client.request = async (endpoint, payload) => {
    if (endpoint === "/run") {
      payload.stage_execution = "stage2_only";
    }
    return originalRequest(endpoint, payload);
  };

  const result = normalizeEditResult(
    await client.runGeneration({
      inputFile,
      sessionId,
      mode,
    })
  );

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

main();
