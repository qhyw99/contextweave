#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CWClient, downloadAssetsLocally, normalizeAssetResult } = require("./cw_client.cjs");
const { saveAuthoringArtifacts } = require("./authoring.cjs");

export const DEFAULT_RESOURCE_URL = "https://pptx.chenxitech.site/a2m/run";
export const DEFAULT_PAY_COMMAND = "402-buyer-pay";
export const DEFAULT_QUERY_COMMAND = "402-query-payment-status";
export const DEFAULT_ACK_COMMAND = "402-buyer-fulfillment-ack";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_SCRIPT = path.join(SCRIPT_DIR, "generate_contextweave.cjs");
const STATE_FILE = "state.json";
const BILL_FILE = "payment-needed.txt";
const REQUEST_FILE = "resource-request.json";
const MAX_CHILD_OUTPUT = 8 * 1024 * 1024;
const INTERNAL_OPTIONS = new Set([
  "--state_dir",
  "--state-dir",
  "--resource_url",
  "--resource-url",
  "--intent_summary",
  "--intent-summary",
  "--confirmed",
  "--trade_no",
  "--trade-no",
  "--out_shake_no",
  "--out-shake-no",
]);

class PaidFlowError extends Error {
  constructor(code, message, recoveryHint = null, extra = null) {
    super(message);
    this.name = "PaidFlowError";
    this.code = code;
    this.recoveryHint = recoveryHint;
    this.extra = extra;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) continue;
    const next = argv[i + 1];
    const value = next && !next.startsWith("-") ? next : "true";
    args[token] = value;
    if (value !== "true") i += 1;
  }
  return args;
}

function option(args, ...names) {
  for (const name of names) {
    if (args[name] !== undefined) return args[name];
  }
  return undefined;
}

function forwardedGenerateArgs(argv) {
  const result = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (INTERNAL_OPTIONS.has(token)) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}

function outputJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function toErrorResult(error) {
  const result = {
    status: "error",
    error: {
      code: error.code || "PAID_FLOW_ERROR",
      message: String(error.message || error),
      recoverable: true,
    },
  };
  if (error.recoveryHint) result.error.recovery_hint = error.recoveryHint;
  if (error.extra && typeof error.extra === "object") Object.assign(result, error.extra);
  return result;
}

function ensureWithinWorkspace(targetPath, cwd = process.cwd()) {
  const absolute = path.resolve(targetPath);
  const root = path.resolve(cwd);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PaidFlowError(
      "PAYMENT_STATE_OUTSIDE_WORKSPACE",
      "支付状态目录必须位于当前工作区内",
      "把 --state_dir 设置到当前工作区的 .cw_skill/payments 下"
    );
  }
  return absolute;
}

export function validateResourceUrl(resourceUrl, { allowLocalhost = false } = {}) {
  let parsed;
  try {
    parsed = new URL(resourceUrl);
  } catch (error) {
    throw new PaidFlowError("INVALID_PAID_RESOURCE_URL", "付费资源地址不是合法 URL");
  }

  const localhost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (allowLocalhost && localhost && ["http:", "https:"].includes(parsed.protocol)) {
    return parsed.toString();
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "pptx.chenxitech.site") {
    throw new PaidFlowError(
      "INVALID_PAID_RESOURCE_URL",
      "付费资源只允许使用 ContextWeave 官方 HTTPS 服务",
      `使用 ${DEFAULT_RESOURCE_URL}`
    );
  }
  return parsed.toString();
}

function decodeBase64Url(value) {
  const normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (error) {
    throw new PaidFlowError(
      "INVALID_PAYMENT_NEEDED",
      "Payment-Needed 不是有效的 Base64URL JSON 账单",
      "停止支付并检查服务端 A2M 接入"
    );
  }
}

function amountToCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return Number(BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0")));
}

function requiredString(object, group, key) {
  const value = object?.[group]?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PaidFlowError(
      "INVALID_PAYMENT_NEEDED",
      `Payment-Needed 缺少 ${group}.${key}`,
      "停止支付并检查服务端 A2M 账单字段"
    );
  }
  return value.trim();
}

function safeDisplayText(value, fieldName, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new PaidFlowError(
      "INVALID_PAYMENT_NEEDED",
      `Payment-Needed 的 ${fieldName} 不是安全的展示文本`,
      "停止支付并检查服务端账单内容"
    );
  }
  return text;
}

function minimalIntentSummary(value) {
  const normalized = String(value || "生成 ContextWeave 结构图").replace(/\s+/g, " ").trim();
  const summary = normalized.slice(0, 150) || "生成 ContextWeave 结构图";
  return summary.startsWith("原始请求：") ? summary : `原始请求：${summary}`;
}

export function validatePaymentNeeded(encodedBill, resourceUrl = DEFAULT_RESOURCE_URL) {
  const bill = decodeBase64Url(encodedBill);
  const requiredProtocol = [
    "out_trade_no",
    "amount",
    "currency",
    "resource_id",
    "pay_before",
    "seller_signature",
    "seller_sign_type",
    "seller_unique_id",
  ];
  const requiredMethod = [
    "seller_name",
    "seller_id",
    "seller_app_id",
    "goods_name",
    "seller_unique_id_key",
    "service_id",
  ];
  for (const key of requiredProtocol) requiredString(bill, "protocol", key);
  for (const key of requiredMethod) requiredString(bill, "method", key);

  const cents = amountToCents(bill.protocol.amount);
  if (!Number.isInteger(cents)) {
    throw new PaidFlowError(
      "INVALID_PAYMENT_AMOUNT",
      "A2M 单次账单金额必须是最多两位小数的有效金额",
      "停止支付并检查服务注册价格与 402 账单金额"
    );
  }
  if (bill.protocol.currency !== "CNY") {
    throw new PaidFlowError("INVALID_PAYMENT_CURRENCY", "A2M 账单币种必须为 CNY");
  }
  if (cents !== 5) {
    throw new PaidFlowError(
      "PAYMENT_PRICE_MISMATCH",
      "ContextWeave 付费版单次账单必须严格为 0.05 CNY",
      "停止支付并检查后端签名价格与 SkillHub 展示价格"
    );
  }
  if (bill.protocol.seller_sign_type !== "RSA2") {
    throw new PaidFlowError("INVALID_PAYMENT_SIGNATURE", "A2M 商家签名类型必须为 RSA2");
  }

  const expiresAt = Date.parse(bill.protocol.pay_before);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new PaidFlowError(
      "PAYMENT_BILL_EXPIRED",
      "A2M 账单已过期或 pay_before 无效",
      "重新执行 probe 获取新账单；不要复用旧 Payment-Needed"
    );
  }

  const baseUrl = validateResourceUrl(resourceUrl);
  const resolvedResourceUrl = validateResourceUrl(new URL(bill.protocol.resource_id, baseUrl).toString());
  return {
    bill,
    resolvedResourceUrl,
    summary: {
      amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
      currency: "CNY",
      goods_name: safeDisplayText(bill.method.goods_name, "method.goods_name"),
      seller_name: safeDisplayText(bill.method.seller_name, "method.seller_name"),
      pay_before: bill.protocol.pay_before,
    },
  };
}

async function writeProtectedJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { await chmod(tempPath, 0o600); } catch (error) {}
  await rename(tempPath, filePath);
  try { await chmod(filePath, 0o600); } catch (error) {}
}

async function readState(stateDir) {
  const filePath = path.join(stateDir, STATE_FILE);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new PaidFlowError(
      "PAYMENT_STATE_NOT_FOUND",
      "未找到有效的支付状态",
      "使用 probe 返回的 state_dir，不要手工重建账单"
    );
  }
}

async function saveState(stateDir, state) {
  await writeProtectedJson(path.join(stateDir, STATE_FILE), state);
}

function runChild(command, args, { env = process.env, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let size = 0;

    const collect = (bucket, target, chunk) => {
      size += chunk.length;
      if (size > MAX_CHILD_OUTPUT) {
        child.kill();
        reject(new PaidFlowError("PAYMENT_OUTPUT_TOO_LARGE", "支付组件输出超过安全上限"));
        return;
      }
      bucket.push(chunk);
      if (stream) target.write(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, process.stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, process.stderr, chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function resolveAlipayBotInvocation(args) {
  const configured = process.env.CONTEXTWEAVE_ALIPAY_BOT_BIN;
  if (process.platform === "win32") {
    const cliFile = process.env.CONTEXTWEAVE_ALIPAY_BOT_CLI
      || path.join(
        process.env.USERPROFILE || "",
        ".openclaw-autoclaw",
        "alipay-bot-cli",
        "runtime",
        "dist",
        "cli.js"
      );
    const mayUseInstalledCli = !configured || /(?:^|[\\/])alipay-bot(?:\.cmd)?$/i.test(configured);
    if (mayUseInstalledCli) {
      try {
        await access(cliFile);
        return { command: process.execPath, args: [cliFile, ...args] };
      } catch (error) {
        // Fall through to the normal executable lookup and its existing recovery path.
      }
    }
  }
  return { command: configured || "alipay-bot", args };
}

function parseJsonOutput(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try { return JSON.parse(source); } catch (error) {}

  const lines = source.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try { return JSON.parse(line); } catch (error) {}
  }
  return null;
}

function findValueByKeys(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return null;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const child of Object.values(value)) {
    const found = findValueByKeys(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function findLabeledValue(text, labels) {
  const source = String(text || "");
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}\\s*[：:]\\s*([A-Za-z0-9_.-]+)`));
    if (match) return match[1];
  }
  return null;
}

function validOutShakeNo(value) {
  return /^\d{32}$/.test(String(value || "")) && String(value).slice(10, 14) === "8282";
}

function findGenerationResult(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return null;
  if (
    value.status === "ok" ||
    value.cw_code ||
    value.svg_url ||
    value.raw_svg_url ||
    Array.isArray(value.choices)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findGenerationResult(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function sanitizeResult(value) {
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (!value || typeof value !== "object") return value;
  const blocked = new Set([
    "payment_needed",
    "payment-needed",
    "payment_proof",
    "payment-proof",
    "client_session",
    "trade_no",
    "tradeNo",
    "out_trade_no",
    "outTradeNo",
    "pay_url",
    "payUrl",
    "qr_code",
    "qrCode",
  ]);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!blocked.has(key)) result[key] = sanitizeResult(child);
  }
  return result;
}

function getForwardedArg(args, ...names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const next = args[i + 1];
    if (next && !next.startsWith("-")) return next;
  }
  return null;
}

function safeOutputName(value) {
  const candidate = path.basename(String(value || "contextweave_paid"));
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_") || "contextweave_paid";
}

function currentPaymentSessionId() {
  const sessionId = process.env.CODEX_THREAD_ID || process.env.AIPAY_SESSION_ID;
  if (!sessionId || !String(sessionId).trim()) {
    throw new PaidFlowError(
      "PAYMENT_SESSION_ID_MISSING",
      "运行时未提供当前会话标识",
      "由当前 Agent 运行时提供 CODEX_THREAD_ID，或仅在其缺失时提供 AIPAY_SESSION_ID"
    );
  }
  return String(sessionId).trim();
}

async function persistGenerationResult(rawResult, state) {
  const result = normalizeAssetResult({ ...rawResult });
  const outputName = safeOutputName(state.outputName);
  const rawOutputDir = state.outputDir || process.cwd();
  const outputDir = ensureWithinWorkspace(rawOutputDir);
  await mkdir(outputDir, { recursive: true });
  await saveAuthoringArtifacts(new CWClient(), result, { outputName, outputDir });

  if (Array.isArray(result.choices)) {
    for (let i = 0; i < result.choices.length; i += 1) {
      const choice = normalizeAssetResult(result.choices[i]);
      const choiceName = `${outputName}_choice_${i + 1}`;
      if (choice.cw_code) {
        const cwFile = path.join(outputDir, `${choiceName}.cw`);
        const choiceSessionId = choice.session_id || result.session_id;
        const prefix = choiceSessionId ? `# session_id: ${choiceSessionId}\n` : "";
        await writeFile(cwFile, `${prefix}${choice.cw_code}`, "utf8");
        delete choice.cw_code;
        choice.saved_cw_file = cwFile;
      }
      const assetResult = {
        ...choice,
        status: "ok",
        session_id: choice.session_id || result.session_id,
        output_name: choiceName,
        output_dir: outputDir,
      };
      await downloadAssetsLocally(assetResult);
      if (assetResult.saved_svg_file) choice.saved_svg_file = assetResult.saved_svg_file;
      if (assetResult.saved_pptx_file) choice.saved_pptx_file = assetResult.saved_pptx_file;
      if (assetResult.message) choice.message = assetResult.message;
      result.choices[i] = choice;
    }
  } else if (result.cw_code) {
    const cwFile = path.join(outputDir, `${outputName}.cw`);
    const prefix = result.session_id ? `# session_id: ${result.session_id}\n` : "";
    await writeFile(cwFile, `${prefix}${result.cw_code}`, "utf8");
    delete result.cw_code;
    result.saved_cw_file = cwFile;
  }

  result.output_name = outputName;
  result.output_dir = outputDir;
  if (!Array.isArray(result.choices)) await downloadAssetsLocally(result);
  return sanitizeResult(result);
}

export function buildBuyerPayArgs(state) {
  return [
    process.env.CONTEXTWEAVE_A2M_PAY_COMMAND || DEFAULT_PAY_COMMAND,
    "--session-id",
    state.sessionId,
    "--file",
    state.billFile,
    "--resource-url",
    state.resourceUrl,
    "--intent-summary",
    state.intentSummary,
    ...buildResourceRequestArgs(state),
  ];
}

function buildResourceRequestArgs(state) {
  const args = ["--method", state.request.method, "--data", state.request.body];
  for (const [key, value] of Object.entries(state.request.headers || {})) {
    args.push("--header", `${key}:${value}`);
  }
  return args;
}

export function buildQueryArgs(state, tradeNo = null, outShakeNo = null) {
  const args = [process.env.CONTEXTWEAVE_A2M_QUERY_COMMAND || DEFAULT_QUERY_COMMAND];
  if (outShakeNo && validOutShakeNo(outShakeNo)) {
    args.push("--out-shake-no", outShakeNo);
  } else if (tradeNo) {
    args.push("--trade-no", tradeNo, "--resource-url", state.resourceUrl);
  } else {
    throw new PaidFlowError("PAYMENT_SESSION_EXPIRED", "缺少可用于查询的订单号或交易号");
  }
  if (state.resourceUrl) {
    if (!args.includes("--resource-url")) args.push("--resource-url", state.resourceUrl);
    args.push(...buildResourceRequestArgs(state));
  }
  return args;
}

export function buildAckArgs(state, tradeNo) {
  return [
    process.env.CONTEXTWEAVE_A2M_ACK_COMMAND || DEFAULT_ACK_COMMAND,
    "--trade-no",
    tradeNo,
  ];
}

async function readRequestSnapshot(requestFile) {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(requestFile, "utf8"));
  } catch (error) {
    throw new PaidFlowError("PAYMENT_REQUEST_NOT_SAVED", "未保存触发 402 的原始 POST 请求");
  }
  const url = validateResourceUrl(snapshot.url);
  if (snapshot.method !== "POST" || typeof snapshot.body !== "string") {
    throw new PaidFlowError("INVALID_PAYMENT_REQUEST", "付费资源请求必须是已保存的 POST 请求");
  }
  const allowedHeaders = {};
  for (const key of ["Content-Type", "X-Request-ID", "X-Skill-Version"]) {
    const value = snapshot.headers && snapshot.headers[key];
    if (typeof value === "string" && value.trim()) allowedHeaders[key] = value.trim();
  }
  if (!allowedHeaders["X-Request-ID"] || allowedHeaders["Content-Type"] !== "application/json") {
    throw new PaidFlowError("INVALID_PAYMENT_REQUEST", "原始付费请求缺少稳定请求 ID 或 JSON 类型");
  }
  return { url, method: "POST", body: snapshot.body, headers: allowedHeaders };
}

async function finalizeResult(stateDir, state, generationResult, tradeNo) {
  const persisted = await persistGenerationResult(generationResult, state);
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  if (tradeNo) {
    state.tradeReceipt = createHash("sha256").update(tradeNo).digest("hex").slice(0, 16);
  }
  delete state.tradeNo;
  delete state.outShakeNo;
  delete state.paymentExitCode;
  state.result = persisted;
  await saveState(stateDir, state);
  try { await unlink(state.billFile); } catch (error) {}
  try { await unlink(state.requestFile); } catch (error) {}
  outputJson({ status: "ok", session_id: persisted.session_id || state.sessionId, result: persisted });
}

async function probe(rawArgs) {
  const args = parseArgs(rawArgs);
  const stateKey = randomUUID();
  const paymentSessionId = currentPaymentSessionId();
  const stateDir = ensureWithinWorkspace(
    option(args, "--state_dir", "--state-dir") || path.join(".cw_skill", "payments", stateKey)
  );
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  try { await chmod(stateDir, 0o700); } catch (error) {}

  const billFile = path.join(stateDir, BILL_FILE);
  const requestFile = path.join(stateDir, REQUEST_FILE);
  const resourceUrl = validateResourceUrl(
    option(args, "--resource_url", "--resource-url") || DEFAULT_RESOURCE_URL
  );
  const generateArgs = forwardedGenerateArgs(rawArgs);
  const env = {
    ...process.env,
    CONTEXTWEAVE_A2M_BILL_FILE: billFile,
    CONTEXTWEAVE_A2M_REQUEST_FILE: requestFile,
    CW_API_BASE_URL: new URL(resourceUrl).origin,
    CW_RUN_ENDPOINT: new URL(resourceUrl).pathname,
  };
  const generation = await runChild(process.execPath, [GENERATE_SCRIPT, ...generateArgs], { env });
  const generationResult = parseJsonOutput(generation.stdout);

  if (generation.exitCode === 0 || generationResult?.status === "ok") {
    throw new PaidFlowError(
      "PAYMENT_BYPASS_DETECTED",
      "付费资源在未授权支付时直接返回了结果",
      "停止发布并确认服务端已在 /a2m/run 前启用 A2M 402 验证"
    );
  }
  if (generationResult?.error?.code !== "A2M_PAYMENT_REQUIRED") {
    throw new PaidFlowError(
      generationResult?.error?.code || "PAYMENT_PROBE_FAILED",
      generationResult?.error?.message || generation.stderr.trim() || "未能取得 A2M 账单",
      generationResult?.error?.recovery_hint || "检查 ContextWeave 服务状态后重试"
    );
  }

  let encodedBill;
  try {
    encodedBill = await readFile(billFile, "utf8");
  } catch (error) {
    throw new PaidFlowError(
      "PAYMENT_BILL_NOT_SAVED",
      "服务返回了 A2M 402，但未保存 Payment-Needed",
      "检查 CONTEXTWEAVE_A2M_BILL_FILE 与工作区写入权限"
    );
  }
  const validated = validatePaymentNeeded(encodedBill, resourceUrl);
  const request = await readRequestSnapshot(requestFile);
  if (request.url !== validated.resolvedResourceUrl) {
    throw new PaidFlowError(
      "PAYMENT_RESOURCE_MISMATCH",
      "402 账单资源与触发账单的原始 POST 请求不一致"
    );
  }
  const state = {
    schemaVersion: 1,
    status: "payment_required",
    sessionId: paymentSessionId,
    billFile,
    requestFile,
    resourceUrl: validated.resolvedResourceUrl,
    request,
    intentSummary: minimalIntentSummary(option(args, "--intent_summary", "--intent-summary")),
    billSummary: validated.summary,
    outputName: getForwardedArg(generateArgs, "--output_name", "-n") || "contextweave_paid",
    outputDir: getForwardedArg(generateArgs, "--output_dir", "-o") || process.cwd(),
    createdAt: new Date().toISOString(),
  };
  await saveState(stateDir, state);

  outputJson({
    status: "payment_required",
    code: "PAYMENT_CONFIRMATION_REQUIRED",
    session_id: state.sessionId,
    payment: validated.summary,
    state_dir: stateDir,
    next_action: "向用户展示本次金额和商品名称；取得明确确认后运行 pay --confirmed true",
  });
}

async function pay(rawArgs) {
  const args = parseArgs(rawArgs);
  const stateDirRaw = option(args, "--state_dir", "--state-dir");
  if (!stateDirRaw) {
    throw new PaidFlowError("MISSING_PAYMENT_STATE", "pay 必须提供 --state_dir");
  }
  if (option(args, "--confirmed") !== "true") {
    throw new PaidFlowError(
      "PAYMENT_CONFIRMATION_REQUIRED",
      "发起收银前必须取得用户对本次金额的明确确认",
      "确认后使用 --confirmed true；不得把安装或绘图请求视为支付确认"
    );
  }

  const stateDir = ensureWithinWorkspace(stateDirRaw);
  const state = await readState(stateDir);
  if (state.status === "completed") {
    outputJson({ status: "ok", already_completed: true });
    return;
  }
  if (state.status !== "payment_required") {
    throw new PaidFlowError(
      "PAYMENT_STATUS_UNCERTAIN",
      "支付已经发起或状态不明确，禁止再次创建付款",
      "运行 complete 查询现有会话；不要重复运行 pay"
    );
  }
  if (Date.parse(state.billSummary.pay_before) <= Date.now()) {
    throw new PaidFlowError("PAYMENT_BILL_EXPIRED", "账单已过期，请重新执行 probe");
  }

  state.status = "payment_pending";
  state.paymentStartedAt = new Date().toISOString();
  await saveState(stateDir, state);

  let payment;
  try {
    const invocation = await resolveAlipayBotInvocation(buildBuyerPayArgs(state));
    payment = await runChild(invocation.command, invocation.args, { stream: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      state.status = "payment_required";
      delete state.paymentStartedAt;
      await saveState(stateDir, state);
      throw new PaidFlowError(
        "ALIPAY_BOT_NOT_INSTALLED",
        "未找到支付宝官方 alipay-bot 支付组件",
        "请先按官方指南安装 alipay-payment-skill；安装属于软件变更，应由用户确认后执行"
      );
    }
    throw error;
  }

  const parsed = parseJsonOutput(payment.stdout);
  const tradeNo = findValueByKeys(parsed, ["trade_no", "tradeNo"])
    || findLabeledValue(payment.stdout, ["交易号"]);
  const outShakeNoCandidate = findValueByKeys(parsed, ["out_shake_no", "outShakeNo"])
    || findLabeledValue(payment.stdout, ["订单号", "查询单号"]);
  const outShakeNo = validOutShakeNo(outShakeNoCandidate) ? outShakeNoCandidate : null;
  if (tradeNo) state.tradeNo = tradeNo;
  if (outShakeNo) state.outShakeNo = outShakeNo;
  state.paymentCommandFinishedAt = new Date().toISOString();
  state.paymentExitCode = payment.exitCode;
  await saveState(stateDir, state);

  if (payment.exitCode !== 0) {
    throw new PaidFlowError(
      "PAYMENT_STATUS_UNCERTAIN",
      "收银组件未明确完成；可能已创建交易，禁止自动重试付款",
      "运行 complete 查询现有会话；若仍无法确认，交由用户在支付宝交易记录核对",
      { state_dir: stateDir }
    );
  }

  const generationResult = findGenerationResult(parsed);
  if (generationResult) {
    await finalizeResult(stateDir, state, generationResult, tradeNo);
    return;
  }

  outputJson({
    status: "payment_pending",
    session_id: state.sessionId,
    state_dir: stateDir,
    next_action: "用户完成支付宝授权后运行 complete；不要再次运行 pay",
  });
}

async function complete(rawArgs) {
  const args = parseArgs(rawArgs);
  const stateDirRaw = option(args, "--state_dir", "--state-dir");
  if (!stateDirRaw) {
    throw new PaidFlowError("MISSING_PAYMENT_STATE", "complete 必须提供 --state_dir");
  }
  const stateDir = ensureWithinWorkspace(stateDirRaw);
  const state = await readState(stateDir);
  if (state.status === "completed") {
    outputJson({ status: "ok", already_completed: true, result: state.result || null });
    return;
  }
  if (!['payment_pending', 'fulfillment_pending'].includes(state.status)) {
    throw new PaidFlowError(
      "PAYMENT_NOT_STARTED",
      "当前会话尚未发起支付",
      "先展示账单并取得用户确认，再运行 pay"
    );
  }

  const suppliedTradeNo = option(args, "--trade_no", "--trade-no");
  const suppliedOutShakeNo = option(args, "--out_shake_no", "--out-shake-no");
  const tradeNo = suppliedTradeNo || state.tradeNo || null;
  const outShakeNo = suppliedOutShakeNo || state.outShakeNo || null;
  const invocation = await resolveAlipayBotInvocation(buildQueryArgs(state, tradeNo, outShakeNo));
  const query = await runChild(invocation.command, invocation.args);
  if (query.exitCode !== 0) {
    throw new PaidFlowError(
      "PAYMENT_NOT_COMPLETED",
      "尚未取得可交付的支付结果",
      "保留当前会话并稍后再次运行 complete；不要重新发起付款"
    );
  }

  const queryJson = parseJsonOutput(query.stdout);
  const resolvedTradeNo = tradeNo
    || findValueByKeys(queryJson, ["trade_no", "tradeNo"])
    || findLabeledValue(query.stdout, ["交易号"]);
  const generationResult = findGenerationResult(queryJson);
  if (!generationResult) {
    throw new PaidFlowError(
      "PAID_RESOURCE_MISSING",
      "支付查询未返回可识别的 ContextWeave 资源",
      "保留当前会话并检查付费资源接口输出，不要重新付款"
    );
  }

  await finalizeResult(stateDir, state, generationResult, resolvedTradeNo);
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const rawArgs = argv.slice(1);
  if (!['probe', 'pay', 'complete'].includes(command)) {
    throw new PaidFlowError(
      "INVALID_PAYMENT_COMMAND",
      "用法: contextweave_paid.mjs <probe|pay|complete> [参数]"
    );
  }
  if (command === "probe") return probe(rawArgs);
  if (command === "pay") return pay(rawArgs);
  return complete(rawArgs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    outputJson(toErrorResult(error));
    process.exitCode = 1;
  });
}
