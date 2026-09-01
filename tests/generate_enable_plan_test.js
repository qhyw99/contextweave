const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const skillRoot = path.join(repoRoot, "skills", "interactive-architecture-diagram");
const { main } = require(path.join(skillRoot, "scripts", "generate_contextweave.cjs"));
const { CWClient } = require(path.join(skillRoot, "scripts", "cw_client.cjs"));

async function captureGenerationOptions(extraArgs) {
  let capturedOptions = null;

  class StubClient {
    async runGeneration(options) {
      capturedOptions = options;
      return { status: "ok", session_id: "enable-plan-test", choices: [] };
    }
  }

  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await main(["--user_request", "x".repeat(50), ...extraArgs], StubClient);
  } finally {
    process.stdout.write = originalWrite;
  }

  return capturedOptions;
}

async function captureBackendPayload(enablePlan) {
  const client = new CWClient();
  let capturedPayload = null;
  client.request = async (endpoint, payload) => {
    assert.strictEqual(endpoint, "/run");
    capturedPayload = payload;
    return { status: "ok", session_id: "enable-plan-test" };
  };
  await client.runGeneration({ userRequest: "test request", enablePlan });
  return capturedPayload;
}

async function mainTest() {
  assert.strictEqual((await captureGenerationOptions([])).enablePlan, false);
  assert.strictEqual((await captureGenerationOptions(["--enable_plan"])).enablePlan, true);
  assert.strictEqual((await captureGenerationOptions(["--enable_plan", "true"])).enablePlan, true);
  assert.strictEqual((await captureGenerationOptions(["--enable_plan", "false"])).enablePlan, false);

  const originalEnvironmentValue = process.env.CONTEXTWEAVE_ENABLE_PLAN;
  delete process.env.CONTEXTWEAVE_ENABLE_PLAN;
  try {
    assert.strictEqual((await captureBackendPayload(true)).enable_plan, true);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(await captureBackendPayload(false), "enable_plan"),
      false
    );
  } finally {
    if (originalEnvironmentValue === undefined) {
      delete process.env.CONTEXTWEAVE_ENABLE_PLAN;
    } else {
      process.env.CONTEXTWEAVE_ENABLE_PLAN = originalEnvironmentValue;
    }
  }

  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /^version: 1\.2\.12$/m);
  assert.match(skill, /明确选择 `layered`、`three_lane`、`stage_grid`/);
  assert.match(skill, /中央主链配固定左右侧轨/);
  assert.match(skill, /--outline_file/);
  assert.match(skill, /普通容器分组、普通单轴流程/);
  assert.match(skill, /节点多、文本长或内容复杂/);

  const layoutPlanning = fs.readFileSync(
    path.join(skillRoot, "references", "layout-planning.md"),
    "utf8"
  );
  assert.match(layoutPlanning, /clients → gateway → application → service → infra/);
  assert.match(layoutPlanning, /Nacos\/Redis[^\n]*不扩散成多条边/);

  console.log("generate_enable_plan_test passed");
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
