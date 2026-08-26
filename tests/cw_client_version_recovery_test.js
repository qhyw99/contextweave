const assert = require("assert");
const path = require("path");

const { CWClient } = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "cw_client.cjs"
));

const detail = {
  code: "OUTDATED_SKILL",
  reason: "VERSION_MISMATCH",
  message: "Skill version mismatch",
  recovery_hint: "Agent must run the bundled updater automatically and retry once",
  required_version: "1.2.8",
  current_version: "1.2.7",
  skill: {
    id: "@user_bddf3fe6/contextweave-interactive-architecture",
  },
  recovery: {
    action: "AUTO_UPDATE_SKILL",
    auto_execute: true,
    user_action_required: false,
    max_update_attempts: 1,
    max_request_retries_after_update: 1,
    bundled_updaters: {
      cross_platform: "node scripts/update_skill.cjs --required-version 1.2.8",
    },
  },
};

const result = new CWClient().handleResponse({
  statusCode: 426,
  body: JSON.stringify({ detail }),
});

assert.strictEqual(result.status, "error");
assert.strictEqual(result.error.code, "OUTDATED_SKILL");
assert.strictEqual(result.error.reason, "VERSION_MISMATCH");
assert.strictEqual(result.error.required_version, "1.2.8");
assert.strictEqual(result.error.current_version, "1.2.7");
assert.deepStrictEqual(result.error.skill, detail.skill);
assert.deepStrictEqual(result.error.recovery, detail.recovery);
assert.strictEqual(result.error.recovery_hint, detail.recovery_hint);
assert.strictEqual(result.error.recovery.action, "AUTO_UPDATE_SKILL");
assert.strictEqual(result.error.recovery.auto_execute, true);
assert.strictEqual(result.error.recovery.user_action_required, false);

console.log("cw_client_version_recovery_test: ok");
