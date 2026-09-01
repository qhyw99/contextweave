const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const skillRoot = path.join(repoRoot, "skills", "interactive-architecture-diagram");
const { main: generateMain } = require(path.join(skillRoot, "scripts", "generate_contextweave.cjs"));
const { CWClient, _internals } = require(path.join(skillRoot, "scripts", "cw_client.cjs"));

const requestText = "application 通过 OpenFeign 调用 service；只展示用户明确声明的跨层关系。";

function validOutline() {
  return {
    outline_intent_version: 1,
    focus: "展示应用层与服务层，并保留明确调用关系",
    layout_policy: { preset: "layered", grid_mode: "guided" },
    edge_policy: {
      mode: "sparse_semantic",
      focus: ["explicit_dependencies"],
      preferred_range: [1, 3],
      inferred_scope: "local_only",
    },
    content: [
      {
        item_name: "application",
        label: "应用层",
        type: "grid",
        "grid-rows": "[1]",
        "grid-columns": "[1]",
        content_generation_prompt: "展示应用层",
      },
      {
        item_name: "service",
        label: "服务层",
        type: "grid",
        "grid-rows": "[2]",
        "grid-columns": "[1]",
        content_generation_prompt: "展示服务层",
      },
    ],
    global_relationships: [
      {
        from: "application",
        to: "service",
        label: "OpenFeign 调用",
        evidence_quote: "application 通过 OpenFeign 调用 service",
        kind: "explicit_dependency",
      },
    ],
  };
}

function expectInvalid(mutator, pattern) {
  const outline = validOutline();
  mutator(outline);
  assert.throws(() => _internals.validateOutlineIntent(outline, requestText), pattern);
}

async function testCliPassesOutlineFile(outlinePath) {
  let captured;
  class StubClient {
    async runGeneration(options) {
      captured = options;
      return {
        status: "ok",
        session_id: "outline-cli-test",
        svg_url: "WAITING_FOR_EXPERT_PROCESSING",
      };
    }
  }
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await generateMain([
      "--user_request",
      "x".repeat(50),
      "--outline_file",
      outlinePath,
    ], StubClient);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.strictEqual(captured.outlineFile, outlinePath);
}

async function mainTest() {
  _internals.validateOutlineIntent(validOutline(), requestText);

  expectInvalid((outline) => { outline.unexpected = true; }, /unknown field/);
  expectInvalid((outline) => { outline.layout_policy.unexpected = true; }, /unknown field/);
  expectInvalid((outline) => { outline.outline_intent_version = 2; }, /unsupported outline_intent_version/);
  expectInvalid((outline) => { outline.content[0].item_name = "bad.id"; }, /safe ASCII identifier/);
  expectInvalid((outline) => { outline.content[1].item_name = "application"; }, /must be unique/);
  expectInvalid((outline) => { outline.content[1]["grid-rows"] = "[1]"; }, /must not overlap/);
  expectInvalid((outline) => { outline.content[0]["grid-columns"] = "[2,1]"; }, /ascending order/);
  expectInvalid((outline) => { outline.global_relationships[0].to = "missing"; }, /top-level content items/);
  expectInvalid((outline) => { outline.global_relationships[0].evidence_quote = "不存在的原文"; }, /exact excerpt/);

  const threeLane = validOutline();
  threeLane.layout_policy = { preset: "three_lane", grid_mode: "locked" };
  threeLane.content = [1, 2, 3].map((column) => ({
    item_name: `lane_${column}`,
    label: `栏 ${column}`,
    type: "grid",
    "grid-rows": "[1,2]",
    "grid-columns": `[${column}]`,
  }));
  threeLane.global_relationships = [];
  _internals.validateOutlineIntent(threeLane, requestText);

  const tempDir = fs.mkdtempSync(path.join(repoRoot, ".outline-test-"));
  try {
    const outlinePath = path.join(tempDir, "outline.json");
    fs.writeFileSync(outlinePath, JSON.stringify(validOutline()), "utf8");
    await testCliPassesOutlineFile(outlinePath);

    const client = new CWClient();
    let capturedPayload;
    client.request = async (endpoint, payload) => {
      assert.strictEqual(endpoint, "/run");
      capturedPayload = payload;
      return { status: "ok", session_id: "outline-payload-test" };
    };
    const result = await client.runGeneration({ userRequest: requestText, outlineFile: outlinePath });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(capturedPayload.outline_intent, validOutline());
    assert.strictEqual(capturedPayload.outline_intent_version, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedPayload, "outline_file"), false);
    assert.strictEqual(JSON.stringify(capturedPayload).includes(outlinePath), false);
    assert.strictEqual(capturedPayload.user_request, requestText);

    const relativeResult = await client.runGeneration({ userRequest: requestText, outlineFile: "outline.json" });
    assert.strictEqual(relativeResult.error.code, "OUTLINE_FILE_NOT_ABSOLUTE");
    const directoryResult = await client.runGeneration({ userRequest: requestText, outlineFile: tempDir });
    assert.strictEqual(directoryResult.error.code, "OUTLINE_FILE_NOT_REGULAR");

    const largePath = path.join(tempDir, "large.json");
    fs.writeFileSync(largePath, "x".repeat(_internals.MAX_OUTLINE_FILE_BYTES + 1), "utf8");
    const largeResult = await client.runGeneration({ userRequest: requestText, outlineFile: largePath });
    assert.strictEqual(largeResult.error.code, "OUTLINE_FILE_TOO_LARGE");

    const invalidPath = path.join(tempDir, "invalid.json");
    const invalid = validOutline();
    invalid.global_relationships[0].evidence_quote = "不在请求中的证据";
    fs.writeFileSync(invalidPath, JSON.stringify(invalid), "utf8");
    const invalidResult = await client.runGeneration({ userRequest: requestText, outlineFile: invalidPath });
    assert.strictEqual(invalidResult.error.code, "INVALID_OUTLINE_INTENT");

    const outsidePath = path.join(os.tmpdir(), `contextweave-outline-${process.pid}.json`);
    fs.writeFileSync(outsidePath, JSON.stringify(validOutline()), "utf8");
    try {
      const outsideResult = await client.runGeneration({ userRequest: requestText, outlineFile: outsidePath });
      assert.strictEqual(outsideResult.error.code, "OUTLINE_PATH_OUTSIDE_WORKSPACE");

      const linkPath = path.join(tempDir, "outside-link.json");
      try {
        fs.symlinkSync(outsidePath, linkPath, "file");
        const linkResult = await client.runGeneration({ userRequest: requestText, outlineFile: linkPath });
        assert.strictEqual(linkResult.error.code, "OUTLINE_PATH_OUTSIDE_WORKSPACE");
      } catch (error) {
        if (!["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) throw error;
      }
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const client = new CWClient();
  for (const statusCode of [400, 409, 422]) {
    const response = client.handleResponse({
      statusCode,
      statusMessage: "Rejected",
      body: JSON.stringify({
        detail: {
          code: "OUTLINE_CONTRACT_ERROR",
          message: "invalid relationship evidence",
          location: ["body", "outline_intent", "global_relationships", 0],
          reason: "evidence_mismatch",
          recovery_hint: "fix the quoted evidence",
        },
      }),
    });
    assert.strictEqual(response.error.code, "OUTLINE_CONTRACT_ERROR");
    assert.strictEqual(response.error.message, "invalid relationship evidence");
    assert.strictEqual(response.error.http_status, statusCode);
    assert.deepStrictEqual(response.error.location, ["body", "outline_intent", "global_relationships", 0]);
    assert.strictEqual(response.error.reason, "evidence_mismatch");
    assert.strictEqual(response.error.recovery_hint, "fix the quoted evidence");
  }

  const validationDetail = [{
    type: "extra_forbidden",
    loc: ["body", "outline_intent", "unexpected"],
    msg: "Extra inputs are not permitted",
  }];
  const validationResponse = client.handleResponse({
    statusCode: 422,
    statusMessage: "Unprocessable Entity",
    body: JSON.stringify({ detail: validationDetail }),
  });
  assert.strictEqual(validationResponse.error.code, "VALIDATION_ERROR");
  assert.strictEqual(validationResponse.error.http_status, 422);
  assert.deepStrictEqual(validationResponse.error.detail, validationDetail);
  assert.notStrictEqual(validationResponse.error.code, "API_ERROR");

  console.log("outline_intent_client_test passed");
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
