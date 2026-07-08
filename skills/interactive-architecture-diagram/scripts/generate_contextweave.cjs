#!/usr/bin/env node
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

function normalizeGenerationResult(result) {
  if (result.status === "ok" && Array.isArray(result.choices)) {
    result.choices = result.choices.map(choice => {
      let normalized = normalizeAssetResult(choice);
      if (!normalized.svg_url) {
        normalized.message = "由于图表极为复杂，当前已进入后台专家队列进行深度处理。请告知用户图表正在处理中。";
        normalized.svg_url = "WAITING_FOR_EXPERT_PROCESSING";
      }
      return normalized;
    });
    if (!result.session_id) {
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
    return result;
  }

  result = normalizeAssetResult(result);
  if (result.status === "ok" && !result.session_id) {
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
  if (result.status === "ok" && !result.svg_url) {
    result.message = "由于图表极为复杂，当前已进入后台专家队列进行深度处理。请告知用户图表正在处理中，并引导用户在 30 分钟后使用 `node scripts/recompile_contextweave.cjs --session_id <session_id>` 脚本来获取最终图表。";
    result.svg_url = "WAITING_FOR_EXPERT_PROCESSING";
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userRequest = args["--user_request"] || args["-u"];
  const inputFile = args["--input_file"] || args["-i"];
  const sessionId = args["--session_id"] || args["-s"];
  const mode = args["--mode"] || args["-m"] || "3";
  const inputSequenceRaw = args["--input_sequence"];
  const diagramStyle = args["--diagram_style"] || args["-d"];
  const outputName = args["--output_name"] || args["-n"];
  const outputDir = args["--output_dir"] || args["-o"];
  const n = parseInt(args["--n"] || "1", 10);
  const topK = parseInt(args["--top_k"] || "1", 10);

  if (!userRequest && !inputFile) {
    printJson({
      status: "error",
      error: {
        code: "MISSING_INPUT",
        message: "必须至少提供 user_request 或 input_file",
        recoverable: true,
        recovery_hint: "补充生成请求文本或输入文件后重试",
      },
    });
    process.exit(1);
  }

  let inputSequence = null;
  if (inputSequenceRaw) {
    try {
      inputSequence = JSON.parse(inputSequenceRaw);
    } catch (error) {
      printJson({
        status: "error",
        error: {
          code: "INVALID_INPUT_SEQUENCE",
          message: "input_sequence 必须是合法 JSON",
          recoverable: true,
          recovery_hint: "按 JSON 数组格式传参后重试",
        },
      });
      process.exit(1);
    }
  }

  const client = new CWClient();
  const rawResult = await client.runGeneration({
    userRequest,
    inputFile,
    sessionId,
    mode,
    inputSequence,
    validateRequestLength: true,
    diagramStyle,
    n,
    topK,
  });
  
  const result = normalizeGenerationResult(rawResult);

  if (result.status === "ok" && Array.isArray(result.choices)) {
    const fs = require("fs");
    const path = require("path");
    
    if (result.session_id) {
      result.feedback_url = `https://pptx.chenxitech.site/feedback?session_id=${result.session_id}`;
    }

    for (let i = 0; i < result.choices.length; i++) {
      const choice = result.choices[i];
      const suffix = `_choice_${i + 1}`;
      
      if (choice.cw_code) {
        const baseName = outputName || result.session_id || "diagram";
        const filename = `${baseName}${suffix}.cw`;
        let targetDir = process.cwd();
        if (outputDir) {
          targetDir = path.resolve(outputDir);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
        }
        const filePath = path.join(targetDir, filename);
        
        let finalCode = choice.cw_code;
        // Optionally inject choice-specific session id if backend provides it, otherwise use root session_id
        const choiceSessionId = choice.session_id || result.session_id;
        if (choiceSessionId) {
          finalCode = `# session_id: ${choiceSessionId}\n` + finalCode;
        }
        fs.writeFileSync(filePath, finalCode, "utf8");
        
        delete choice.cw_code;
        choice.saved_cw_file = filePath;
      }

      // Download assets for this choice
      const tempObj = {
        status: "ok",
        session_id: choice.session_id || result.session_id,
        output_name: outputName ? `${outputName}${suffix}` : `${result.session_id || "diagram"}${suffix}`,
        output_dir: outputDir,
        raw_svg_url: choice.raw_svg_url,
        svg_url: choice.svg_url,
        pptx_url: choice.pptx_url,
      };
      await downloadAssetsLocally(tempObj);
      
      if (tempObj.saved_svg_file) choice.saved_svg_file = tempObj.saved_svg_file;
      if (tempObj.saved_pptx_file) choice.saved_pptx_file = tempObj.saved_pptx_file;
      if (tempObj.message) choice.message = tempObj.message;
    }
  } else if (result.status === "ok" && result.cw_code) {
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

  // Inject feedback URL dynamically if generation is successful (for single result)
  if (result.status === "ok" && result.session_id && !Array.isArray(result.choices)) {
    result.feedback_url = `https://pptx.chenxitech.site/feedback?session_id=${result.session_id}`;
  }

  if (!Array.isArray(result.choices)) {
    result.output_name = outputName;
    result.output_dir = outputDir;
    await downloadAssetsLocally(result);
  }

  printJson(result);
  if (result.status === "error") {
    process.exit(1);
  }
}

main();
