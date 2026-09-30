const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function test() {
  const originalCwd = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-receipt-'));
  process.chdir(temp);
  try {
    for (const variant of ['interactive-architecture-diagram', 'interactive-architecture-diagram-pptx', 'interactive-architecture-diagram-workbuddy']) {
      const scripts = path.resolve(__dirname, '../skills', variant, 'scripts');
      const { CWClient } = require(path.join(scripts, 'cw_client.cjs'));
      const client = new CWClient();
      client.apiKey = 'test-key-do-not-save';
      client.retryBaseMs = 1;
      client.maxRequestRetries = 3;
      let calls = [];
      client.postJson = async (_url, body, headers) => {
        calls.push({ body, headers });
        const records = fs.readdirSync(path.join(temp, '.cw_skill/requests'));
        assert(records.length > 0, 'journal must exist before network');
        if (calls.length === 1 && variant !== 'interactive-architecture-diagram-workbuddy') throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return { statusCode: 503, body: JSON.stringify({ status: 'error', error: { code: 'MODEL_BUSY' }, receipt: {
          id: 'test-receipt', status: 'failed', quota: { status: 'refunded', cost: 0 }
        } }) };
      };
      const result = await client.request('/run', { user_request: 'private business input' });
      assert.strictEqual(calls.length, variant === 'interactive-architecture-diagram-workbuddy' ? 1 : 2, 'authoritative failed receipt must stop retries');
      assert.strictEqual(calls[0].headers['X-Request-ID'], calls.at(-1).headers['X-Request-ID']);
      assert.strictEqual(calls[0].headers['X-Request-Token'], calls.at(-1).headers['X-Request-Token']);
      assert.strictEqual(result.error.code, 'MODEL_BUSY');
      const text = fs.readFileSync(result.saved_request_record, 'utf8');
      assert(!text.includes(client.apiKey) && !text.includes('private business input'));
      const journal = JSON.parse(text);
      assert.strictEqual(journal.result.receipt.quota.status, 'refunded');
      assert.strictEqual(journal.state, 'failed');

      client.postJson = async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); };
      const unknown = await client.request('/run', { user_request: 'another request' });
      const pending = JSON.parse(fs.readFileSync(unknown.saved_request_record, 'utf8'));
      assert.strictEqual(pending.state, 'unconfirmed');
      assert(unknown.error.recovery_hint.includes('query_request.cjs'));
      assert.notStrictEqual(pending.request_id, journal.request_id);

      const { main } = require(path.join(scripts, 'query_request.cjs'));
      class RecoveryClient {
        async getRequestReceipt(options) {
          assert.strictEqual(options.requestId, pending.request_id);
          assert.strictEqual(options.token, pending.request_token);
          return { receipt: { status: 'succeeded' }, result: { status: 'ok', session_id: 'saved', cw_code: 'a: A', svg: '<svg></svg>' } };
        }
      }
      const write = process.stdout.write;
      let recovered;
      process.stdout.write = () => true;
      try { recovered = await main(['--record', unknown.saved_request_record, '--output_name', 'recovered'], RecoveryClient); }
      finally { process.stdout.write = write; }
      assert(fs.readFileSync(recovered.saved_cw_file, 'utf8').includes('a: A'));
      assert.strictEqual(fs.readFileSync(recovered.saved_svg_file, 'utf8'), '<svg></svg>');
      assert.strictEqual(JSON.parse(fs.readFileSync(unknown.saved_request_record)).state, 'succeeded');
    }
  } finally {
    process.chdir(originalCwd);
    // Only remove the isolated directory returned by mkdtemp above.
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('Request receipt client tests passed for three free variants.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
