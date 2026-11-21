const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

class CWClient {
  constructor() {
    const baseUrl = "https://pptx.chenxitech.site";
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    this.timeoutMs = 3000000;
    this.apiKey = this.loadApiKey();
    this.editorProtocol = process.env.CONTEXTWEAVE_EDITOR_PROTOCOL || "trae";
  }

  loadApiKey() {
    const key = process.env.CONTEXTWEAVE_MCP_API_KEY;
    return key || "94a05d02-9ade-4d9d-9f39-88734d9e34b4";
  }

  validateBaseUrl() {
    if (!this.baseUrl) {
      return this.error(
        "MISSING_API_URL",
        "Missing API URL",
        true,
        "内部错误: 基础URL缺失"
      );
    }
    let parsed;
    try {
      parsed = new URL(this.baseUrl);
    } catch (error) {
      return this.error("INVALID_API_URL", "Invalid API URL format", true, "内部错误: 基础URL格式错误");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return this.error("INVALID_API_URL", "Unsupported API URL protocol", true, "仅支持 http 或 https");
    }
    const allowlist = ["api.contextweave.site", "contextweave.site", "pptx.chenxitech.site", "bpjwmsdb.com"];
    const host = parsed.hostname.toLowerCase();
    const trusted = allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    if (!trusted) {
      return this.error(
        "UNTRUSTED_API_HOST",
        "Untrusted API host",
        true,
        "请使用官方域名"
      );
    }
    return null;
  }

  headers() {
    const headers = { "X-Request-ID": this.createRequestId(), "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  createRequestId() {
    return crypto.randomBytes(16).toString("hex");
  }

  validateSafePath(targetPath) {
    if (!targetPath || typeof targetPath !== "string") {
      return this.error("INVALID_PATH", "Path is empty or invalid");
    }
    if (!path.isAbsolute(targetPath)) {
      return this.error("INPUT_FILE_NOT_ABSOLUTE", `Path must be absolute: ${targetPath}`);
    }
    const normalized = path.resolve(targetPath);
    const cwd = process.cwd();
    const relative = path.relative(cwd, normalized);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return this.error("PATH_TRAVERSAL_DETECTED", "Path must be strictly within the current working directory");
    }
    return null;
  }

  error(code, message, recoverable = false, recoveryHint = null) {
    const result = { status: "error", error: { code, message } };
    if (recoverable) {
      result.error.recoverable = true;
    }
    if (recoveryHint) {
      result.error.recovery_hint = recoveryHint;
    }
    return result;
  }

  async request(endpoint, payload) {
    const baseUrlError = this.validateBaseUrl();
    if (baseUrlError) {
      return baseUrlError;
    }
    const body = { ...payload };
    if (this.editorProtocol) {
      body.editor_protocol = this.editorProtocol;
    }

    try {
      const response = await this.postJson(`${this.baseUrl}${endpoint}`, body);
      if (response.statusCode === 402) {
        return this.error("PAYMENT_REQUIRED", "Insufficient credits", true, "额度不足。可引导用户免费领取：询问用户邮箱 → 运行 request_quota_code.cjs --email <邮箱> 发送验证码 → 询问验证码 → 运行 redeem_quota_code.cjs --email <邮箱> --code <验证码> → 用户查收邮件按指引配置 CONTEXTWEAVE_MCP_API_KEY 后重试。");
      }
      if (response.statusCode === 403) {
        return this.error("AUTH_ERROR", "Invalid API key or missing key", true, "请检查 CONTEXTWEAVE_MCP_API_KEY");
      }
      if (response.statusCode === 429) {
        let errorMsg = "Too Many Requests";
        try {
          const parsed = JSON.parse(response.body);
          errorMsg = parsed.detail || parsed.error || errorMsg;
        } catch (e) {}
        return this.error("RATE_LIMIT_EXCEEDED", errorMsg, true, "免费体验额度已用完或请求过于频繁。可稍后重试，或引导用户免费领取专属 API Key：询问用户邮箱 → 运行 request_quota_code.cjs --email <邮箱> 发送验证码 → 询问验证码 → 运行 redeem_quota_code.cjs --email <邮箱> --code <验证码> → 用户查收邮件按指引配置 CONTEXTWEAVE_MCP_API_KEY 后重试。");
      }
      if (response.statusCode === 400 || response.statusCode === 409) {
        let errorMsg = `${response.statusCode} ${response.statusMessage || "Request failed"}`;
        try {
          const parsed = JSON.parse(response.body);
          const detail = parsed.detail || parsed.error;
          if (detail) {
            errorMsg += `: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`;
          }
        } catch (e) {}
        return this.error(
          response.statusCode === 400 ? "BAD_REQUEST" : "CONFLICT",
          errorMsg,
          true,
          "请根据提示修正输入后重试"
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let errorMsg = `${response.statusCode} ${response.statusMessage || "Request failed"}`;
        try {
          const parsed = JSON.parse(response.body);
          const detail = parsed.detail || parsed.error;
          if (detail) {
            errorMsg += `: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }
      return JSON.parse(response.body || "{}");
    } catch (error) {
      return this.error("API_ERROR", String(error.message || error), true, "请检查网络或后端服务状态后重试");
    }
  }

  postJson(urlString, body) {
    const parsed = new URL(urlString);
    const payload = JSON.stringify(body);
    const options = {
      method: "POST",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        ...this.headers(),
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const transport = parsed.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            statusMessage: res.statusMessage || "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  async runGeneration({ userRequest, inputFile = null, sessionId = null, inputSequence = null, validateRequestLength = false, enableIllustrations = null, canvasOptions = {}, enablePlan = false }) {
    const canvas = normalizeCanvasOptions(canvasOptions);
    if (canvas.error) return canvas.error;
    const payload = {
      ...canvas.value,
      input_sequence: inputSequence,
      export_svg: true,
      export_pptx: false,
      session_id: sessionId,
      test_file: null,
    };

    if (enableIllustrations !== null) {
      if (typeof enableIllustrations !== "boolean") return this.error("INVALID_ILLUSTRATIONS", "enable_illustrations 必须为 true 或 false");
      payload.enable_illustrations = enableIllustrations;
    }
    // Add use_unified_bot flag if explicitly set via environment variable
    if (process.env.CONTEXTWEAVE_USE_UNIFIED_BOT === "true") {
      payload.use_unified_bot = true;
    }
    // Add enable_plan flag if explicitly set via environment variable or passed as argument
    if (enablePlan || process.env.CONTEXTWEAVE_ENABLE_PLAN === "true") {
      payload.enable_plan = true;
    }
    if (inputFile) {
      const pathError = this.validateSafePath(inputFile);
      if (pathError) {
        return pathError;
      }
      if (!fs.existsSync(inputFile)) {
        return this.error("FILE_NOT_FOUND", `File not found: ${inputFile}`);
      }
      try {
        const content = fs.readFileSync(inputFile, "utf8");
        let reqText = content.trim();
        let cwText = "";
        if (content.includes("# CW")) {
          const parts = content.split("# CW");
          const reqPart = parts[0];
          const cwPart = parts.slice(1).join("# CW");
          const afterFence = cwPart.split("```cw")[1];
          if (afterFence && afterFence.includes("```")) {
            cwText = afterFence.split("```")[0].trim();
          } else {
            cwText = cwPart.trim();
          }
          if (reqPart.includes("# Request")) {
            reqText = reqPart.split("# Request")[1].trim();
          } else {
            reqText = reqPart.trim();
          }
        }
        payload.user_request = reqText;
        payload.initial_cw_code = cwText;
      } catch (error) {
        return this.error("READ_ERROR", `Failed to read input file: ${String(error.message || error)}`);
      }
    } else {
      payload.user_request = userRequest;
    }

    if (validateRequestLength) {
      const minLength = parseInt(process.env.CONTEXTWEAVE_MIN_REQUEST_LENGTH || "50", 10);
      const maxLength = parseInt(process.env.CONTEXTWEAVE_MAX_REQUEST_LENGTH || "5000", 10);
      const reqLength = payload.user_request ? payload.user_request.length : 0;
      if (reqLength < minLength || reqLength > maxLength) {
        return this.error(
          "INVALID_REQUEST_LENGTH",
          `生成请求的长度必须在 ${minLength} 到 ${maxLength} 字符之间，当前长度: ${reqLength}。`,
          true,
          `请调整请求文本的详细程度，确保字数在 ${minLength}-${maxLength} 之间。`
        );
      }
    }

    return this.request("/run", payload);
  }

  async exportSessionAsset(sessionId, formatName) {
    return this.request("/export-session", { session_id: sessionId, format: formatName });
  }

  async recompileSession(sessionId) {
    return this.request("/session/recompile", { session_id: sessionId });
  }

  async importCode(target = "ContextWeave") {
    const pathError = this.validateSafePath(target);
    if (pathError) {
      return pathError;
    }
    const targetPath = path.resolve(target);
    if (!fs.existsSync(targetPath)) {
      return this.error("PATH_NOT_FOUND", `Path not found: ${targetPath}`);
    }
    
    let cwFile = targetPath;
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      cwFile = path.join(targetPath, "diagram.cw");
      if (!fs.existsSync(cwFile)) {
        return this.error("FILE_NOT_FOUND", `diagram.cw not found in directory: ${targetPath}`);
      }
    }
    
    let content;
    try {
      content = fs.readFileSync(cwFile, "utf8");
    } catch (error) {
      return this.error("READ_ERROR", String(error.message || error));
    }
    return this.request("/session/import", { cw_code: content, source_name: cwFile });
  }

  async exportCode(sessionId, target = "ContextWeave") {
    const pathError = this.validateSafePath(target);
    if (pathError) {
      return pathError;
    }
    const result = await this.request("/session/export", { session_id: sessionId });
    if (result.status === "error") {
      return result;
    }
    const cwCode = result.cw_code;
    const targetPath = path.resolve(target);
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (error) {
      return this.error("CREATE_DIR_ERROR", String(error.message || error));
    }
    const targetFile = path.join(targetPath, "diagram.cw");
    try {
      fs.writeFileSync(targetFile, cwCode || "", "utf8");
    } catch (error) {
      return this.error("WRITE_ERROR", String(error.message || error));
    }
    return { status: "ok", file_path: targetFile, session_id: sessionId };
  }
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function normalizeAssetResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  // We don't need to do anything complex anymore, because the backend (mcp_server) 
  // now sets the "svg_url" to the primary HTML wrapper link if HTML is enabled.
  // It also returns "raw_svg_url" if we ever need the actual SVG link.

  // Clean up excessive fields to keep the output clean
  delete result.html_url;
  delete result.primary_asset_url;
  delete result.preferred_asset_url;
  delete result.url;

  return result;
}

const CANVAS_PRESETS = {
  "16:9": [1600, 900], "4:3": [1200, 900], "1:1": [1000, 1000],
  "2:3": [700, 1050], "3:4": [900, 1200], "3:2": [1500, 1000],
  "9:16": [900, 1600], a4_portrait: [840, 1188], a4_landscape: [1188, 840],
};
const VISUAL_STYLES = ["auto", "default", "scientific_editorial", "scientific_omics"];
const CANVAS_FIELDS = ["canvas_aspect", "target_width", "target_height", "min_font_size", "visual_style", "style_ink"];

function invalidOption(code, message) {
  return { error: { status: "error", error: { code, message } } };
}

function normalizeCanvasOptions(options) {
  const value = {};
  if (options.canvas_aspect !== undefined) {
    const aspect = typeof options.canvas_aspect === "string"
      ? options.canvas_aspect.trim().toLowerCase().replace(/\s*[:：]\s*/g, ":") : "";
    if (!Object.hasOwn(CANVAS_PRESETS, aspect)) {
      return invalidOption("INVALID_CANVAS", "--canvas_aspect 支持 " + Object.keys(CANVAS_PRESETS).join(", "));
    }
    value.canvas_aspect = aspect;
  }
  if ((options.target_width === undefined) !== (options.target_height === undefined)) {
    return invalidOption("INVALID_CANVAS", "--target_width 与 --target_height 必须成对提供");
  }
  for (const [field, min, max] of [["target_width", 320, 10000], ["target_height", 240, 10000], ["min_font_size", 1, 100]]) {
    if (options[field] === undefined) continue;
    const raw = options[field];
    const integer = field !== "min_font_size";
    const syntax = integer ? /^\+?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
    const literal = typeof raw === "number" || typeof raw === "string" ? String(raw).trim() : "";
    const number = Number(literal);
    if (!syntax.test(literal) || !Number.isFinite(number) || number < min || number > max) {
      return invalidOption("INVALID_CANVAS", "--" + field + " 必须是 " + min + ".." + max + " 范围内的" + (integer ? "整数" : "数字"));
    }
    value[field] = number;
  }
  if (value.canvas_aspect && value.target_width !== undefined) {
    const [width, height] = CANVAS_PRESETS[value.canvas_aspect];
    const expected = width / height;
    const actual = value.target_width / value.target_height;
    // Match canvas.py's math.isclose(rel_tol=.01) on both sides of the preset.
    if (Math.abs(actual - expected) > 0.01 * Math.max(actual, expected)) {
      return invalidOption("INVALID_CANVAS", "目标宽高比与 --canvas_aspect 不一致");
    }
  }
  if (options.visual_style !== undefined) {
    if (!VISUAL_STYLES.includes(options.visual_style)) {
      return invalidOption("INVALID_VISUAL_STYLE", "--visual_style 支持 " + VISUAL_STYLES.join(", "));
    }
    value.visual_style = options.visual_style;
  }
  if (options.style_ink !== undefined) {
    if (typeof options.style_ink !== "string" || !/^#[0-9a-f]{6}$/i.test(options.style_ink)) {
      return invalidOption("INVALID_STYLE_INK", "--style_ink 必须为 #RRGGBB");
    }
    value.style_ink = options.style_ink;
  }
  return { value };
}

function parseDrawingOptions(argv) {
  const illustrations = parseIllustrations(argv);
  if (illustrations.error) return illustrations;
  const options = {};
  for (const field of CANVAS_FIELDS) {
    const index = argv.lastIndexOf("--" + field);
    if (index !== -1) options[field] = argv[index + 1] ?? "";
  }
  const canvas = normalizeCanvasOptions(options);
  if (canvas.error) return canvas;
  return { value: { enableIllustrations: illustrations.value, canvasOptions: canvas.value } };
}

function parseIllustrations(argv) {
  const index = argv.lastIndexOf("--enable_illustrations");
  if (index === -1) return { value: null };
  const option = argv[index + 1];
  if (option === "true" || option === "false") return { value: option === "true" };
  return { error: { status: "error", error: { code: "INVALID_ILLUSTRATIONS", message: "--enable_illustrations 必须为 true 或 false" } } };
}

module.exports = {
  parseIllustrations,
  parseDrawingOptions,
  CWClient,
  normalizeAssetResult,
  printJson,
};
