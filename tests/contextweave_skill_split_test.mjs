import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const freeRoot = path.join(root, "skills", "interactive-architecture-diagram");
const paidRoot = path.join(root, "skills", "interactive-architecture-diagram-pay");

function markdownSection(content, startHeading, endHeading) {
  const start = content.indexOf(startHeading);
  const end = content.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, `missing section ${startHeading}`);
  assert.notEqual(end, -1, `missing section boundary ${endHeading}`);
  return content.slice(start, end).replace(/\r\n/g, "\n").trim();
}

const synchronizedFiles = [
  "references/multi-view-scenarios.md",
  "scripts/export_contextweave_code.cjs",
  "scripts/export_session_asset.cjs",
  "scripts/generate_contextweave.cjs",
  "scripts/import_contextweave_code.cjs",
  "scripts/recompile_contextweave.cjs",
  "scripts/submit_feedback.cjs",
];

for (const relativePath of synchronizedFiles) {
  const freeContent = fs.readFileSync(path.join(freeRoot, relativePath), "utf8");
  const paidContent = fs.readFileSync(path.join(paidRoot, relativePath), "utf8");
  assert.equal(paidContent, freeContent, `${relativePath} must remain synchronized`);
}

const freeFiles = [
  "SKILL.md",
  "_meta.json",
  "references/advanced-operations.md",
  "references/error-recovery.md",
  "references/external-data-consent.md",
  "scripts/cw_client.cjs",
];
const paymentMarkers = /contextweave_paid|alipay-bot|Payment-Needed|A2M|支付宝付费/;
for (const relativePath of freeFiles) {
  const content = fs.readFileSync(path.join(freeRoot, relativePath), "utf8");
  assert.doesNotMatch(content, paymentMarkers, `${relativePath} must stay payment-free`);
}

assert.equal(fs.existsSync(path.join(freeRoot, "scripts", "contextweave_paid.mjs")), false);
assert.equal(fs.existsSync(path.join(freeRoot, "references", "payment-flow.md")), false);
assert.equal(fs.existsSync(path.join(paidRoot, "scripts", "contextweave_paid.mjs")), true);
assert.equal(fs.existsSync(path.join(paidRoot, "references", "payment-flow.md")), true);
assert.equal(fs.existsSync(path.join(paidRoot, "scripts", "request_quota_code.cjs")), false);
assert.equal(fs.existsSync(path.join(paidRoot, "scripts", "redeem_quota_code.cjs")), false);
const paidSkill = fs.readFileSync(path.join(paidRoot, "SKILL.md"), "utf8");
const freeSkill = fs.readFileSync(path.join(freeRoot, "SKILL.md"), "utf8");
assert.match(paidSkill, /^name: interactive-architecture-diagram-pay$/m);
assert.match(paidSkill, /^slug: contextweave-interactive-architecture-pay$/m);
assert.match(paidSkill, /^displayName: 架构图一键生成（支付宝付费版）$/m);
assert.match(paidSkill, /^version: 1\.0\.0$/m);
assert.match(paidSkill, /每次 AI 生成或 AI 修改固定收费 `0\.05 CNY`/);
assert.equal(
  markdownSection(paidSkill, "## 一、三条不变式", "## 二、普通单图"),
  markdownSection(freeSkill, "## 一、三条不变式", "## 二、普通单图"),
  "the core semantic drawing invariants must remain synchronized"
);
assert.equal(
  markdownSection(paidSkill, "## 三、核心参数", "## 五、按需读取"),
  markdownSection(freeSkill, "## 三、核心参数", "## 五、按需读取"),
  "the style, morphology, palette, and multi-view rules must remain synchronized"
);
assert.match(
  fs.readFileSync(path.join(paidRoot, "scripts", "edit_contextweave.cjs"), "utf8"),
  /endpoint === "\/a2m\/run"/
);
assert.match(
  fs.readFileSync(path.join(freeRoot, "scripts", "edit_contextweave.cjs"), "utf8"),
  /endpoint === "\/run"/
);

console.log("contextweave_skill_split_test passed");
