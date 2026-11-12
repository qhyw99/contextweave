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
const cases = [
  {
    name: 'lf-wrapper-and-body-blank',
    input: '# Request\n保留正文\n# CW\n\n```cw\n\n\uFEFFroot: 正文首行之前有空行\nchild: LF\n```\n',
    source: '\n\uFEFFroot: 正文首行之前有空行\nchild: LF\n',
  },
  {
    name: 'crlf-wrapper-and-body-blank',
    input: '# Request\r\n保留正文\r\n# CW\r\n\r\n```cw\r\n\r\nroot: CRLF\r\nchild: 尾空格 \r\n```\r\n',
    source: '\r\nroot: CRLF\r\nchild: 尾空格 \r\n',
  },
  {
    name: 'raw-leading-blank-is-body',
    input: '# Request\n保留非围栏正文\n# CW\n\nroot: 非围栏首空行\n',
    source: '\nroot: 非围栏首空行\n',
  },
];

async function main() {
  const fixtureDir = fs.mkdtempSync(path.join(repoRoot, 'tests', '.source-wrapper-'));
  const previousCwd = process.cwd();
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

      for (const item of cases) {
        const inputFile = path.join(fixtureDir, `${variant}-${item.name}.md`);
        fs.writeFileSync(inputFile, item.input, 'utf8');
        const result = await client.runGeneration({ inputFile, sessionId: 'synthetic-session' });
        assert.equal(result.status, 'ok', `${variant}/${item.name}: request failed`);
        assert.equal(payloads.at(-1).initial_cw_code, item.source, `${variant}/${item.name}: wrapper/body whitespace changed`);
      }

      const annotationsFile = path.join(fixtureDir, `${variant}-annotations.json`);
      fs.writeFileSync(annotationsFile, JSON.stringify({ version: 1, items: [] }), 'utf8');
      const errors = [
        { name: 'blank-unclosed', input: '# Request\nx\n# CW\n\n```cw\nroot: x\n', code: 'CW_FENCE_UNCLOSED' },
        { name: 'blank-multiple', input: '# Request\nx\n# CW\n\n```cw\na: A\n```\n# CW\n\n```cw\nb: B\n```\n', code: 'CW_SOURCE_CONFLICT' },
        { name: 'blank-trailing', input: '# Request\nx\n# CW\n\n```cw\na: A\n```\nunexpected\n', code: 'CW_TRAILING_CONTENT' },
      ];
      for (const item of errors) {
        const inputFile = path.join(fixtureDir, `${variant}-${item.name}.md`);
        fs.writeFileSync(inputFile, item.input, 'utf8');
        const before = payloads.length;
        const result = await client.runGeneration({ inputFile, annotationsFile, sessionId: 'synthetic-session' });
        assert.equal(result.status, 'error');
        assert.equal(result.error.code, item.code, `${variant}/${item.name}: wrong diagnostic`);
        assert.equal(payloads.length, before, `${variant}/${item.name}: invalid input reached generation HTTP`);
        assert.equal(capabilityCalls, 0, `${variant}/${item.name}: invalid input reached capability lookup`);
      }
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
  console.log('Blank wrapper compatibility and zero-request errors verified for four architecture clients.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
