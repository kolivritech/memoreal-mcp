import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../src/schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../src/server.mjs');
const PKG_ROOT = path.resolve(__dirname, '..');

function createStdioMcpClient(envOverrides = {}) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: PKG_ROOT,
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

describe('@kolivri/memoria-mcp stdio Cloud Connector suite', () => {
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

  it('initializes over JSON-RPC 2.0 and lists all 14 tools, 3 resources, and 3 prompts', async () => {
    const client = createStdioMcpClient({ MEMORIA_API_KEY: '' });
    try {
      const initRes = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'glama-inspector-test', version: '1.0.0' },
        capabilities: {},
      });
      assert.equal(initRes.jsonrpc, '2.0');
      assert.equal(initRes.result.serverInfo.name, '@kolivri/memoria-mcp');
      assert.ok(initRes.result.instructions?.includes('Memoria Cloud'), 'initialize returns server instructions');

      const toolsRes = await client.request('tools/list', {});
      assert.equal(toolsRes.result.tools.length, MCP_TOOLS.length);
      assert.ok(
        toolsRes.result.tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'),
        'all tools publish MCP quality annotations'
      );
      const feedbackTool = toolsRes.result.tools.find((t) => t.name === 'feedback');
      assert.equal(feedbackTool.annotations.idempotentHint, false, 'feedback is marked non-idempotent');
      const explainTool = toolsRes.result.tools.find((t) => t.name === 'explain_code');
      assert.deepEqual(explainTool.inputSchema.required, [], 'explain_code allows either symbol or target');

      const initBadProto = await client.request('initialize', {
        protocolVersion: { malformed: true },
        capabilities: {},
      });
      assert.equal(initBadProto.result.protocolVersion, '2024-11-05', 'non-string protocolVersion falls back to 2024-11-05');

      const initAck = await client.request('initialized', {});
      assert.deepEqual(initAck.result, {}, 'initialized with request id responds without hanging');

      const licenseText = fs.readFileSync(path.join(PKG_ROOT, 'LICENSE'), 'utf8');
      assert.match(licenseText, /IN NO EVENT SHALL THE\s+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE/, 'full MIT LICENSE text present');

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

  it('requires MEMORIA_API_KEY when calling any Memoria Cloud tool or reading a resource', async () => {
    const client = createStdioMcpClient({ MEMORIA_API_KEY: '' });
    try {
      const callRes = await client.request('tools/call', {
        name: 'encode_memory',
        arguments: { content: 'Should fail without API key' },
      });
      assert.equal(callRes.result.isError, true);
      assert.match(callRes.result.content[0].text, /Missing Memoria API key: set MEMORIA_API_KEY/);

      const resRead = await client.request('resources/read', {
        uri: 'memory://stats',
      });
      assert.ok(resRead.error, 'resources/read without API key returns JSON-RPC error');
      assert.match(resRead.error.message, /Missing Memoria API key: set MEMORIA_API_KEY/);
    } finally {
      await client.close();
    }
  });

  it('forwards authenticated tool and resource calls over HTTP Bearer to MEMORIA_API_URL/v1/mcp', async () => {
    const client = createStdioMcpClient({
      MEMORIA_API_KEY: 'mem_dev_test_key_123',
      MEMORIA_API_URL: mockCloudUrl,
      MEMORIA_NAMESPACE: 'proj-ns',
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
        arguments: { target: '', symbol: 'createMemoriaMcpService' },
      });
      assert.equal(explainBySymbol.result.isError, false);
      assert.equal(explainBySymbol.result.structuredContent.arguments.symbol, 'createMemoriaMcpService');
      assert.equal(explainBySymbol.result.structuredContent.arguments.target, 'createMemoriaMcpService');
    } finally {
      await client.close();
    }
  });
});
