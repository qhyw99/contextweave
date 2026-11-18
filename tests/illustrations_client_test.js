const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const variants = ['interactive-architecture-diagram', 'interactive-architecture-diagram-pay',
  'interactive-architecture-diagram-pptx', 'interactive-architecture-diagram-workbuddy', 'interactive-infographic'];
const invalid = { status: 'error', error: { code: 'INVALID_ILLUSTRATIONS', message: '--enable_illustrations 必须为 true 或 false' } };

function checkPaidProbe() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'illustrations-probe-'));
  try {
    const root = path.resolve(__dirname, '../skills/interactive-architecture-diagram-pay/scripts');
    const mock = path.join(folder, 'local.cjs');
    fs.writeFileSync(mock, `const { CWClient } = require(${JSON.stringify(path.join(root, 'cw_client.cjs'))});
      CWClient.prototype.request = async function(endpoint, payload) {
        return this.error('LOCAL_WIRE_PROBE', JSON.stringify({ value: payload.enable_illustrations }));
      };`);
    const call = args => spawnSync(process.execPath, [path.join(root, 'contextweave_paid.mjs'), 'probe', '--state_dir', 'unused', '--user_request', 'diagram '.repeat(10), '--use_default_palette', 'true', ...args], {
      cwd: folder, encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: 'unit-test', NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(mock.replace(/\\/g, '/'))}` },
    });
    const rejected = call(['--enable_illustrations', 'no']);
    assert.equal(rejected.status, 1);
    assert.deepEqual(JSON.parse(rejected.stdout), invalid);
    assert.equal(fs.existsSync(path.join(folder, 'unused')), false);
    for (const flag of [null, true, false]) {
      const local = call(flag === null ? [] : ['--enable_illustrations', String(flag)]);
      assert.equal(local.status, 1, local.stderr);
      const { error } = JSON.parse(local.stdout);
      assert.equal(error.code, 'LOCAL_WIRE_PROBE');
      assert.deepEqual(JSON.parse(error.message), flag === null ? {} : { value: flag });
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

(async () => {
  for (const variant of variants) {
    const root = path.resolve(__dirname, '../skills', variant, 'scripts');
    const { CWClient } = require(path.join(root, 'cw_client.cjs'));
    for (const action of ['generate', 'edit']) {
      const script = path.join(root, `${action}_contextweave.cjs`);
      const args = action === 'edit' ? ['--session_id', 'previous', '--input_file', __filename]
        : ['--user_request', 'diagram '.repeat(10), '--use_default_palette', 'true'];
      for (const flag of [null, true, false]) {
        let options, body;
        class LocalClient extends CWClient {
          async runGeneration(value) { options = value; return super.runGeneration(value); }
          async request(endpoint, payload) {
            assert.match(endpoint, /\/run(?:\?|$)/);
            body = payload;
            return { status: 'ok', session_id: 'example', choices: [] };
          }
        }
        const write = process.stdout.write;
        process.stdout.write = () => true;
        try {
          await require(script).main([...args, ...(flag === null ? [] : ['--enable_illustrations', String(flag)])], LocalClient);
        } finally { process.stdout.write = write; }
        assert.equal(options.enableIllustrations, flag);
        assert.equal(Object.hasOwn(body, 'enable_illustrations'), flag !== null);
        if (flag !== null) assert.equal(body.enable_illustrations, flag);
        if (action === 'edit') assert.equal(body.session_id, 'previous');
      }
      for (const values of [['yes'], [], ['FALSE']]) {
        const result = spawnSync(process.execPath, [script, ...args, '--enable_illustrations', ...values], { encoding: 'utf8' });
        assert.equal(result.status, 1, `${variant}/${action}: ${result.stderr}`);
        assert.deepEqual(JSON.parse(result.stdout), invalid);
      }
    }
  }
  checkPaidProbe();
  console.log('illustrations client tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
