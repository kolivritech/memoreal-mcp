import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import cp from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  isPlaceholderApiKey,
  POLITE_ONBOARDING_ACTION,
} from '../src/config-store.mjs';

import {
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  fetchSessionStartContext,
  ONBOARDING_WIZARD_PROMPT,
  MemorealHooksPlugin,
  setup,
} from '../opencode/memoria-hooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(PKG_ROOT, 'src', 'server.mjs');

function createStdioMcpClient(envOverrides = {}, cwdOverride = PKG_ROOT) {
  const child = cp.spawn(process.execPath, [SERVER_PATH], {
    cwd: cwdOverride,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const pending = new Map();
  let stderrOutput = '';

  child.stderr.on('data', (d) => {
    stderrOutput += d.toString();
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
      // Ignore unparseable lines
    }
  });

  let nextId = 1;

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `Timeout waiting for JSON-RPC response to ${method} (id=${id}). Stderr: ${stderrOutput}`
          )
        );
      }, 5000);

      pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async function close() {
    rl.close();
    child.stdin.end();
    await new Promise((resolve) => {
      child.once('close', resolve);
      setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve();
      }, 500);
    });
  }

  return { request, close, child, getStderr: () => stderrOutput };
}

function runCliProcess(args, { env = {}, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [SERVER_PATH, ...args], {
      cwd: PKG_ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe('WS-5: End-to-End Connect Wizard, Hot-Reload, CLI & Quiet-Hooks Suite', () => {
  let mockServer;
  let mockUrl;
  let mockState;

  before(async () => {
    mockState = {
      startRequests: [],
      pollRequests: [],
      healthRequests: [],
      mcpRequests: [],
      pollCount: 0,
      customPollQueue: [],
      return401ForMcp: false,
    };

    mockServer = http.createServer((req, res) => {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        let body = {};
        try {
          if (rawBody) body = JSON.parse(rawBody);
        } catch {}

        const urlPath = req.url || '';

        if (urlPath === '/v1/auth/device/start') {
          mockState.startRequests.push({ headers: req.headers, body });
          const deviceCode = `dev_code_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const userCode = `CODE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              device_code: deviceCode,
              user_code: userCode,
              verification_uri: `${mockUrl}/connect`,
              verification_uri_complete: `${mockUrl}/connect?code=${userCode}`,
              expires_in: 300,
              interval: 0.05,
            })
          );
          return;
        }

        if (urlPath === '/v1/auth/device/poll') {
          mockState.pollRequests.push({ headers: req.headers, body });

          if (mockState.customPollQueue.length > 0) {
            const resp = mockState.customPollQueue.shift();
            res.writeHead(resp.status || 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp.body));
            return;
          }

          mockState.pollCount++;
          if (mockState.pollCount <= 1) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'pending' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'approved',
                api_key: 'mem_dev_e2e_paired_secret_777',
                workspace: {
                  id: 'org_1',
                  name: 'Kolivri',
                  api_key: 'mem_dev_e2e_paired_secret_777',
                  secret: 'hidden_secret',
                },
              })
            );
          }
          return;
        }

        if (urlPath === '/v1/health') {
          mockState.healthRequests.push({ headers: req.headers, body });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              memory_count: 42,
              used_calls_30d: 5,
              api_call_limit: 1000,
            })
          );
          return;
        }

        if (urlPath === '/v1/mcp') {
          mockState.mcpRequests.push({ headers: req.headers, body });
          if (mockState.return401ForMcp) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: { message: 'Invalid or expired API token' },
              })
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id || null,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      id: 'mem_123',
                      namespace: body?.params?.arguments?.namespace || 'default',
                      salience: 0.5,
                      ok: true,
                    }),
                  },
                ],
              },
            })
          );
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Not found: ${urlPath}` }));
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const port = mockServer.address().port;
        mockUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  beforeEach(() => {
    mockState.startRequests = [];
    mockState.pollRequests = [];
    mockState.healthRequests = [];
    mockState.mcpRequests = [];
    mockState.pollCount = 0;
    mockState.customPollQueue = [];
    mockState.return401ForMcp = false;
  });

  it('1. performs stdio MCP connect_account + clientInfo.name + zero-restart hot-reload with 0600 config and IDE merges', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-e2e-home1-'));
    try {
      // Pre-create IDE configurations in tempHome:
      // - .cursor/mcp.json (with existing otherServer entry)
      const cursorDir = path.join(tempHome, '.cursor');
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            otherServer: { command: 'node', args: ['other.js'] },
          },
        }, null, 2)
      );

      // - Library/Application Support/Claude/claude_desktop_config.json
      const claudeDesktopDir = path.join(tempHome, 'Library', 'Application Support', 'Claude');
      fs.mkdirSync(claudeDesktopDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDesktopDir, 'claude_desktop_config.json'),
        JSON.stringify({ mcpServers: {} }, null, 2)
      );

      // - .claude.json (existing file)
      fs.writeFileSync(
        path.join(tempHome, '.claude.json'),
        JSON.stringify({ mcpServers: {} }, null, 2)
      );

      // - .codeium/windsurf/mcp_config.json
      const windsurfDir = path.join(tempHome, '.codeium', 'windsurf');
      fs.mkdirSync(windsurfDir, { recursive: true });
      fs.writeFileSync(
        path.join(windsurfDir, 'mcp_config.json'),
        JSON.stringify({ mcpServers: {} }, null, 2)
      );

      // - malformed .vscode/mcp.json containing "{ invalid json"
      const vscodeDir = path.join(tempHome, '.vscode');
      fs.mkdirSync(vscodeDir, { recursive: true });
      const malformedVscodePath = path.join(vscodeDir, 'mcp.json');
      fs.writeFileSync(malformedVscodePath, '{ invalid json');

      // DO NOT pre-create .config/opencode so preferredTool === "opencode" auto-creation is proven!

      // Spawn stdio MCP client
      const client = createStdioMcpClient({
        MEMOREAL_HOME: tempHome,
        MEMOREAL_API_URL: mockUrl,
        MEMOREAL_NO_BROWSER: '1',
        MEMOREAL_API_KEY: '',
        MEMORIA_API_KEY: '',
      });

      try {
        // Send initialize with clientInfo: { name: 'OpenCode', version: '2.0.0' }
        const initRes = await client.request('initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'OpenCode', version: '2.0.0' },
        });
        assert.equal(initRes.result.serverInfo.name, '@kolivri/memoreal-mcp');

        // Call connect_account({ action: 'status' }) -> assert status === 'not_started' and raw api_key is absent
        const statusRes1 = await client.request('tools/call', {
          name: 'connect_account',
          arguments: { action: 'status' },
        });
        assert.equal(statusRes1.result.isError, false);
        const s1 = JSON.parse(statusRes1.result.content[0].text);
        assert.equal(s1.status, 'not_started');
        assert.match(s1.message, /Step 1/);
        assert.equal('api_key' in s1, false);
        assert.equal(JSON.stringify(s1).includes('mem_dev_'), false);

        // Call connect_account({ action: 'start' })
        const startRes = await client.request('tools/call', {
          name: 'connect_account',
          arguments: { action: 'start' },
        });
        assert.equal(startRes.result.isError, false);
        const startData = JSON.parse(startRes.result.content[0].text);
        assert.equal(startData.status, 'waiting_for_browser');
        assert.ok(startData.user_code);
        assert.ok(startData.verification_uri_complete);
        assert.match(startData.message, /Step 2/);
        assert.match(startData.message, /I clicked Authorize — Verify/);
        assert.equal(JSON.stringify(startRes).includes('mem_dev_'), false);

        // Verify mock /v1/auth/device/start received { client_name: 'OpenCode', tool: 'opencode' }
        assert.ok(mockState.startRequests.length >= 1);
        const startReqBody = mockState.startRequests[0].body;
        assert.equal(startReqBody.client_name, 'OpenCode');
        assert.equal(startReqBody.tool, 'opencode');

        // Poll connect_account({ action: 'status' }) until status === 'connected'
        let connectedStatus = null;
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          const pollStatusRes = await client.request('tools/call', {
            name: 'connect_account',
            arguments: { action: 'status' },
          });
          const parsed = JSON.parse(pollStatusRes.result.content[0].text);
          if (parsed.status === 'connected') {
            connectedStatus = parsed;
            break;
          }
        }

        assert.ok(connectedStatus, 'Must transition to status: "connected"');
        assert.equal(connectedStatus.status, 'connected');
        assert.equal(connectedStatus.workspace.name, 'Kolivri');
        assert.match(connectedStatus.message, /Step 3/);
        assert.match(connectedStatus.message, /Yes — Index repo now \(Recommended\)/);

        // Assert 'mem_dev_e2e_paired_secret_777' and 'hidden_secret' NEVER appear anywhere in JSON.stringify(statusResponse)
        const serializedStatus = JSON.stringify(connectedStatus);
        assert.equal(serializedStatus.includes('mem_dev_e2e_paired_secret_777'), false);
        assert.equal(serializedStatus.includes('hidden_secret'), false);

        // Immediately in the SAME stdio MCP child process (zero restart!), call encode_memory
        const encodeRes = await client.request('tools/call', {
          name: 'encode_memory',
          arguments: { content: 'Hot-reloaded memory!' },
        });
        assert.equal(encodeRes.result.isError, false);
        assert.ok(mockState.mcpRequests.length >= 1);
        const lastMcpHeader = mockState.mcpRequests[mockState.mcpRequests.length - 1].headers;
        assert.equal(lastMcpHeader.authorization, 'Bearer mem_dev_e2e_paired_secret_777');

        // Call connect_account({}) (with action omitted) -> assert status === 'already_connected' after pinging /v1/mcp
        const mcpCountBeforeAlready = mockState.mcpRequests.length;
        const alreadyRes = await client.request('tools/call', {
          name: 'connect_account',
          arguments: {},
        });
        const alreadyData = JSON.parse(alreadyRes.result.content[0].text);
        assert.equal(alreadyData.status, 'already_connected');
        assert.match(alreadyData.message, /already connected/i);
        assert.ok(mockState.mcpRequests.length > mcpCountBeforeAlready, 'Must have pinged POST /v1/mcp');
        const lastMcpPing = mockState.mcpRequests[mockState.mcpRequests.length - 1];
        assert.equal(lastMcpPing.headers.authorization, 'Bearer mem_dev_e2e_paired_secret_777');

        // Verify config.env permissions under MEMOREAL_HOME
        const memorealEnv = path.join(tempHome, '.memoreal', 'config.env');
        const memoriaEnv = path.join(tempHome, '.memoria', 'config.env');
        assert.ok(fs.existsSync(memorealEnv));
        assert.ok(fs.existsSync(memoriaEnv));

        if (process.platform !== 'win32') {
          const memorealDirStat = fs.statSync(path.join(tempHome, '.memoreal'));
          assert.equal(memorealDirStat.mode & 0o777, 0o700);
          const memorealFileStat = fs.statSync(memorealEnv);
          assert.equal(memorealFileStat.mode & 0o777, 0o600);
          const memoriaFileStat = fs.statSync(memoriaEnv);
          assert.equal(memoriaFileStat.mode & 0o777, 0o600);
        }

        // Verify OpenCode native config: .config/opencode/opencode.json
        const opencodeJsonPath = path.join(tempHome, '.config', 'opencode', 'opencode.json');
        assert.ok(fs.existsSync(opencodeJsonPath));
        const opencodeConfig = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf8'));
        assert.equal(opencodeConfig.mcp.memoreal.type, 'remote');
        assert.equal(opencodeConfig.mcp.memoreal.url, `${mockUrl}/v1/mcp`);
        assert.equal(opencodeConfig.mcp.memoreal.enabled, true);
        assert.deepEqual(opencodeConfig.mcp.memoreal.headers, {
          Authorization: 'Bearer mem_dev_e2e_paired_secret_777',
        });
        assert.equal(opencodeConfig.mcpServers, undefined, 'Must NEVER contain .mcpServers');

        // Verify .cursor/mcp.json (+ .bak preserving otherServer)
        const cursorMcp = JSON.parse(fs.readFileSync(path.join(cursorDir, 'mcp.json'), 'utf8'));
        assert.equal(cursorMcp.mcpServers.memoreal.type, 'http');
        assert.equal(cursorMcp.mcpServers.memoreal.url, `${mockUrl}/v1/mcp`);
        assert.equal(cursorMcp.mcpServers.otherServer.command, 'node');
        assert.ok(fs.existsSync(path.join(cursorDir, 'mcp.json.bak')));

        // Verify .codeium/windsurf/mcp_config.json (+ .bak)
        const windsurfMcp = JSON.parse(fs.readFileSync(path.join(windsurfDir, 'mcp_config.json'), 'utf8'));
        assert.equal(windsurfMcp.mcpServers.memoreal.type, 'http');
        assert.ok(fs.existsSync(path.join(windsurfDir, 'mcp_config.json.bak')));

        // Verify Claude Desktop (+ .bak)
        const desktopMcp = JSON.parse(fs.readFileSync(path.join(claudeDesktopDir, 'claude_desktop_config.json'), 'utf8'));
        assert.equal(desktopMcp.mcpServers.memoreal.type, 'http');
        assert.ok(fs.existsSync(path.join(claudeDesktopDir, 'claude_desktop_config.json.bak')));

        // Verify .claude.json (+ .bak)
        const claudeMcp = JSON.parse(fs.readFileSync(path.join(tempHome, '.claude.json'), 'utf8'));
        assert.equal(claudeMcp.mcpServers.memoreal.type, 'http');
        assert.ok(fs.existsSync(path.join(tempHome, '.claude.json.bak')));

        // Verify malformed .vscode/mcp.json remains untouched
        assert.equal(fs.readFileSync(malformedVscodePath, 'utf8'), '{ invalid json');
        assert.equal(fs.existsSync(malformedVscodePath + '.bak'), false);
      } finally {
        await client.close();
      }
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('2. handles string workspace payload (e.g. acme) from /v1/auth/device/poll and asserts status connected with string workspace', async () => {
    mockState.customPollQueue = [
      { status: 200, body: { status: 'pending' } },
      {
        status: 200,
        body: {
          status: 'approved',
          api_key: 'mem_dev_e2e_string_ws_888',
          workspace: 'acme',
        },
      },
    ];

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-e2e-string-ws-'));
    const client = createStdioMcpClient({
      MEMOREAL_HOME: tempHome,
      MEMOREAL_API_URL: mockUrl,
      MEMOREAL_NO_BROWSER: '1',
      MEMOREAL_API_KEY: '',
      MEMORIA_API_KEY: '',
    });

    try {
      await client.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'OpenCode', version: '2.0.0' },
      });

      const startRes = await client.request('tools/call', {
        name: 'connect_account',
        arguments: { action: 'start' },
      });
      assert.equal(startRes.result.isError, false);

      let connectedStatus = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const pollStatusRes = await client.request('tools/call', {
          name: 'connect_account',
          arguments: { action: 'status' },
        });
        const parsed = JSON.parse(pollStatusRes.result.content[0].text);
        if (parsed.status === 'connected') {
          connectedStatus = parsed;
          break;
        }
      }

      assert.ok(connectedStatus, 'Must transition to status: "connected"');
      assert.equal(connectedStatus.status, 'connected');
      assert.equal(connectedStatus.workspace, 'acme');
      assert.match(connectedStatus.message, /Step 3/);
      assert.match(connectedStatus.message, /Yes — Index repo now \(Recommended\)/);

      // Assert raw key is NEVER exposed in status response
      const serializedStatus = JSON.stringify(connectedStatus);
      assert.equal(serializedStatus.includes('mem_dev_e2e_string_ws_888'), false);

      // Verify immediate zero-restart hot-reload for encode_memory
      const encodeRes = await client.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'String workspace memory hot-reload!' },
      });
      assert.equal(encodeRes.result.isError, false);
      assert.ok(mockState.mcpRequests.length >= 1);
      const lastMcpHeader = mockState.mcpRequests[mockState.mcpRequests.length - 1].headers;
      assert.equal(lastMcpHeader.authorization, 'Bearer mem_dev_e2e_string_ws_888');

      // Verify config.env was written with mode 0600
      const memorealEnv = path.join(tempHome, '.memoreal', 'config.env');
      assert.ok(fs.existsSync(memorealEnv));
      if (process.platform !== 'win32') {
        const memorealFileStat = fs.statSync(memorealEnv);
        assert.equal(memorealFileStat.mode & 0o777, 0o600);
      }
    } finally {
      await client.close();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('3. forwards host IDE clientInfo.name as exact tool slugs to POST /v1/auth/device/start', async () => {
    const ideCases = [
      { name: 'Cursor', expectedSlug: 'cursor', expectedClient: 'Cursor' },
      { name: 'claude-code', expectedSlug: 'claude-code', expectedClient: 'claude-code' },
      { name: 'Visual Studio Code', expectedSlug: 'vscode', expectedClient: 'Visual Studio Code' },
      { name: 'Windsurf', expectedSlug: 'windsurf', expectedClient: 'Windsurf' },
      { name: 'Zed', expectedSlug: 'zed', expectedClient: 'Zed' },
      { name: 'OpenAI Codex', expectedSlug: 'codex', expectedClient: 'OpenAI Codex' },
    ];

    for (const testCase of ideCases) {
      mockState.startRequests = [];
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-ide-test-'));
      const client = createStdioMcpClient({
        MEMOREAL_HOME: tempHome,
        MEMOREAL_API_URL: mockUrl,
        MEMOREAL_NO_BROWSER: '1',
        MEMOREAL_API_KEY: '',
      });

      try {
        await client.request('initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: testCase.name, version: '1.0.0' },
        });

        await client.request('tools/call', {
          name: 'connect_account',
          arguments: { action: 'start' },
        });

        assert.ok(mockState.startRequests.length >= 1);
        const req = mockState.startRequests[0].body;
        assert.equal(req.tool, testCase.expectedSlug, `Tool slug mismatch for ${testCase.name}`);
        assert.equal(req.client_name, testCase.expectedClient);
      } finally {
        await client.close();
        fs.rmSync(tempHome, { recursive: true, force: true });
      }
    }
  });

  it('4. rejects placeholder keys, delivers HTTP 401 onboarding guidance & hot-reloads cross-process from CLI', async () => {
    // Assert placeholder key filter unit coverage
    const samplePlaceholders = [
      'mem_dev_your_key_here',
      'mem_dev_...',
      'YOUR_API_KEY',
      '<MEMOREAL_API_KEY>',
    ];
    for (const ph of samplePlaceholders) {
      assert.equal(isPlaceholderApiKey(ph), true);
    }

    const tempHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-e2e-home2-'));

    // Spawn stdio MCP server with placeholder key
    const stdioClient = createStdioMcpClient({
      MEMOREAL_HOME: tempHome2,
      MEMOREAL_API_URL: mockUrl,
      MEMOREAL_NO_BROWSER: '1',
      MEMOREAL_API_KEY: 'mem_dev_your_key_here',
    });

    try {
      await stdioClient.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'Claude Code', version: '1.0.0' },
      });

      // Verify encode_memory fails with missing key and 3-Click Wizard guidance
      const failRes = await stdioClient.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Should fail with placeholder key' },
      });
      assert.equal(failRes.result.isError, true);
      const errText = failRes.result.content[0].text;
      assert.match(errText, /Missing Memoreal API key: set MEMOREAL_API_KEY/);
      assert.match(errText, /Polite Onboarding Action/);
      assert.match(errText, /Step 1/);
      assert.match(errText, /Step 2/);
      assert.match(errText, /Step 3/);

      // WHILE stdioClient REMAINS RUNNING, spawn node src/server.mjs setup --browser
      const cliRes = await runCliProcess(['setup', '--browser'], {
        env: {
          MEMOREAL_HOME: tempHome2,
          MEMOREAL_API_URL: mockUrl,
          MEMOREAL_NO_BROWSER: '1',
        },
      });

      assert.equal(cliRes.code, 0, `CLI setup failed: ${cliRes.stderr}`);
      assert.match(cliRes.stdout, /Memoreal Connected Successfully!/);
      assert.equal(cliRes.stdout.includes('mem_dev_e2e_paired_secret_777'), false);
      assert.equal(cliRes.stderr.includes('mem_dev_e2e_paired_secret_777'), false);

      // Verify config.env was created with mode 0600
      const cfgPath = path.join(tempHome2, '.memoreal', 'config.env');
      assert.ok(fs.existsSync(cfgPath));
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600);
      }

      // Verify POST /v1/mcp was verified by CLI
      assert.ok(mockState.mcpRequests.length >= 1);

      // Immediately call encode_memory on the ALREADY-RUNNING stdio MCP server!
      // (Tests cross-process dynamic hot-reload from disk without restart)
      const hotReloadRes = await stdioClient.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Hot-reloaded across process boundary!' },
      });
      assert.equal(hotReloadRes.result.isError, false);
      const lastMcp = mockState.mcpRequests[mockState.mcpRequests.length - 1];
      assert.equal(lastMcp.headers.authorization, 'Bearer mem_dev_e2e_paired_secret_777');

      // Verify Cloud HTTP 401 response handling
      mockState.return401ForMcp = true;
      const http401Res = await stdioClient.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Will get 401 from Cloud' },
      });
      assert.equal(http401Res.result.isError, true);
      const err401Text = http401Res.result.content[0].text;
      assert.match(err401Text, /401/);
      assert.match(err401Text, /Missing Memoreal API key: set MEMOREAL_API_KEY/);
      assert.match(err401Text, /Polite Onboarding Action/);
      assert.match(err401Text, /Step 1/);
      mockState.return401ForMcp = false;
    } finally {
      mockState.return401ForMcp = false;
      await stdioClient.close();
      fs.rmSync(tempHome2, { recursive: true, force: true });
    }

    // Also test node src/server.mjs login with choice [2] stdin input in isolated tempHome3
    const tempHome3 = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-e2e-home3-'));
    try {
      const loginRes = await runCliProcess(['login'], {
        env: {
          MEMOREAL_HOME: tempHome3,
          MEMOREAL_API_URL: mockUrl,
          MEMOREAL_NO_BROWSER: '1',
        },
        input: '2\nmem_dev_stdin_key_999\n',
      });

      assert.equal(loginRes.code, 0, `CLI login failed: ${loginRes.stderr}`);
      assert.match(loginRes.stdout, /Memoreal Connected Successfully!/);
      assert.equal(loginRes.stdout.includes('mem_dev_stdin_key_999'), false);
      assert.equal(loginRes.stderr.includes('mem_dev_stdin_key_999'), false);

      const loginCfgPath = path.join(tempHome3, '.memoreal', 'config.env');
      assert.ok(fs.existsSync(loginCfgPath));
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(loginCfgPath).mode & 0o777, 0o600);
      }
    } finally {
      fs.rmSync(tempHome3, { recursive: true, force: true });
    }
  });

  it('5. verifies bundled hooks & skills stay silent when unregistered, emit 3-Click Wizard on SessionStart, and omit brain.kolivri.com', async () => {
    const tempHooksHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-hooks-e2e-'));
    try {
      // 1. Hooks stay completely silent on Read/Write/Edit when unregistered
      assert.equal(buildReadSuffix('src/server.mjs', 'test-ns', tempHooksHome), '');
      assert.equal(buildWriteSuffix('src/server.mjs', 'test-ns', tempHooksHome), '');
      assert.equal(buildEditSuffix('src/server.mjs', 'test-ns', tempHooksHome), '');

      // 2. SessionStart emits the 3-Click Interactive In-Chat Wizard guidance
      const sessionStartCtx = await fetchSessionStartContext(process.cwd(), tempHooksHome);
      assert.equal(sessionStartCtx, ONBOARDING_WIZARD_PROMPT);
      assert.match(sessionStartCtx, /3-Click Interactive In-Chat Wizard/);
      assert.match(sessionStartCtx, /AskUserQuestion \(Claude Code\) or question \(OpenCode & Cursor\)/);
      assert.match(sessionStartCtx, /Step 1/);
      assert.match(sessionStartCtx, /Step 2/);
      assert.match(sessionStartCtx, /Step 3/);
      assert.ok(sessionStartCtx.includes('https://memoreal.kolivri.com/connect?tool=opencode'));
      assert.ok(sessionStartCtx.includes('tool: "opencode"'));
      assert.ok(sessionStartCtx.includes('client_name: "OpenCode"'));
      assert.ok(ONBOARDING_WIZARD_PROMPT.includes('https://memoreal.kolivri.com/connect?tool=opencode'));
      assert.ok(ONBOARDING_WIZARD_PROMPT.includes('tool: "opencode"'));
      assert.ok(ONBOARDING_WIZARD_PROMPT.includes('client_name: "OpenCode"'));

      // 3. hooks/hooks.json exists and contains 3-Click Wizard SessionStart
      const hooksJsonPath = path.join(PKG_ROOT, 'hooks', 'hooks.json');
      assert.ok(fs.existsSync(hooksJsonPath));
      const hooksJsonContent = fs.readFileSync(hooksJsonPath, 'utf8');
      assert.match(hooksJsonContent, /3-Click Interactive In-Chat Wizard/);
      assert.match(hooksJsonContent, /AskUserQuestion/);

      function getAllFilesRecursive(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...getAllFilesRecursive(fullPath));
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
        return files;
      }

      // 4. skills/memoreal-connect/SKILL.md AND skills/memoria-connect/SKILL.md both exist
      const connectSkillPath = path.join(PKG_ROOT, 'skills', 'memoreal-connect', 'SKILL.md');
      assert.ok(fs.existsSync(connectSkillPath));
      const connectSkillContent = fs.readFileSync(connectSkillPath, 'utf8');
      assert.match(connectSkillContent, /3-Click Interactive In-Chat Wizard/);
      assert.match(connectSkillContent, /connect_account/);
      assert.match(connectSkillContent, /AskUserQuestion/);

      const legacyConnectSkillPath = path.join(PKG_ROOT, 'skills', 'memoria-connect', 'SKILL.md');
      assert.ok(fs.existsSync(legacyConnectSkillPath), 'skills/memoria-connect/SKILL.md must exist');
      const legacyConnectContent = fs.readFileSync(legacyConnectSkillPath, 'utf8');
      assert.match(legacyConnectContent, /3-Click Interactive In-Chat Wizard/);
      assert.match(legacyConnectContent, /connect_account/);

      // 5. Recursively scan EVERY file inside skills/ and assert ZERO files contain brain.kolivri.com
      const skillsDir = path.join(PKG_ROOT, 'skills');
      const allSkillFiles = getAllFilesRecursive(skillsDir);
      assert.ok(allSkillFiles.length >= 2, 'Must scan skills directory');
      for (const skillFile of allSkillFiles) {
        const fileContent = fs.readFileSync(skillFile, 'utf8');
        assert.equal(
          fileContent.includes('brain.kolivri.com'),
          false,
          `Skill file ${path.relative(PKG_ROOT, skillFile)} must NOT contain brain.kolivri.com`
        );
      }

      // 6. skills/memoreal-doctor/SKILL.md omits brain.kolivri.com and guides to connect_account / setup
      const doctorSkillPath = path.join(PKG_ROOT, 'skills', 'memoreal-doctor', 'SKILL.md');
      assert.ok(fs.existsSync(doctorSkillPath));
      const doctorSkillContent = fs.readFileSync(doctorSkillPath, 'utf8');
      assert.equal(
        doctorSkillContent.includes('brain.kolivri.com'),
        false,
        'memoreal-doctor must NEVER reference brain.kolivri.com'
      );
      assert.match(doctorSkillContent, /connect_account/);
      assert.match(doctorSkillContent, /npx -y @kolivri\/memoreal-mcp setup/);

      // 7. Verify in-process MemorealHooksPlugin & setup with PRD_FLASH_LEAF_WORKER cleared and restored
      const savedLeafWorker = process.env.PRD_FLASH_LEAF_WORKER;
      delete process.env.PRD_FLASH_LEAF_WORKER;
      try {
        const plugin = await MemorealHooksPlugin({ directory: process.cwd() });
        const pluginOutput = { system: [] };
        await plugin['experimental.chat.system.transform']({ sessionID: 'test-session-e2e' }, pluginOutput);
        assert.equal(pluginOutput.system.length, 1);
        assert.equal(pluginOutput.system[0], ONBOARDING_WIZARD_PROMPT);

        // Turn 2 stays silent
        const pluginOutput2 = { system: [] };
        await plugin['experimental.chat.system.transform']({ sessionID: 'test-session-e2e' }, pluginOutput2);
        assert.equal(pluginOutput2.system.length, 0);

        // V2 setup hook test
        const contextHandlers = [];
        const mockCtx = {
          location: { directory: process.cwd() },
          session: {
            hook: async (name, handler) => {
              if (name === 'context') contextHandlers.push(handler);
            },
          },
          tool: { hook: async () => {} },
          event: { subscribe: async function* () {} },
        };
        const cleanup = await setup(mockCtx);
        assert.equal(typeof cleanup, 'function');
        assert.equal(contextHandlers.length, 1);
        const v2Event = { sessionID: 'test-session-v2-e2e', system: [] };
        await contextHandlers[0](v2Event);
        assert.equal(v2Event.system.length, 1);
        assert.equal(v2Event.system[0].text, ONBOARDING_WIZARD_PROMPT);
        cleanup();
      } finally {
        if (savedLeafWorker !== undefined) {
          process.env.PRD_FLASH_LEAF_WORKER = savedLeafWorker;
        } else {
          delete process.env.PRD_FLASH_LEAF_WORKER;
        }
      }
    } finally {
      fs.rmSync(tempHooksHome, { recursive: true, force: true });
    }
  });

  it('6. detects 401 on POST /v1/mcp: connect_account({}) with stale key initiates fresh device pairing and CLI setup --key exits non-zero', async () => {
    // 1. Set mockState.return401ForMcp = true (even while /v1/health returns 200!)
    mockState.return401ForMcp = true;

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-e2e-stale-key-'));
    try {
      const client = createStdioMcpClient({
        MEMOREAL_HOME: tempHome,
        MEMOREAL_API_URL: mockUrl,
        MEMOREAL_NO_BROWSER: '1',
        MEMOREAL_API_KEY: 'mem_dev_stale_revoked_key',
      });

      try {
        await client.request('initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'OpenCode', version: '2.0.0' },
        });

        const mcpCountBefore = mockState.mcpRequests.length;
        const startCountBefore = mockState.startRequests.length;

        // Calling connect_account({}) (action omitted) with a stale/revoked key
        const connectRes = await client.request('tools/call', {
          name: 'connect_account',
          arguments: {},
        });

        assert.equal(connectRes.result.isError, false);
        const connectData = JSON.parse(connectRes.result.content[0].text);

        // Does NOT return already_connected
        assert.notEqual(connectData.status, 'already_connected');
        // Instead detects 401 on POST /v1/mcp and initiates a fresh waiting_for_browser device pairing flow
        assert.equal(connectData.status, 'waiting_for_browser');
        assert.ok(connectData.user_code);
        assert.ok(connectData.verification_uri_complete);
        assert.ok(mockState.mcpRequests.length > mcpCountBefore, 'Must have recorded POST /v1/mcp ping');
        const lastMcp = mockState.mcpRequests[mockState.mcpRequests.length - 1];
        assert.equal(lastMcp.headers.authorization, 'Bearer mem_dev_stale_revoked_key');
        assert.ok(mockState.startRequests.length > startCountBefore, 'Must have initiated device flow via /v1/auth/device/start');
      } finally {
        await client.close();
      }

      // 2. node src/server.mjs setup --key mem_dev_revoked_key exits non-zero when /v1/mcp returns 401
      const cliRes = await runCliProcess(['setup', '--key', 'mem_dev_revoked_key'], {
        env: {
          MEMOREAL_HOME: tempHome,
          MEMOREAL_API_URL: mockUrl,
          MEMOREAL_NO_BROWSER: '1',
        },
      });

      assert.notEqual(cliRes.code, 0, 'CLI setup --key must exit non-zero when /v1/mcp returns 401');
      assert.match(cliRes.stderr, /Invalid or revoked Memoreal API key/);
      assert.match(cliRes.stderr, /401/);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
