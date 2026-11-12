#!/usr/bin/env node
const fs = require("node:fs");
const { CWClient, printJson } = require("./cw_client.cjs");
const { orchestrateViewGroup, planHash } = require("./view_group.cjs");
const { createRemoteBudgetAdapter } = require("./budget_client.cjs");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith("-") ? next : "true";
    args[token] = value;
    if (value !== "true") index += 1;
  }
  return args;
}

function compact(result) {
  return {
    status: result.status,
    group_id: result.group_id,
    plan_sha256: result.plan_sha256,
    coverage: result.coverage,
    ...(result.budget ? { budget: result.budget } : {}),
    usage: result.usage,
    views: (result.views || []).map(view => ({
      view_id: view.view_id,
      name: view.name,
      status: view.status,
      quality: view.quality,
      revision: view.revision,
      session_id: view.session_id,
      ...(view.continuation_session_id ? { continuation_session_id: view.continuation_session_id } : {}),
      source_sha256: view.source_sha256,
      annotations: view.annotations,
      artifacts: view.artifacts,
      error: view.error,
    })),
    manifest_path: result.manifest_path,
    index_file: result.index_file,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function main(argv = process.argv.slice(2), Client = CWClient, orchestrate = orchestrateViewGroup, budgetFactory = createRemoteBudgetAdapter) {
  const args = parseArgs(argv);
  const planFile = args["--plan_file"];
  const outputDir = args["--output_dir"];
  const resume = args["--resume"] === "true";
  if (!planFile || !outputDir) {
    const result = { status: "error", error: { code: "MISSING_VIEW_GROUP_OPTIONS", message: "必须提供 --plan_file 和 --output_dir；恢复时另加 --resume" } };
    printJson(result);
    return result;
  }
  const groupTokenLimit = args["--group_token_limit"] === undefined ? null : Number(args["--group_token_limit"]);
  const attemptTokenLimit = args["--attempt_token_limit"] === undefined ? 192000 : Number(args["--attempt_token_limit"]);
  if (!resume && (!Number.isInteger(groupTokenLimit) || groupTokenLimit <= 0)) {
    const result = { status: "error", error: { code: "GROUP_TOKEN_LIMIT_REQUIRED", message: "新建视图组必须提供正整数 --group_token_limit；恢复时由服务端账本保留原上限" } };
    printJson(result);
    return result;
  }
  if (resume && groupTokenLimit !== null) {
    const result = { status: "error", error: { code: "GROUP_LIMIT_OVERRIDE_FORBIDDEN", message: "恢复不得重设组上限；继续使用原账本" } };
    printJson(result);
    return result;
  }
  if (!Number.isInteger(attemptTokenLimit) || attemptTokenLimit <= 0) {
    const result = { status: "error", error: { code: "ATTEMPT_TOKEN_LIMIT_INVALID", message: "--attempt_token_limit 必须是正整数" } };
    printJson(result);
    return result;
  }
  const client = new Client();
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const groupId = `view-group-${planHash(plan).slice(0, 16)}`;
  const budget = budgetFactory(client, { groupId, attemptTokenLimit, groupTokenLimit });
  const edits = args["--edits_file"] ? JSON.parse(fs.readFileSync(args["--edits_file"], "utf8")) : null;
  const result = compact(await orchestrate(client, { planFile, outputDir, resume, budget, edits }));
  printJson(result);
  return result;
}

module.exports = { main, compact };

if (require.main === module) {
  main().then(result => {
    if (result.status !== "accepted") process.exitCode = 1;
  }).catch(error => {
    printJson({ status: "error", error: { code: "VIEW_GROUP_CLI_FAILED", message: String(error.message || error) } });
    process.exitCode = 1;
  });
}
