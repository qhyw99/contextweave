const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const variants = [
  'interactive-architecture-diagram',
  'interactive-architecture-diagram-pay',
  'interactive-architecture-diagram-pptx',
  'interactive-architecture-diagram-workbuddy',
];
const fixtures = [
  { name: 'no-final-lf', source: 'root: 根节点' },
  { name: 'one-final-lf', source: 'root: 根节点\n' },
  { name: 'multiple-final-lf', source: 'root: 根节点\n\n\n' },
  { name: 'crlf-leading-blank', source: '\r\nroot: 中文 😀\r\nchild: 尾空格 \r\n' },
  { name: 'leading-lf', source: '\nroot: 首行之前有空行\n' },
  { name: 'trailing-spaces', source: 'root: 尾部两个空格  \n' },
  { name: 'unicode', source: '中文: "emoji 😀"\n' },
  { name: 'utf8-bom', source: '\uFEFFroot: BOM 也属于源\n' },
  { name: 'inner-fence-and-request', source: '# Request 是 CW 正文\nnote: |md\n  ```bash\n  # Request\n  ```\n|\n', fence: '````' },
];

function fencedInput(source, fence = '```') {
  return `# Request\n保留原图并修改一个标签\n# CW\n${fence}cw\n${source}${fence}\n`;
}

async function main() {
  const previousCwd = process.cwd();
  const fixtureDir = fs.mkdtempSync(path.join(repoRoot, 'tests', '.source-fidelity-'));
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
  const proxyValues = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  proxyKeys.forEach(key => delete process.env[key]);
  const payloads = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      payloads.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', session_id: 'synthetic-session' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.chdir(fixtureDir);
    for (const variant of variants) {
      const { CWClient } = require(path.join(repoRoot, 'skills', variant, 'scripts', 'cw_client.cjs'));
      const client = new CWClient();
      client.baseUrl = `http://127.0.0.1:${server.address().port}`;
      client.apiKey = 'synthetic-test-key';
      client.maxRequestRetries = 1;
      client.validateBaseUrl = () => null;
      let capabilityCalls = 0;
      client.getCapabilities = async () => {
        capabilityCalls += 1;
        return { annotations: { versions: [1] } };
      };

      for (const fixture of fixtures) {
        const inputFile = path.join(fixtureDir, `${variant}-${fixture.name}.md`);
        const sourceFile = path.join(fixtureDir, `${variant}-${fixture.name}.cw`);
        fs.writeFileSync(inputFile, fencedInput(fixture.source, fixture.fence), 'utf8');
        fs.writeFileSync(sourceFile, fixture.source, 'utf8');

        let result = await client.runGeneration({ inputFile, sessionId: 'synthetic-session' });
        if (fixture.name === 'no-final-lf') {
          assert.equal(result.status, 'error');
          assert.equal(result.error.code, 'CW_FENCE_UNCLOSED', `${variant}: an inline closing fence must not be guessed`);
        } else {
          assert.equal(result.status, 'ok', `${variant}/${fixture.name}: fenced input failed`);
          assert.equal(payloads.at(-1).initial_cw_code, fixture.source, `${variant}/${fixture.name}: fenced body changed`);
          assert.equal(payloads.at(-1).user_request, '保留原图并修改一个标签');
        }

        result = await client.runGeneration({ cwSourceFile: sourceFile, userRequest: '精确修改', sessionId: 'synthetic-session' });
        assert.equal(result.status, 'ok', `${variant}/${fixture.name}: exact source input failed`);
        assert.equal(payloads.at(-1).initial_cw_code, fixture.source, `${variant}/${fixture.name}: exact source bytes changed`);
        assert.equal(payloads.at(-1).user_request, '精确修改');
      }

      const rawSource = 'root: 非围栏正文\n\n';
      const rawInput = path.join(fixtureDir, `${variant}-raw.md`);
      fs.writeFileSync(rawInput, `# Request\n非围栏修改\n# CW\n${rawSource}`, 'utf8');
      let result = await client.runGeneration({ inputFile: rawInput, sessionId: 'synthetic-session' });
      assert.equal(result.status, 'ok');
      assert.equal(payloads.at(-1).initial_cw_code, rawSource, `${variant}: raw CW body changed`);

      const plainInput = path.join(fixtureDir, `${variant}-plain.md`);
      fs.writeFileSync(plainInput, '  普通自然语言请求 \n\n', 'utf8');
      result = await client.runGeneration({ inputFile: plainInput, useDefaultPalette: true });
      assert.equal(result.status, 'ok');
      assert.equal(payloads.at(-1).user_request, '普通自然语言请求', `${variant}: ordinary request behavior regressed`);
      assert.equal(payloads.at(-1).initial_cw_code, '');

      const errorCases = [
        { name: 'unclosed', content: '# Request\nx\n# CW\n```cw\nroot: x\n', code: 'CW_FENCE_UNCLOSED' },
        { name: 'multiple', content: `${fencedInput('a: A\n')}\n# CW\n\`\`\`cw\nb: B\n\`\`\`\n`, code: 'CW_SOURCE_CONFLICT' },
      ];
      for (const item of errorCases) {
        const inputFile = path.join(fixtureDir, `${variant}-${item.name}.md`);
        fs.writeFileSync(inputFile, item.content, 'utf8');
        const before = payloads.length;
        result = await client.runGeneration({ inputFile, sessionId: 'synthetic-session' });
        assert.equal(result.status, 'error');
        assert.equal(result.error.code, item.code, `${variant}/${item.name}: wrong diagnostic`);
        assert.equal(payloads.length, before, `${variant}/${item.name}: invalid input reached HTTP`);
      }

      const conflictInput = path.join(fixtureDir, `${variant}-conflict.md`);
      const conflictSource = path.join(fixtureDir, `${variant}-conflict.cw`);
      fs.writeFileSync(conflictInput, fencedInput('a: A\n'), 'utf8');
      fs.writeFileSync(conflictSource, 'b: B\n', 'utf8');
      let before = payloads.length;
      result = await client.runGeneration({ inputFile: conflictInput, cwSourceFile: conflictSource, sessionId: 'synthetic-session' });
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'CW_SOURCE_CONFLICT');
      assert.equal(payloads.length, before, `${variant}: conflicting sources reached HTTP`);

      const invalidSource = path.join(fixtureDir, `${variant}-invalid.cw`);
      fs.writeFileSync(invalidSource, Buffer.from([0x61, 0x3a, 0x20, 0xff]));
      before = payloads.length;
      result = await client.runGeneration({ cwSourceFile: invalidSource, userRequest: '修改', sessionId: 'synthetic-session' });
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'CW_SOURCE_INVALID_UTF8');
      assert.equal(payloads.length, before, `${variant}: invalid UTF-8 reached HTTP`);

      const annotationsFile = path.join(fixtureDir, `${variant}-annotations.json`);
      fs.writeFileSync(annotationsFile, JSON.stringify({ version: 1, items: [] }), 'utf8');
      result = await client.runGeneration({ cwSourceFile: invalidSource, annotationsFile, userRequest: '修改', sessionId: 'synthetic-session' });
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'CW_SOURCE_INVALID_UTF8');
      assert.equal(capabilityCalls, 0, `${variant}: invalid source must fail before annotation capability lookup`);
      assert.equal(payloads.length, before, `${variant}: invalid source with annotations reached HTTP`);
    }
  } finally {
    process.chdir(previousCwd);
    server.close();
    for (const key of proxyKeys) {
      if (proxyValues[key] === undefined) delete process.env[key];
      else process.env[key] = proxyValues[key];
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  console.log(`Exact CW source fidelity verified for ${variants.length} architecture clients and ${fixtures.length} synthetic fixtures.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
