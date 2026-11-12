const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const variants = [
  'interactive-architecture-diagram',
  'interactive-architecture-diagram-pay',
  'interactive-architecture-diagram-pptx',
  'interactive-architecture-diagram-workbuddy',
];

async function capture(script, args, response) {
  let options;
  class StubClient {
    async request() {
      throw new Error('runGeneration stub must own transport');
    }
    async runGeneration(value) {
      options = value;
      return response;
    }
  }
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await script.main(args, StubClient);
  } finally {
    process.stdout.write = originalWrite;
  }
  return options;
}

async function main() {
  const fixtureDir = fs.mkdtempSync(path.join(repoRoot, 'tests', '.source-scripts-'));
  const previousCwd = process.cwd();
  try {
    process.chdir(fixtureDir);
    const sourceFile = path.join(fixtureDir, 'diagram.cw');
    fs.writeFileSync(sourceFile, 'root: 源\n', 'utf8');

    for (const variant of variants) {
      const scripts = path.join(repoRoot, 'skills', variant, 'scripts');
      const generate = require(path.join(scripts, 'generate_contextweave.cjs'));
      const edit = require(path.join(scripts, 'edit_contextweave.cjs'));
      const common = ['--cw_source_file', sourceFile, '--user_request', '保留源并修改'];
      const generated = await capture(generate, common, { status: 'ok', session_id: 'synthetic', choices: [] });
      assert.equal(generated.cwSourceFile, sourceFile, `${variant}: generate must forward cw_source_file`);
      assert.equal(generated.userRequest, '保留源并修改');

      const edited = await capture(edit, ['--session_id', 'synthetic', ...common],
        { status: 'ok', session_id: 'synthetic', svg_content: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      assert.equal(edited.cwSourceFile, sourceFile, `${variant}: edit must forward cw_source_file`);
      assert.equal(edited.userRequest, '保留源并修改');

      const { validateAuthoringArgs } = require(path.join(scripts, 'authoring.cjs'));
      const conflict = validateAuthoringArgs({ '--authoring_file': 'model.json', '--cw_source_file': sourceFile });
      assert.equal(conflict?.error?.code, 'AUTHORING_OPTION_CONFLICT', `${variant}: authoring/source conflict must be explicit`);
    }
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  console.log('Official generate/edit scripts forward exact CW source options for all architecture variants.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
