const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  CWClient,
  downloadAssetsLocally,
  _internals,
} = require(path.join(
  __dirname,
  "..",
  "skills",
  "interactive-architecture-diagram",
  "scripts",
  "cw_client.cjs"
));

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "CW_API_BASE_URL",
  "CW_REQUEST_MAX_RETRIES",
  "CW_REQUEST_RETRY_BASE_MS",
];

function snapshotEnvironment() {
  return Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function clearProxyEnvironment() {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnvironment(snapshot) {
  clearProxyEnvironment();
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function withLocalProxy(mode, callback) {
  let connectCount = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  server.on("clientError", (error, socket) => socket.destroy());
  server.on("connect", (req, socket) => {
    connectCount += 1;
    if (mode === "reset") {
      socket.destroy();
      return;
    }
    const statusCode = mode;
    const statusText = statusCode === 407 ? "Proxy Authentication Required" : "Bad Gateway";
    socket.end(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      "Content-Length: 0\r\n" +
      "Connection: close\r\n\r\n"
    );
  });

  const port = await listen(server);
  try {
    return await callback({
      proxyUrl: `http://127.0.0.1:${port}`,
      connectCount: () => connectCount,
    });
  } finally {
    await close(server);
  }
}

function testProxySelection() {
  clearProxyEnvironment();
  const proxyUrl = "http://proxy.invalid:8080";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://example.net")), null);
  process.env.HTTPS_PROXY = proxyUrl;

  assert.strictEqual(_internals.getProxyForUrl(new URL("https://example.net")), proxyUrl);

  process.env.NO_PROXY = "example.com";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://example.com")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://api.example.com")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://example.net")), proxyUrl);

  process.env.NO_PROXY = ".example.com,*.example.org";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://api.example.com")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://api.example.org")), null);

  process.env.NO_PROXY = "example.com:8443";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://api.example.com:8443")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://api.example.com")), proxyUrl);

  process.env.NO_PROXY = "127.0.0.1,::1,[2001:db8::1]:8443";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://127.0.0.1")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://[::1]")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://[2001:db8::1]:8443")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://[2001:db8::1]")), proxyUrl);

  process.env.NO_PROXY = "*";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://anything.example")), null);

  clearProxyEnvironment();
  process.env.HTTP_PROXY = "http://http-proxy.invalid:8080";
  assert.strictEqual(
    _internals.getProxyForUrl(new URL("http://example.com")),
    "http://http-proxy.invalid:8080"
  );

  clearProxyEnvironment();
  process.env.https_proxy = proxyUrl;
  process.env.no_proxy = "lowercase.example";
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://lowercase.example")), null);
  assert.strictEqual(_internals.getProxyForUrl(new URL("https://example.net")), proxyUrl);
}

async function requestThroughProxy(mode) {
  return withLocalProxy(mode, async ({ proxyUrl, connectCount }) => {
    clearProxyEnvironment();
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.CW_REQUEST_MAX_RETRIES = "3";
    process.env.CW_REQUEST_RETRY_BASE_MS = "1";

    const result = await new CWClient().request("/proxy-test", { test: true });
    return { result, connectCount: connectCount() };
  });
}

async function testProxyErrorsAndRetries() {
  const rejected = await requestThroughProxy(407);
  assert.strictEqual(rejected.result.error.code, "PROXY_ERROR");
  assert.strictEqual(rejected.connectCount, 1);
  assert.match(rejected.result.error.recovery_hint, /代理要求认证/);

  const unavailable = await requestThroughProxy(502);
  assert.strictEqual(unavailable.result.error.code, "PROXY_ERROR");
  assert.strictEqual(unavailable.connectCount, 3);
  assert.match(unavailable.result.error.message, /status 502/);

  const reset = await requestThroughProxy("reset");
  assert.strictEqual(reset.result.error.code, "PROXY_ERROR");
  assert.strictEqual(reset.connectCount, 3);

  clearProxyEnvironment();
  process.env.HTTPS_PROXY = "socks://proxy-user:super-secret@127.0.0.1:1080";
  const invalidConfig = await new CWClient().request("/proxy-test", { test: true });
  assert.strictEqual(invalidConfig.error.code, "PROXY_ERROR");
  assert.doesNotMatch(JSON.stringify(invalidConfig), /proxy-user|super-secret/);
}

async function testDownloadWarning() {
  await withLocalProxy(407, async ({ proxyUrl, connectCount }) => {
    clearProxyEnvironment();
    process.env.HTTP_PROXY = proxyUrl;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-proxy-test-"));
    const svgUrl = "http://assets.example.invalid/diagram.svg";
    try {
      const result = await downloadAssetsLocally({
        status: "ok",
        session_id: "proxy-test",
        output_name: "proxy-test",
        output_dir: outputDir,
        svg_url: svgUrl,
      });

      assert.strictEqual(result.status, "ok");
      assert.strictEqual(result.svg_url, svgUrl);
      assert.strictEqual(result.saved_svg_file, undefined);
      assert.strictEqual(connectCount(), 1);
      assert.ok(Array.isArray(result.warnings));
      assert.match(result.warnings[0], /资源下载失败/);
      assert.match(result.warnings[0], /status 407/);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
}

async function main() {
  const environmentSnapshot = snapshotEnvironment();
  try {
    testProxySelection();
    await testProxyErrorsAndRetries();
    await testDownloadWarning();
    console.log("cw_client_proxy_test passed");
  } finally {
    restoreEnvironment(environmentSnapshot);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
