import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../src/schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../src/server.mjs');
const PKG_ROOT = path.resolve(__dirname, '..');

function createStdioMcpClient(envOverrides = {}, executablePath = SERVER_PATH, useExecDirect = false, cwdOverride = PKG_ROOT) {
  const cmd = useExecDirect ? executablePath : process.execPath;
  const args = useExecDirect ? [] : [executablePath];
  const child = spawn(cmd, args, {
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

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const msg = JSON.parse(trimmed);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  let nextId = 1;

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for JSON-RPC response to ${method} (id=${id})`));
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
        child.kill();
        resolve();
      }, 500);
    });
  }

  return { request, close };
}

describe('@kolivri/memoreal-mcp stdio Cloud Connector suite', () => {
  let mockCloudServer;
  let mockCloudUrl;
  let receivedHeaders = [];
  let receivedBodies = [];

  before(async () => {
    mockCloudServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedHeaders.push(req.headers);
        const parsed = JSON.parse(body);
        receivedBodies.push(parsed);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    ok: true,
                    tool: parsed.params?.name,
                    arguments: parsed.params?.arguments,
                  }),
                },
              ],
            },
          })
        );
      });
    });

    await new Promise((resolve) => mockCloudServer.listen(0, '127.0.0.1', resolve));
    const addr = mockCloudServer.address();
    mockCloudUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (mockCloudServer) {
      await new Promise((resolve) => mockCloudServer.close(resolve));
    }
  });

  it('initializes over JSON-RPC 2.0 and lists all 15 tools, 3 resources, and 3 prompts', async () => {
    const client = createStdioMcpClient({ MEMOREAL_API_KEY: '', MEMORIA_API_KEY: '' });
    try {
      const initRes = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'glama-inspector-test', version: '1.0.0' },
        capabilities: {},
      });
      assert.equal(initRes.jsonrpc, '2.0');
      assert.equal(initRes.result.serverInfo.name, '@kolivri/memoreal-mcp');
      assert.ok(initRes.result.instructions?.includes('Memoreal Cloud'), 'initialize returns server instructions');

      const toolsRes = await client.request('tools/list', {});
      assert.equal(MCP_TOOLS.length, 15, 'MCP_TOOLS defines exactly 15 tools');
      assert.equal(toolsRes.result.tools.length, 15);
      assert.equal(toolsRes.result.tools.length, MCP_TOOLS.length);
      assert.ok(
        toolsRes.result.tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'),
        'all tools publish MCP quality annotations'
      );
      assert.ok(
        toolsRes.result.tools.every((t) => t.outputSchema && t.outputSchema.type === 'object' && /Use (when|at|to|after|before)/i.test(t.description)),
        'all 15 tools publish outputSchema and explicit usage/disambiguation guidance for Glama TDQS 4.5+'
      );
      const feedbackTool = toolsRes.result.tools.find((t) => t.name === 'feedback');
      assert.equal(feedbackTool.annotations.idempotentHint, false, 'feedback is marked non-idempotent');
      const explainTool = toolsRes.result.tools.find((t) => t.name === 'explain_code');
      assert.deepEqual(explainTool.inputSchema.required, [], 'explain_code allows either symbol or target');
      const connectTool = toolsRes.result.tools.find((t) => t.name === 'connect_account');
      assert.ok(connectTool, 'connect_account tool is present');
      assert.equal(connectTool.title, 'Connect Memoreal Account');
      assert.deepEqual(connectTool.annotations, {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
      assert.deepEqual(connectTool.inputSchema.required, [], 'connect_account inputSchema.required is empty');
      assert.equal(connectTool.outputSchema.type, 'object', 'connect_account outputSchema is object');
      assert.ok(
        /Use (when|at|to|after|before)/i.test(connectTool.description),
        'connect_account description matches Glama TDQS disambiguation regex'
      );
      assert.ok(
        Array.isArray(connectTool.outputSchema.properties?.workspace?.anyOf),
        'connect_account outputSchema.properties.workspace defines anyOf'
      );
      const workspaceTypes = connectTool.outputSchema.properties.workspace.anyOf.map((s) => s.type);
      assert.ok(workspaceTypes.includes('string'), 'workspace schema supports string');
      assert.ok(workspaceTypes.includes('object'), 'workspace schema supports object');

      const initBadProto = await client.request('initialize', {
        protocolVersion: { malformed: true },
        capabilities: {},
      });
      assert.equal(initBadProto.result.protocolVersion, '2024-11-05', 'non-string protocolVersion falls back to 2024-11-05');

      const initAck = await client.request('initialized', {});
      assert.deepEqual(initAck.result, {}, 'initialized with request id responds without hanging');

      const licenseText = fs.readFileSync(path.join(PKG_ROOT, 'LICENSE'), 'utf8');
      assert.match(licenseText, /IN NO EVENT SHALL THE\s+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE/, 'full MIT LICENSE text present');
      assert.match(licenseText, /Copyright \(c\) 2026 Kolivri$/m);
      assert.doesNotMatch(licenseText, /Kolivri Ltd/i);

      const glamaJson = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'glama.json'), 'utf8'));
      assert.equal(glamaJson.$schema, 'https://glama.ai/mcp/schemas/server.json');
      assert.ok(Array.isArray(glamaJson.maintainers) && glamaJson.maintainers.includes('stuk88'));

      const resList = await client.request('resources/list', {});
      assert.equal(resList.result.resources.length, MCP_RESOURCES.length);

      const promptsList = await client.request('prompts/list', {});
      assert.equal(promptsList.result.prompts.length, MCP_PROMPTS.length);

      const pingRes = await client.request('ping', {});
      assert.deepEqual(pingRes.result, {});
    } finally {
      await client.close();
    }
  });

  it('requires MEMOREAL_API_KEY when calling any Memoreal Cloud tool or reading a resource', async () => {
    const client = createStdioMcpClient({ MEMOREAL_API_KEY: '', MEMORIA_API_KEY: '' });
    try {
      const callRes = await client.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Should fail without API key' },
      });
      assert.equal(callRes.result.isError, true);
      assert.match(callRes.result.content[0].text, /Missing Memoreal API key: set MEMOREAL_API_KEY/);

      const resRead = await client.request('resources/read', {
        uri: 'memory://stats',
      });
      assert.ok(resRead.error, 'resources/read without API key returns JSON-RPC error');
      assert.match(resRead.error.message, /Missing Memoreal API key: set MEMOREAL_API_KEY/);
    } finally {
      await client.close();
    }
  });

  it('forwards authenticated tool and resource calls over HTTP Bearer to MEMOREAL_API_URL/v1/mcp', async () => {
    const client = createStdioMcpClient({
      MEMOREAL_API_KEY: 'mem_dev_test_key_123',
      MEMOREAL_API_URL: mockCloudUrl,
      MEMOREAL_NAMESPACE: 'proj-ns',
    });
    try {
      const callRes = await client.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Cloud-stored memory fact', type: 'semantic' },
      });
      assert.equal(callRes.result.isError, false);
      assert.equal(callRes.result.structuredContent.ok, true);
      assert.equal(callRes.result.structuredContent.tool, 'encode_memory');
      assert.equal(callRes.result.structuredContent.arguments.namespace, 'proj-ns');
      assert.equal(receivedHeaders[0].authorization, 'Bearer mem_dev_test_key_123');

      const resRead = await client.request('resources/read', {
        uri: 'memory://stats',
      });
      assert.ok(Array.isArray(resRead.result.contents));
      assert.equal(resRead.result.contents[0].uri, 'memory://stats');

      const explainBySymbol = await client.request('tools/call', {
        name: 'explain_code',
        arguments: { target: '', symbol: 'createMemorealMcpService' },
      });
      assert.equal(explainBySymbol.result.isError, false);
      assert.equal(explainBySymbol.result.structuredContent.arguments.symbol, 'createMemorealMcpService');
      assert.equal(explainBySymbol.result.structuredContent.arguments.target, 'createMemorealMcpService');
    } finally {
      await client.close();
    }
  });

  it('resolves both memoreal-* and legacy memoria-* prompts', async () => {
    const client = createStdioMcpClient({
      MEMOREAL_API_KEY: 'test-key',
      MEMOREAL_API_URL: mockCloudUrl,
    });
    try {
      const p1 = await client.request('prompts/get', { name: 'memoreal-session-start', arguments: { namespace: 'ns-test' } });
      assert.ok(p1.result.description.includes('Memoreal Cloud'));
      assert.ok(p1.result.messages[0].content.text.includes('build_context'));

      const p1Legacy = await client.request('prompts/get', { name: 'memoria-session-start', arguments: { namespace: 'ns-test' } });
      assert.ok(p1Legacy.result.description.includes('Memoreal Cloud'));
      assert.ok(p1Legacy.result.messages[0].content.text.includes('build_context'));

      const p2 = await client.request('prompts/get', { name: 'memoreal-wrap-up', arguments: { namespace: 'ns-test' } });
      assert.ok(p2.result.description.includes('consolidate'));

      const p2Legacy = await client.request('prompts/get', { name: 'memoria-wrap-up', arguments: { namespace: 'ns-test' } });
      assert.ok(p2Legacy.result.description.includes('consolidate'));

      const p3 = await client.request('prompts/get', { name: 'memoreal-handoff', arguments: { from_wing: 'architect', to_wing: 'qa' } });
      assert.ok(p3.result.description.includes('Hand off context'));

      const p3Legacy = await client.request('prompts/get', { name: 'memoria-handoff', arguments: { from_wing: 'architect', to_wing: 'qa' } });
      assert.ok(p3Legacy.result.description.includes('Hand off context'));
    } finally {
      await client.close();
    }
  });

  it('supports legacy MEMORIA_API_KEY environment variable fallback', async () => {
    const client = createStdioMcpClient({
      MEMOREAL_API_KEY: '',
      MEMORIA_API_KEY: 'legacy_memoria_key_456',
      MEMORIA_API_URL: mockCloudUrl,
      MEMORIA_NAMESPACE: 'legacy-ns',
    });
    try {
      const callRes = await client.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Legacy env key test', type: 'semantic' },
      });
      assert.equal(callRes.result.isError, false);
      assert.equal(callRes.result.structuredContent.ok, true);
      assert.equal(callRes.result.structuredContent.arguments.namespace, 'legacy-ns');
      const authHeader = receivedHeaders[receivedHeaders.length - 1].authorization;
      assert.equal(authHeader, 'Bearer legacy_memoria_key_456');
    } finally {
      await client.close();
    }
  });

  it('starts stdio server when executed through an npm/npx bin symlink', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-mcp-bin-'));
    const binPath = path.join(tmpDir, 'memoreal-mcp');
    fs.symlinkSync(SERVER_PATH, binPath);
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    const client = createStdioMcpClient({ MEMOREAL_API_KEY: '', MEMORIA_API_KEY: '' }, binPath, true, tmpDir);
    try {
      const initRes = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'npx-symlink-test', version: '1.0.0' },
        capabilities: {},
      });
      assert.equal(initRes.result.serverInfo.name, '@kolivri/memoreal-mcp');
      assert.equal(initRes.result.serverInfo.version, pkg.version);

      const toolsRes = await client.request('tools/list', {});
      assert.equal(toolsRes.result.tools.length, MCP_TOOLS.length);
    } finally {
      await client.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exports createMemoriaMcpService as a functional alias for createMemorealMcpService', async () => {
    const { createMemorealMcpService, createMemoriaMcpService } = await import('../src/server.mjs');
    assert.equal(typeof createMemorealMcpService, 'function');
    assert.equal(createMemoriaMcpService, createMemorealMcpService);

    const s1 = createMemoriaMcpService({ apiKey: 'alias_key', apiUrl: mockCloudUrl });
    assert.equal(typeof s1.callTool, 'function');
    assert.equal(typeof s1.getPrompt, 'function');
  });

  it('starts stdio server when executed through legacy memoria-mcp bin symlink', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-mcp-legacy-bin-'));
    const binPath = path.join(tmpDir, 'memoria-mcp');
    fs.symlinkSync(SERVER_PATH, binPath);
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    const client = createStdioMcpClient({ MEMOREAL_API_KEY: '', MEMORIA_API_KEY: '' }, binPath, true, tmpDir);
    try {
      const initRes = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'legacy-bin-test', version: '1.0.0' },
        capabilities: {},
      });
      assert.equal(initRes.result.serverInfo.name, '@kolivri/memoreal-mcp');
      assert.equal(initRes.result.serverInfo.version, pkg.version);

      const toolsRes = await client.request('tools/list', {});
      assert.equal(toolsRes.result.tools.length, MCP_TOOLS.length);
    } finally {
      await client.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
