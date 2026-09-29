const OUTLINE_INTENT_VERSION = 1;
const MAX_OUTLINE_FILE_BYTES = 256 * 1024;
const SAFE_OUTLINE_ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, location) {
  if (!isPlainObject(value)) {
    throw new Error(`${location} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${location} contains unknown field(s): ${unknown.join(", ")}`);
  }
}

function requireKeys(value, required, location) {
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length > 0) {
    throw new Error(`${location} is missing required field(s): ${missing.join(", ")}`);
  }
}

function nonEmptyString(value, location) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${location} must be a non-empty string`);
  }
  return value.trim();
}

function parseGridSpan(value, location) {
  if (typeof value !== "string" || !/^\[(?:[1-9]\d*)(?:\s*,\s*[1-9]\d*)*\]$/.test(value.trim())) {
    throw new Error(`${location} must be a JSON-like list of positive integers`);
  }
  const values = value.trim().slice(1, -1).split(",").map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isSafeInteger(item))) {
    throw new Error(`${location} indices must be safe integers`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${location} must not contain duplicate indices`);
  }
  if (values.some((item, index) => index > 0 && item <= values[index - 1])) {
    throw new Error(`${location} indices must be in ascending order`);
  }
  return values;
}

function normalizedEvidence(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function validateOutlineIntent(outline, userRequest) {
  if (outline?.outline_intent_version === 2) return require("./co_design.cjs").validateCoDesign(outline);
  assertExactKeys(
    outline,
    ["outline_intent_version", "focus", "layout_policy", "edge_policy", "content", "global_relationships"],
    "outline_intent"
  );
  requireKeys(outline, ["outline_intent_version", "focus", "layout_policy", "edge_policy", "content"], "outline_intent");

  if (outline.outline_intent_version !== OUTLINE_INTENT_VERSION) {
    throw new Error(`unsupported outline_intent_version ${JSON.stringify(outline.outline_intent_version)}; supported version is ${OUTLINE_INTENT_VERSION}`);
  }
  nonEmptyString(outline.focus, "outline_intent.focus");

  assertExactKeys(outline.layout_policy, ["preset", "grid_mode"], "layout_policy");
  requireKeys(outline.layout_policy, ["preset", "grid_mode"], "layout_policy");
  if (!["layered", "three_lane", "stage_grid", "auto"].includes(outline.layout_policy.preset)) {
    throw new Error("layout_policy.preset must be layered, three_lane, stage_grid, or auto");
  }
  if (!["guided", "locked"].includes(outline.layout_policy.grid_mode)) {
    throw new Error("layout_policy.grid_mode must be guided or locked");
  }

  assertExactKeys(outline.edge_policy, ["mode", "focus", "preferred_range", "inferred_scope"], "edge_policy");
  requireKeys(outline.edge_policy, ["mode"], "edge_policy");
  if (!["sparse_semantic", "ordered_flow", "explicit_only"].includes(outline.edge_policy.mode)) {
    throw new Error("edge_policy.mode must be sparse_semantic, ordered_flow, or explicit_only");
  }
  if (outline.edge_policy.focus !== undefined) {
    if (!Array.isArray(outline.edge_policy.focus) || outline.edge_policy.focus.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error("edge_policy.focus must be an array of non-empty strings");
    }
  }
  if (outline.edge_policy.preferred_range !== undefined) {
    const range = outline.edge_policy.preferred_range;
    if (!Array.isArray(range) || range.length !== 2 || range.some((item) => !Number.isSafeInteger(item)) || range[0] < 0 || range[1] < range[0]) {
      throw new Error("edge_policy.preferred_range must be [low, high] with 0 <= low <= high");
    }
  }
  if (outline.edge_policy.inferred_scope !== undefined && outline.edge_policy.inferred_scope !== "local_only") {
    throw new Error("edge_policy.inferred_scope must be local_only");
  }

  if (!Array.isArray(outline.content) || outline.content.length === 0) {
    throw new Error("content must contain at least one top-level partition");
  }
  const itemNames = new Set();
  const parsedPartitions = outline.content.map((item, index) => {
    const location = `content[${index}]`;
    assertExactKeys(item, ["item_name", "label", "type", "grid-rows", "grid-columns", "content_generation_prompt", "style_marker"], location);
    requireKeys(item, ["item_name", "label", "type", "grid-rows", "grid-columns"], location);
    const itemName = nonEmptyString(item.item_name, `${location}.item_name`);
    if (!SAFE_OUTLINE_ID_RE.test(itemName)) {
      throw new Error(`${location}.item_name must be a safe ASCII identifier`);
    }
    if (itemNames.has(itemName)) {
      throw new Error(`content item_name values must be unique: ${itemName}`);
    }
    itemNames.add(itemName);
    nonEmptyString(item.label, `${location}.label`);
    if (!["grid", "flow"].includes(item.type)) {
      throw new Error(`${location}.type must be grid or flow`);
    }
    if (item.content_generation_prompt !== undefined && typeof item.content_generation_prompt !== "string") {
      throw new Error(`${location}.content_generation_prompt must be a string`);
    }
    if (item.style_marker !== undefined && !["TOPOLOGY", "LOGIC", "HYBRID"].includes(item.style_marker)) {
      throw new Error(`${location}.style_marker must be TOPOLOGY, LOGIC, or HYBRID`);
    }
    const rows = parseGridSpan(item["grid-rows"], `${location}.grid-rows`);
    const columns = parseGridSpan(item["grid-columns"], `${location}.grid-columns`);
    return { itemName, rows, columns };
  });

  for (let left = 0; left < parsedPartitions.length; left += 1) {
    for (let right = left + 1; right < parsedPartitions.length; right += 1) {
      const first = parsedPartitions[left];
      const second = parsedPartitions[right];
      const rowsOverlap = first.rows.some((row) => second.rows.includes(row));
      const columnsOverlap = first.columns.some((column) => second.columns.includes(column));
      if (rowsOverlap && columnsOverlap) {
        throw new Error(`top-level grid partitions must not overlap: ${first.itemName} and ${second.itemName}`);
      }
    }
  }

  if (outline.layout_policy.preset === "three_lane") {
    if (outline.content.length !== 3) {
      throw new Error("three_lane requires exactly three top-level partitions");
    }
    const columns = parsedPartitions.map((item) => item.columns.join(",")).sort();
    if (JSON.stringify(columns) !== JSON.stringify(["1", "2", "3"])) {
      throw new Error("three_lane requires one partition in each of columns 1, 2, 3");
    }
    const rowSpans = new Set(parsedPartitions.map((item) => item.rows.join(",")));
    if (rowSpans.size !== 1) {
      throw new Error("three_lane partitions must share the same complete row span");
    }
  }

  const relationships = outline.global_relationships === undefined ? [] : outline.global_relationships;
  if (!Array.isArray(relationships)) {
    throw new Error("global_relationships must be an array");
  }
  const sourceEvidence = normalizedEvidence(userRequest);
  relationships.forEach((relationship, index) => {
    const location = `global_relationships[${index}]`;
    assertExactKeys(relationship, ["from", "to", "label", "evidence_quote", "kind"], location);
    requireKeys(relationship, ["from", "to", "evidence_quote"], location);
    const from = nonEmptyString(relationship.from, `${location}.from`);
    const to = nonEmptyString(relationship.to, `${location}.to`);
    if (!SAFE_OUTLINE_ID_RE.test(from) || !SAFE_OUTLINE_ID_RE.test(to)) {
      throw new Error(`${location} endpoints must be safe ASCII identifiers`);
    }
    if (from === to) {
      throw new Error(`${location} endpoints must be different`);
    }
    if (!itemNames.has(from) || !itemNames.has(to)) {
      throw new Error(`${location} endpoints must name top-level content items`);
    }
    if (relationship.label !== undefined && typeof relationship.label !== "string") {
      throw new Error(`${location}.label must be a string`);
    }
    if (relationship.kind !== undefined && (typeof relationship.kind !== "string" || !relationship.kind.trim())) {
      throw new Error(`${location}.kind must be a non-empty string`);
    }
    const quote = nonEmptyString(relationship.evidence_quote, `${location}.evidence_quote`);
    if (!sourceEvidence || !normalizedEvidence(quote) || !sourceEvidence.includes(normalizedEvidence(quote))) {
      throw new Error(`${location}.evidence_quote must be an exact excerpt of user_request`);
    }
  });

  return outline;
}


const { prepareAuthoring, saveExportedModel, validatePresentation } = require("./authoring.cjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const http = require("http");
const https = require("https");
const tls = require("tls");

function getProxyForUrl(targetUrl) {
  const protocol = targetUrl.protocol;
  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy;
  } else if (protocol === "http:") {
    return process.env.HTTP_PROXY || process.env.http_proxy;
  }
  return null;
}

function makeRequest(urlString, options, requestData = null, timeoutMs = 3000000) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(urlString);
    const proxyStr = getProxyForUrl(targetUrl);

    const requestOptions = {
      ...options,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      protocol: targetUrl.protocol,
    };

    if (proxyStr) {
      const isTargetHttps = targetUrl.protocol === "https:";
      const AgentClass = isTargetHttps ? https.Agent : http.Agent;

      class ProxyAgent extends AgentClass {
        createConnection(opts, cb) {
          let proxyUrl;
          try {
            proxyUrl = new URL(proxyStr);
          } catch (e) {
            return cb(new Error(`Invalid proxy URL: ${proxyStr}`));
          }

          const isHttpsProxy = proxyUrl.protocol === "https:";
          const proxyRequestOptions = {
            method: "CONNECT",
            host: proxyUrl.hostname,
            port: proxyUrl.port || (isHttpsProxy ? 443 : 80),
            path: `${targetUrl.hostname}:${targetUrl.port || (isTargetHttps ? 443 : 80)}`,
            headers: {
              Host: targetUrl.hostname,
            },
          };

          if (proxyUrl.username || proxyUrl.password) {
            const auth = Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString("base64");
            proxyRequestOptions.headers["Proxy-Authorization"] = `Basic ${auth}`;
          }

          const proxyReq = (isHttpsProxy ? https : http).request(proxyRequestOptions);

          proxyReq.on("connect", (res, socket, head) => {
            if (res.statusCode === 200) {
              if (isTargetHttps) {
                const tlsSocket = tls.connect({
                  socket: socket,
                  servername: targetUrl.hostname,
                });
                tlsSocket.on('error', (err) => {
                  cb(err);
                });
                cb(null, tlsSocket);
              } else {
                cb(null, socket);
              }
            } else {
              cb(new Error(`Proxy connection failed: ${res.statusCode}`));
            }
          });

          proxyReq.on("error", (err) => {
            cb(err);
          });

          proxyReq.setTimeout(timeoutMs, () => {
            proxyReq.destroy(new Error("timeout"));
          });

          proxyReq.end();
        }
      }

      requestOptions.agent = new ProxyAgent();
    }

    const lib = targetUrl.protocol === "https:" ? https : http;
    const req = lib.request(requestOptions, (res) => {
      resolve(res);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", (err) => {
      if (err.message === "timeout" || err.code === "ECONNRESET") {
        reject(new Error("timeout"));
      } else {
        reject(err);
      }
    });

    if (requestData) {
      req.write(requestData);
    }
    req.end();
  });
}

function readBody(response) {
  return new Promise((resolve, reject) => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      resolve(data);
    });
    response.on('error', (err) => {
      reject(err);
    });
  });
}

function getSkillVersion() {
  try {
    const skillMdPath = path.join(__dirname, '..', 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const match = content.match(/^version:\s*(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {}
  return "unknown";
}

const SKILL_VERSION = getSkillVersion();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
  if (!error) return false;
  if (error.message === "timeout") return true;
  return ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(error.code);
}

class CWClient {
  constructor() {
    const baseUrl = process.env.CW_API_BASE_URL || "https://pptx.chenxitech.site";
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    this.timeoutMs = 3000000;
    this.maxRequestRetries = parseInt(process.env.CW_REQUEST_MAX_RETRIES || "3", 10);
    this.retryBaseMs = parseInt(process.env.CW_REQUEST_RETRY_BASE_MS || "2000", 10);
    this.editorProtocol = process.env.CONTEXTWEAVE_EDITOR_PROTOCOL || "trae";
    this.runEndpoint = process.env.CW_RUN_ENDPOINT || "/a2m/run";
  }

  validateBaseUrl() {
    try {
      const url = new URL(this.baseUrl);
      if (url.hostname !== "pptx.chenxitech.site") {
        return this.error("INVALID_DOMAIN", "Only pptx.chenxitech.site domain is allowed");
      }
    } catch (e) {
      return this.error("INVALID_DOMAIN", "Invalid base URL");
    }
    return null;
  }

  headers(requestId = null) {
    const headers = {
      "X-Request-ID": requestId || this.createRequestId(),
      "Content-Type": "application/json",
      "X-Skill-Version": SKILL_VERSION
    };
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

  async request(endpoint, payload, options = {}) {
    const baseUrlError = this.validateBaseUrl();
    if (baseUrlError) {
      return baseUrlError;
    }
    const body = { ...payload };
    if (this.editorProtocol) {
      body.editor_protocol = this.editorProtocol;
    }
    const requestId = options.requestId || this.createRequestId();
    const requestUrl = new URL(`${this.baseUrl}${endpoint}`);
    if (requestUrl.pathname === "/a2m/run") {
      const existingRequestId = requestUrl.searchParams.get("request_id");
      if (existingRequestId && existingRequestId !== requestId) {
        return this.error("INVALID_PAYMENT_REQUEST", "付费资源 URL 与 X-Request-ID 不一致");
      }
      requestUrl.searchParams.set("request_id", requestId);
    }

    for (let attempt = 1; attempt <= this.maxRequestRetries; attempt += 1) {
      try {
        const response = await this.postJson(requestUrl.toString(), body, requestId);
        if (response.statusCode >= 500) {
          // 5xx 视为瞬时故障，指数退避后重试
          if (attempt < this.maxRequestRetries) {
            const waitMs = this.retryBaseMs * Math.pow(2, attempt - 1);
            process.stderr.write(`[retry ${attempt}/${this.maxRequestRetries}] 服务端 ${response.statusCode}，${waitMs / 1000}s 后重试...\n`);
            await sleep(waitMs);
            continue;
          }
          return this.error("API_ERROR", `${response.statusCode} ${response.statusMessage || "Server Error"}（已自动重试 ${this.maxRequestRetries} 次）`, true, "后端服务暂时不可用，请稍后重试；若持续失败请走 submit_feedback 兜底");
        }
        return this.handleResponse(response);
      } catch (error) {
        if (isTransientNetworkError(error) && attempt < this.maxRequestRetries) {
          const waitMs = this.retryBaseMs * Math.pow(2, attempt - 1);
          process.stderr.write(`[retry ${attempt}/${this.maxRequestRetries}] 网络瞬时故障（${error.message || error.code}），${waitMs / 1000}s 后重试...\n`);
          await sleep(waitMs);
          continue;
        }
        return this.error("API_ERROR", String(error.message || error), true, "请检查网络或后端服务状态后重试");
      }
    }
  }

  handleResponse(response) {
    try {
      if (response.statusCode === 402) {
        const rawPaymentNeeded = response.headers && response.headers["payment-needed"];
        const paymentNeeded = Array.isArray(rawPaymentNeeded)
          ? rawPaymentNeeded[0]
          : rawPaymentNeeded;

        if (typeof paymentNeeded === "string" && paymentNeeded.trim()) {
          const configuredBillFile = process.env.CONTEXTWEAVE_A2M_BILL_FILE;
          let savedBillFile = null;

          if (configuredBillFile) {
            const pathError = this.validateSafePath(configuredBillFile);
            if (pathError) {
              return pathError;
            }
            try {
              const billFile = path.resolve(configuredBillFile);
              fs.mkdirSync(path.dirname(billFile), { recursive: true, mode: 0o700 });
              fs.writeFileSync(billFile, paymentNeeded.trim(), { encoding: "utf8", mode: 0o600 });
              try { fs.chmodSync(billFile, 0o600); } catch (e) {}
              savedBillFile = billFile;
            } catch (error) {
              return this.error(
                "PAYMENT_STATE_WRITE_FAILED",
                `无法保存支付账单：${String(error.message || error)}`,
                true,
                "检查支付状态目录是否位于当前工作区且可写"
              );
            }
          }

          const result = this.error(
            "A2M_PAYMENT_REQUIRED",
            "支付宝 A2M 支付授权尚未完成",
            true,
            savedBillFile
              ? "读取账单摘要并取得用户对本次金额的明确确认后，再由支付宝官方支付组件继续"
              : "请改用 contextweave_paid.mjs 的 probe 流程生成受保护的账单状态"
          );
          result.payment = {
            protocol: "A2M",
            bill_saved: Boolean(savedBillFile),
          };
          if (savedBillFile) {
            result.payment.bill_file = savedBillFile;
          }
          return result;
        }

        return this.error("A2M_PROTOCOL_ERROR", "402 response is missing Payment-Needed", true, "停止付款并检查 /a2m/run 的 A2M 服务配置；不要切换到免费入口");
      }
      if (response.statusCode === 403) {
        return this.error("AUTH_ERROR", "Paid endpoint rejected access", true, "检查 A2M 服务配置；付费 Skill 不使用免费版 API Key");
      }
      if (response.statusCode === 426) {
        let parsed = {};
        try { parsed = JSON.parse(response.body); } catch(e) {}
        const detail = parsed.detail || {};
        return this.error(
          detail.code || "OUTDATED_SKILL",
          detail.message || "Skill版本已过期",
          true,
          detail.recovery_hint || "请下载最新版本"
        );
      }
      if (response.statusCode === 429) {
        let errorMsg = "Too Many Requests";
        try {
          const parsed = JSON.parse(response.body);
          errorMsg = parsed.detail || parsed.error || errorMsg;
        } catch (e) {}
        return this.error("A2M_RATE_LIMITED", errorMsg, true, "保持原 X-Request-ID 稍后重试同一请求；不要自动重新付款或改走免费入口");
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

  async postJson(urlString, body, requestId = null) {
    const requestData = JSON.stringify(body);
    const headers = {
      ...this.headers(requestId),
      "Content-Length": Buffer.byteLength(requestData),
    };
    const requestOptions = {
      method: "POST",
      headers,
    };

    const requestFile = process.env.CONTEXTWEAVE_A2M_REQUEST_FILE;
    if (requestFile && urlString.includes("/a2m/run")) {
      const pathError = this.validateSafePath(requestFile);
      if (pathError) throw new Error(pathError.error.message);
      const safeHeaders = {
        "Content-Type": headers["Content-Type"],
        "X-Request-ID": headers["X-Request-ID"],
        "X-Skill-Version": headers["X-Skill-Version"],
      };
      fs.mkdirSync(path.dirname(requestFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        requestFile,
        `${JSON.stringify({ url: urlString, method: "POST", body: requestData, headers: safeHeaders }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      try { fs.chmodSync(requestFile, 0o600); } catch (e) {}
    }

    try {
      const response = await makeRequest(urlString, requestOptions, requestData, this.timeoutMs);
      const responseBody = await readBody(response);

      return {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers || {},
        body: responseBody,
      };
    } catch (error) {
      if (error.message === "timeout") {
        throw new Error("timeout");
      }
      throw error;
    }
  }

  readOutlineIntentFile(targetPath, userRequest) {
    if (!targetPath || typeof targetPath !== "string") {
      return { error: this.error("INVALID_OUTLINE_FILE", "outline_file path is empty or invalid") };
    }
    if (!path.isAbsolute(targetPath)) {
      return { error: this.error("OUTLINE_FILE_NOT_ABSOLUTE", `outline_file must be absolute: ${targetPath}`) };
    }

    const requestedPath = path.resolve(targetPath);
    if (!fs.existsSync(requestedPath)) {
      return { error: this.error("OUTLINE_FILE_NOT_FOUND", `outline_file not found: ${targetPath}`) };
    }

    let workspaceRealPath;
    let outlineRealPath;
    let stats;
    try {
      workspaceRealPath = fs.realpathSync.native(process.cwd());
      outlineRealPath = fs.realpathSync.native(requestedPath);
      const relative = path.relative(workspaceRealPath, outlineRealPath);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return { error: this.error("OUTLINE_PATH_OUTSIDE_WORKSPACE", "outline_file must resolve within the current workspace") };
      }
      stats = fs.statSync(outlineRealPath);
    } catch (error) {
      return { error: this.error("OUTLINE_FILE_READ_ERROR", `failed to inspect outline_file: ${String(error.message || error)}`) };
    }

    if (!stats.isFile()) {
      return { error: this.error("OUTLINE_FILE_NOT_REGULAR", "outline_file must be a regular file") };
    }
    if (stats.size > MAX_OUTLINE_FILE_BYTES) {
      return { error: this.error("OUTLINE_FILE_TOO_LARGE", `outline_file exceeds ${MAX_OUTLINE_FILE_BYTES} bytes`) };
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(outlineRealPath, "utf8"));
    } catch (error) {
      return { error: this.error("INVALID_OUTLINE_JSON", `outline_file must contain valid JSON: ${String(error.message || error)}`) };
    }
    try {
      return { value: validateOutlineIntent(parsed, userRequest) };
    } catch (error) {
      return {
        error: this.error(
          "INVALID_OUTLINE_INTENT",
          String(error.message || error),
          true,
          "按声明的 OutlineIntent 版本修正后重试；v2 保留完整原文，勿传本地路径作为来源"
        ),
      };
    }
  }


  async getCapabilities() {
    const baseUrlError = this.validateBaseUrl();
    if (baseUrlError) return baseUrlError;
    try {
      const response = await makeRequest(`${this.baseUrl}/capabilities`, { method: "GET", headers: this.headers() }, null, Math.min(this.timeoutMs, 30000));
      return this.handleResponse({ statusCode: response.statusCode, statusMessage: response.statusMessage, headers: response.headers || {}, body: await readBody(response) });
    } catch (error) {
      return this.error("AUTHORING_CAPABILITY_CHECK_FAILED", String(error.message || error), true, "能力查询失败，未提交生成请求；检查后端后重试");
    }
  }

  async runGeneration({ userRequest, diagramType = null, outlineFile = null, coDesignRevision = null, coDesignEditPaths = null, coDesignUpstreamUsage = null, authoringFile = null, inputFile = null, sessionId = null, inputSequence = null, validateRequestLength = false, diagramStyle = null, morphology = null, accentTargets = null, basePalette = null, enablePlan = false, n = 1, topK = 1 }) {
    const payload = {
      input_sequence: inputSequence,
      export_svg: true,
      export_pptx: false,
      session_id: sessionId,
      test_file: null,
      n: n,
      top_k: topK,
    };
    if (authoringFile) {
      if (basePalette) payload.base_palette = basePalette;
      const error = await prepareAuthoring(this, { authoringFile, userRequest, inputFile, outlineFile, inputSequence, enablePlan, diagramStyle, morphology, diagramType, accentTargets, n, topK }, payload);
      if (error) return error;
      const requestId = this.createRequestId();
      const separator = this.runEndpoint.includes("?") ? "&" : "?";
      return this.request(`${this.runEndpoint}${separator}request_id=${encodeURIComponent(requestId)}`, payload, { requestId });
    }
    if (diagramType) {
      if (!["auto", "general", "swimlane"].includes(diagramType)) return this.error("INVALID_DIAGRAM_TYPE", "diagram_type 必须为 auto、general 或 swimlane");
      payload.diagram_type = diagramType;
    }

    if (diagramStyle) {
      payload.diagram_style = diagramStyle;
    }
    if (morphology) {
      payload.morphology = morphology;
    }
    if (accentTargets) {
      payload.accent_targets = accentTargets;
    }
    if (basePalette) {
      payload.base_palette = basePalette;
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
          const afterFenceIndex = cwPart.indexOf("```cw");
          if (afterFenceIndex !== -1) {
            const afterFence = cwPart.substring(afterFenceIndex + 5);
            const lastFenceIndex = afterFence.lastIndexOf("```");
            if (lastFenceIndex !== -1) {
              cwText = afterFence.substring(0, lastFenceIndex).trim();
            } else {
              cwText = afterFence.trim();
            }
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

        // Try to parse user_request as JSON to extract base_path if present
        try {
          let jsonText = reqText;
          // Extract JSON block if enclosed in markdown
          const jsonMatch = reqText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1];
          }
          const parsedReq = JSON.parse(jsonText);
          if (parsedReq && parsedReq.base_path) {
            payload.base_path = parsedReq.base_path;
          }
        } catch (e) {
          // Not a valid JSON or no base_path, which is fine for normal text requests
        }

      } catch (error) {
        return this.error("READ_ERROR", `Failed to read input file: ${String(error.message || error)}`);
      }
    } else {
      payload.user_request = userRequest;
    }

    if (validateRequestLength && !outlineFile) {
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

    if (outlineFile) {
      const outlineResult = this.readOutlineIntentFile(outlineFile, payload.user_request);
      if (outlineResult.error) {
        return outlineResult.error;
      }
      if (outlineResult.value.outline_intent_version === 2) {
        const capabilities = await this.getCapabilities();
        if (capabilities?.status === "error") return capabilities;
        if (!capabilities?.co_design?.versions?.includes(2) || capabilities.co_design.execution !== "joint") {
          return this.error("CO_DESIGN_UNSUPPORTED", "后端未声明联合生成 v2 能力；请升级后端，不自动降级 v1");
        }
        const presentationError = validatePresentation(capabilities, basePalette, "co_design");
        if (presentationError) return presentationError;
        const roles = (outlineResult.value.regions || []).filter(r => r.style_role);
        if (roles.some(r => !capabilities.co_design.style_roles?.includes(r.style_role))) return this.error("PRESENTATION_UNSUPPORTED", "后端未声明所用 style_role 能力");
        if (roles.length && !basePalette?.style_preset && !sessionId) return this.error("PRESENTATION_REQUIRED", "style_role 需要同时选择版本化 base_palette.style_preset");
        const dimensions = capabilities.co_design.hard_dimensions;
        const unsupported = (outlineResult.value.requirements || []).filter(rule =>
          Array.isArray(dimensions) ? !dimensions.includes(rule.kind) : rule.kind === "track_span");
        if (unsupported.length) {
          return this.error("CO_DESIGN_UNSUPPORTED", `后端未声明这些规则能力：${[...new Set(unsupported.map(rule => rule.kind))].join(", ")}`);
        }
      }
      payload.outline_intent = outlineResult.value;
      payload.outline_intent_version = outlineResult.value.outline_intent_version;
    }

    if (!outlineFile && basePalette?.style_preset?.endsWith("-v1")) {
      const capabilities = await this.getCapabilities();
      if (capabilities?.status === "error") return capabilities;
      const error = validatePresentation(capabilities, basePalette, "co_design");
      if (error) return error;
      if (!sessionId) return this.error("PRESENTATION_REQUIRED", "联合生成视觉方案需要 outline_file 中的宏观区域 style_role");
    }
    if (coDesignRevision !== null) payload.co_design_revision = coDesignRevision;
    if (coDesignEditPaths !== null) payload.co_design_edit_paths = coDesignEditPaths;
    if (coDesignUpstreamUsage !== null) payload.co_design_upstream_usage = coDesignUpstreamUsage;
    const requestId = this.createRequestId();
    const separator = this.runEndpoint.includes("?") ? "&" : "?";
    const paidEndpoint = `${this.runEndpoint}${separator}request_id=${encodeURIComponent(requestId)}`;
    const result = await this.request(paidEndpoint, payload, { requestId });
    // 打印服务端透传的 lint 软警告（仅提示，不影响成功判定与返回值）
    if (result && Array.isArray(result.warnings) && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(`[generation warnings] ${warning}`);
      }
    }
    return result;
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

  async exportCode(sessionId, target = "ContextWeave", format = "cw") {
    if (!["cw", "authoring"].includes(format)) return this.error("INVALID_EXPORT_FORMAT", "format 必须为 cw 或 authoring");
    const pathError = this.validateSafePath(target);
    if (pathError) return pathError;
    const result = await this.request("/session/export", { session_id: sessionId, ...(format === "authoring" ? { include_source: false } : {}) });
    if (result.status === "error") return result;
    if (format === "authoring" && !result.authoring_model) return this.error("AUTHORING_MODEL_NOT_FOUND", "该会话不是结构化图；使用原 CW 编辑流程");
    const targetPath = path.resolve(target);
    try {
      fs.mkdirSync(targetPath, { recursive: true });
      const authoringFiles = saveExportedModel(result, targetPath);
      let targetFile = authoringFiles.saved_authoring_file;
      if (format === "cw") {
        targetFile = path.join(targetPath, "diagram.cw");
        fs.writeFileSync(targetFile, result.cw_code || "", "utf8");
      }
      return { status: "ok", file_path: targetFile, session_id: sessionId, ...authoringFiles };
    } catch (error) {
      return this.error("WRITE_ERROR", String(error.message || error));
    }
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

async function downloadFile(urlString, dest) {
  try {
    new URL(urlString);
  } catch (e) {
    throw new Error("Invalid URL");
  }

  try {
    const response = await makeRequest(urlString, { method: "GET" }, null, 3000000);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Failed to download file, status code: ${response.statusCode}`);
    }

    const file = fs.createWriteStream(dest);

    return new Promise((resolve, reject) => {
      response.pipe(file);

      file.on("finish", () => {
        file.close(() => resolve(dest));
      });

      response.on("error", (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });

      file.on("error", (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  } catch (err) {
    fs.unlink(dest, () => {});
    throw err;
  }
}

async function downloadAssetsLocally(result) {
  if (!result || result.status !== "ok") {
    return result;
  }

  const sessionId = result.session_id || "diagram";
  const outputName = result.output_name || `diagram_${sessionId}`;

  let targetDir = process.cwd();
  if (result.output_dir) {
    targetDir = path.resolve(result.output_dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }

  // Handle svg_url or raw_svg_url
  const svgUrl = result.raw_svg_url || result.svg_url;
  if (svgUrl && svgUrl !== "WAITING_FOR_EXPERT_PROCESSING") {
    // If it's HTML wrapper, the download might get HTML. It's better to fetch raw_svg_url if available, or just download what's there.
    const ext = svgUrl.includes(".html") ? ".html" : ".svg";
    const dest = path.join(targetDir, `${outputName}${ext}`);
    try {
      await downloadFile(svgUrl, dest);
      result.saved_svg_file = dest;
      result.message = (result.message ? result.message + "\n" : "") + `资源已自动下载到本地：${dest}`;
    } catch (err) {
      // Silently fail or log error
    }
  }

  // Handle generation responses (pptx_url) and explicit session exports
  // whose primary URL is returned as download_url.
  const pptxFormats = ["pptx", "pptx-svg", "pptx-native"];
  const pptxUrl = result.pptx_url || (pptxFormats.includes(result.format) ? result.download_url : null);
  if (pptxUrl) {
    const dest = path.join(targetDir, `${outputName}.pptx`);
    try {
      await downloadFile(pptxUrl, dest);
      result.saved_pptx_file = dest;
      result.message = (result.message ? result.message + "\n" : "") + `PPTX 资源已自动下载到本地：${dest}`;
    } catch (err) {
      // Silently fail or log error
    }
  }

  return result;
}

module.exports = {
  CWClient,
  normalizeAssetResult,
  downloadAssetsLocally,
  printJson,
};
