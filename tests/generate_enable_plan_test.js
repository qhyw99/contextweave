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
  assert.match(skill, /^version: 1\.2\.11$/m);
  assert.match(skill, /分层（layered）或网格（grid）容器骨架/);
  assert.match(skill, /中央或单侧主链配固定的左右\/平行说明栏[\s\S]*logic \+ flow \+ --enable_plan/);
  assert.match(skill, /紧凑、平衡或多行的阶段网格[\s\S]*logic \+ flow \+ --enable_plan/);
  assert.match(skill, /普通单轴纵向\/横向流程不传 `--enable_plan`/);
  assert.match(skill, /节点数、阶段数、文本长度或内容复杂度本身不得触发 `--enable_plan`/);
  assert.match(skill, /generate_contextweave\.cjs[^\n]*--morphology container[^\n]*--enable_plan/);
  assert.match(skill, /generate_contextweave\.cjs[^\n]*--morphology flow[^\n]*--enable_plan/);

  console.log("generate_enable_plan_test passed");
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
