const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const skillRoot = path.join(repoRoot, "skills", "interactive-architecture-diagram");
const scriptsDir = path.join(skillRoot, "scripts");
const coreUpdater = path.join(scriptsDir, "update_skill.cjs");
const packageId = "@user_bddf3fe6/contextweave-interactive-architecture";

function runDryRun(extraArgs = []) {
  return spawnSync(process.execPath, [coreUpdater, "--dry-run", ...extraArgs], {
    encoding: "utf8",
    windowsHide: true,
  });
}

const expectedTarget = path.join(
  repoRoot,
  "skills",
  "@user_bddf3fe6",
  "contextweave-interactive-architecture"
);
const targetExistedBefore = fs.existsSync(expectedTarget);
const dryRun = runDryRun();

assert.strictEqual(dryRun.status, 0, dryRun.stderr);
const payload = JSON.parse(dryRun.stdout.trim());
assert.strictEqual(payload.status, "ok");
assert.strictEqual(payload.dry_run, true);
assert.strictEqual(payload.package_id, packageId);
assert.strictEqual(path.resolve(payload.skill_root), skillRoot);
assert.strictEqual(path.resolve(payload.skills_dir), path.join(repoRoot, "skills"));
assert.strictEqual(path.resolve(payload.target_dir), expectedTarget);
assert.strictEqual(fs.existsSync(expectedTarget), targetExistedBefore, "dry-run must not install files");

const versionedDryRun = runDryRun(["--required-version", "1.2.8"]);
assert.strictEqual(versionedDryRun.status, 0, versionedDryRun.stderr);
assert.strictEqual(JSON.parse(versionedDryRun.stdout.trim()).required_version, "1.2.8");

const customRoot = path.join(os.tmpdir(), "contextweave-custom-agent-skills");
const customDryRun = runDryRun(["--skills-dir", customRoot]);
assert.strictEqual(customDryRun.status, 0, customDryRun.stderr);
const customPayload = JSON.parse(customDryRun.stdout.trim());
assert.strictEqual(path.resolve(customPayload.skills_dir), path.resolve(customRoot));
assert.strictEqual(
  path.resolve(customPayload.target_dir),
  path.join(path.resolve(customRoot), "@user_bddf3fe6", "contextweave-interactive-architecture")
);

const unsafeRoot = path.parse(repoRoot).root;
const unsafeDryRun = runDryRun(["--skills-dir", unsafeRoot]);
assert.notStrictEqual(unsafeDryRun.status, 0);
assert.match(unsafeDryRun.stderr, /Refusing to use a filesystem root/);

const layoutSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "contextweave-namespaced-layout-"));
try {
  const namespacedSkillRoot = path.join(
    layoutSandbox,
    "skills",
    "@user_bddf3fe6",
    "contextweave-interactive-architecture"
  );
  const namespacedScriptsDir = path.join(namespacedSkillRoot, "scripts");
  fs.mkdirSync(namespacedScriptsDir, { recursive: true });
  fs.copyFileSync(coreUpdater, path.join(namespacedScriptsDir, "update_skill.cjs"));
  fs.writeFileSync(
    path.join(namespacedSkillRoot, "SKILL.md"),
    "---\nname: interactive-architecture-diagram\nversion: 1.2.8\n---\n",
    "utf8"
  );

  const namespacedDryRun = spawnSync(
    process.execPath,
    [path.join(namespacedScriptsDir, "update_skill.cjs"), "--dry-run"],
    { encoding: "utf8", windowsHide: true }
  );
  assert.strictEqual(namespacedDryRun.status, 0, namespacedDryRun.stderr);
  const namespacedPayload = JSON.parse(namespacedDryRun.stdout.trim());
  assert.strictEqual(
    path.resolve(namespacedPayload.skills_dir),
    path.join(layoutSandbox, "skills")
  );
  assert.strictEqual(path.resolve(namespacedPayload.target_dir), namespacedSkillRoot);
} finally {
  fs.rmSync(layoutSandbox, { recursive: true, force: true });
}

const updateSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "contextweave-auto-update-"));
try {
  const sandboxSkillsDir = path.join(updateSandbox, "skills");
  const sandboxSkillRoot = path.join(
    sandboxSkillsDir,
    "@user_bddf3fe6",
    "contextweave-interactive-architecture"
  );
  const sandboxScriptsDir = path.join(sandboxSkillRoot, "scripts");
  const sandboxUpdater = path.join(sandboxScriptsDir, "update_skill.cjs");
  const fakeCli = path.join(updateSandbox, "fake-skillhub.cjs");
  const fakeLog = path.join(updateSandbox, "fake-skillhub-args.json");
  fs.mkdirSync(sandboxScriptsDir, { recursive: true });
  fs.copyFileSync(coreUpdater, sandboxUpdater);
  fs.writeFileSync(
    path.join(sandboxSkillRoot, "SKILL.md"),
    "---\nname: interactive-architecture-diagram\nversion: 1.2.7\n---\n",
    "utf8"
  );
  fs.writeFileSync(
    fakeCli,
    [
      'const fs = require("fs");',
      'const path = require("path");',
      'const args = process.argv.slice(2);',
      'if (args[0] !== "install") process.exit(2);',
      'const dirIndex = args.indexOf("--dir");',
      'const versionIndex = args.indexOf("--version");',
      'if (dirIndex < 0 || versionIndex < 0) process.exit(3);',
      'const requestedVersion = args[versionIndex + 1];',
      'const installedVersion = process.env.FAKE_SKILLHUB_VERSION || requestedVersion;',
      'const target = path.join(args[dirIndex + 1], "@user_bddf3fe6", "contextweave-interactive-architecture");',
      'fs.mkdirSync(target, { recursive: true });',
      'fs.writeFileSync(path.join(target, "SKILL.md"), `---\\nname: interactive-architecture-diagram\\nversion: ${installedVersion}\\n---\\n`, "utf8");',
      'fs.writeFileSync(process.env.FAKE_SKILLHUB_LOG, JSON.stringify(args), "utf8");',
    ].join("\n"),
    "utf8"
  );

  const updateEnvironment = {
    ...process.env,
    FAKE_SKILLHUB_LOG: fakeLog,
  };
  const automaticUpdate = spawnSync(
    process.execPath,
    [
      sandboxUpdater,
      "--required-version",
      "1.2.8",
      "--skillhub-cli",
      fakeCli,
    ],
    { encoding: "utf8", windowsHide: true, env: updateEnvironment }
  );
  assert.strictEqual(automaticUpdate.status, 0, automaticUpdate.stderr);
  assert.match(automaticUpdate.stdout, /Installed version: 1\.2\.8/);
  assert.match(
    fs.readFileSync(path.join(sandboxSkillRoot, "SKILL.md"), "utf8"),
    /^version: 1\.2\.8$/m
  );
  const installArgs = JSON.parse(fs.readFileSync(fakeLog, "utf8"));
  assert.deepStrictEqual(
    installArgs.slice(0, 2),
    ["install", packageId]
  );
  assert.ok(installArgs.includes("--force"));
  assert.deepStrictEqual(
    installArgs.slice(installArgs.indexOf("--version"), installArgs.indexOf("--version") + 2),
    ["--version", "1.2.8"]
  );

  const wrongVersionUpdate = spawnSync(
    process.execPath,
    [
      sandboxUpdater,
      "--required-version",
      "1.2.8",
      "--skillhub-cli",
      fakeCli,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...updateEnvironment, FAKE_SKILLHUB_VERSION: "1.2.7" },
    }
  );
  assert.notStrictEqual(wrongVersionUpdate.status, 0);
  assert.match(
    wrongVersionUpdate.stderr,
    /Installed version 1\.2\.7 does not match required version 1\.2\.8/
  );
} finally {
  fs.rmSync(updateSandbox, { recursive: true, force: true });
}

console.log("update_skill_scripts_test: ok");
