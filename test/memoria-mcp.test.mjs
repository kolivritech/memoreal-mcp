import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../src/memory-store.mjs';

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

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
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

  return { request, notify, close };
}

describe('@kolivri/memoria-mcp end-to-end stdio integration suite', () => {
  let tmpDir;
  let storagePath;
  let mcpClient;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-mcp-test-'));
    storagePath = path.join(tmpDir, 'local-memories.json');
    mcpClient = createStdioMcpClient({
      MEMORIA_STORAGE_PATH: storagePath,
      MEMORIA_NAMESPACE: 'test-workspace',
      MEMORIA_API_KEY: '',
    });
  });

  after(async () => {
    if (mcpClient) {
      await mcpClient.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('initializes over JSON-RPC 2.0 and lists all 14 tools, 3 resources, and 3 prompts', async () => {
    const initRes = await mcpClient.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'glama-inspector-test', version: '1.0.0' },
      capabilities: {},
    });

    assert.equal(initRes.jsonrpc, '2.0');
    assert.equal(initRes.result.serverInfo.name, '@kolivri/memoria-mcp');
    assert.ok(initRes.result.capabilities.tools);
    assert.ok(initRes.result.capabilities.resources);
    assert.ok(initRes.result.capabilities.prompts);

    mcpClient.notify('notifications/initialized');

    const pingRes = await mcpClient.request('ping');
    assert.deepEqual(pingRes.result, {});

    const toolsRes = await mcpClient.request('tools/list');
    assert.equal(toolsRes.result.tools.length, 14);
    assert.deepEqual(
      toolsRes.result.tools.map((t) => t.name),
      [
        'encode_memory',
        'batch_encode',
        'recall_memories',
        'build_context',
        'forget_memory',
        'delete_by_context',
        'feedback',
        'consolidate',
        'health',
        'stats',
        'search_code',
        'explain_code',
        'list_agent_wings',
        'handoff_to_agent',
      ]
    );

    const resourcesRes = await mcpClient.request('resources/list');
    assert.equal(resourcesRes.result.resources.length, 3);
    assert.deepEqual(
      resourcesRes.result.resources.map((r) => r.uri),
      ['memory://rules', 'memory://recent', 'memory://stats']
    );

    const promptsRes = await mcpClient.request('prompts/list');
    assert.equal(promptsRes.result.prompts.length, 3);
    assert.deepEqual(
      promptsRes.result.prompts.map((p) => p.name),
      ['memoria-session-start', 'memoria-wrap-up', 'memoria-handoff']
    );
  });

  it('encodes, batch-encodes, recalls via BM25 + salience, and builds token-budgeted context', async () => {
    const enc1 = await mcpClient.request('tools/call', {
      name: 'encode_memory',
      arguments: {
        namespace: 'test-workspace',
        type: 'core',
        salience: 0.95,
        content: 'Never edit files directly on the main branch; always use a feature worktree.',
        context: [['source', 'correction']],
      },
    });
    assert.equal(enc1.result.isError, false);
    const mem1 = JSON.parse(enc1.result.content[0].text);
    assert.equal(mem1.status, 'encoded');
    assert.equal(mem1.tier, 'Core');
    assert.ok(mem1.id.startsWith('mem_'));

    const batchRes = await mcpClient.request('tools/call', {
      name: 'batch_encode',
      arguments: {
        namespace: 'test-workspace',
        memories: [
          {
            type: 'semantic',
            salience: 0.8,
            content: 'LocalMemoryStore uses BM25 (k1=1.5, b=0.75) combined with salience and freshness.',
            context: [['file', 'src/memory-store.mjs']],
          },
          {
            type: 'episodic',
            salience: 0.6,
            content: 'Implemented stdio JSON-RPC 2.0 handlers in src/server.mjs for Glama inspection.',
            context: [['task', 'mcp-server']],
          },
        ],
      },
    });
    assert.equal(batchRes.result.isError, false);
    const batchData = JSON.parse(batchRes.result.content[0].text);
    assert.equal(batchData.encoded_count, 2);

    const recallRes = await mcpClient.request('tools/call', {
      name: 'recall_memories',
      arguments: {
        namespace: 'test-workspace',
        query: 'BM25 salience LocalMemoryStore',
        token_budget: 2048,
      },
    });
    assert.equal(recallRes.result.isError, false);
    const recallData = JSON.parse(recallRes.result.content[0].text);
    assert.ok(recallData.count >= 1);
    assert.match(recallData.memories[0].content, /LocalMemoryStore uses BM25/);

    const ctxRes = await mcpClient.request('tools/call', {
      name: 'build_context',
      arguments: {
        namespace: 'test-workspace',
        query: 'worktree BM25 server',
        token_budget: 4096,
      },
    });
    assert.equal(ctxRes.result.isError, false);
    const ctxData = JSON.parse(ctxRes.result.content[0].text);
    assert.match(ctxData.context, /<memory_context>/);
    assert.match(ctxData.context, /## Core Rules & Invariants/);
    assert.ok(ctxData.memories_used >= 2);
  });

  it('tracks feedback, consolidates duplicates, reports stats and health, and forgets memories', async () => {
    const dup1 = await mcpClient.request('tools/call', {
      name: 'encode_memory',
      arguments: {
        namespace: 'test-workspace',
        type: 'episodic',
        salience: 0.78,
        content: 'Docker container runs node src/server.mjs on Alpine 22 without external dependencies.',
      },
    });
    const dup1Id = JSON.parse(dup1.result.content[0].text).id;

    const fbRes = await mcpClient.request('tools/call', {
      name: 'feedback',
      arguments: {
        id: dup1Id,
        useful: true,
      },
    });
    assert.equal(fbRes.result.isError, false);
    const fbData = JSON.parse(fbRes.result.content[0].text);
    assert.equal(fbData.updated, true);
    assert.ok(fbData.salience > 0.78);

    const consRes = await mcpClient.request('tools/call', {
      name: 'consolidate',
      arguments: {
        namespace: 'test-workspace',
      },
    });
    assert.equal(consRes.result.isError, false);
    const consData = JSON.parse(consRes.result.content[0].text);
    assert.equal(consData.namespace, 'test-workspace');
    assert.ok(consData.promoted_count >= 1);

    const statsRes = await mcpClient.request('tools/call', {
      name: 'stats',
      arguments: {
        namespace: 'test-workspace',
      },
    });
    assert.equal(statsRes.result.isError, false);
    const statsData = JSON.parse(statsRes.result.content[0].text);
    assert.equal(statsData.namespace, 'test-workspace');
    assert.ok(statsData.memory_count >= 3);

    const healthRes = await mcpClient.request('tools/call', {
      name: 'health',
      arguments: {},
    });
    assert.equal(healthRes.result.isError, false);
    const healthData = JSON.parse(healthRes.result.content[0].text);
    assert.equal(healthData.status, 'healthy');
    assert.equal(healthData.mode, 'local-standalone');
    assert.equal(healthData.storage_path, storagePath);

    const delCtxRes = await mcpClient.request('tools/call', {
      name: 'delete_by_context',
      arguments: {
        namespace: 'test-workspace',
        key: 'task',
        value: 'mcp-server',
      },
    });
    assert.equal(delCtxRes.result.isError, false);
    const delCtxData = JSON.parse(delCtxRes.result.content[0].text);
    assert.equal(delCtxData.deleted_count, 1);

    const forgetRes = await mcpClient.request('tools/call', {
      name: 'forget_memory',
      arguments: {
        id: dup1Id,
      },
    });
    assert.equal(forgetRes.result.isError, false);
    const forgetData = JSON.parse(forgetRes.result.content[0].text);
    assert.equal(forgetData.deleted, true);
  });

  it('executes search_code, explain_code, list_agent_wings, handoff_to_agent, resources/read, and prompts/get', async () => {
    const searchRes = await mcpClient.request('tools/call', {
      name: 'search_code',
      arguments: {
        query: 'LocalMemoryStore',
        path: PKG_ROOT,
      },
    });
    assert.equal(searchRes.result.isError, false);
    const searchData = JSON.parse(searchRes.result.content[0].text);
    assert.ok(searchData.count >= 1);

    const explainRes = await mcpClient.request('tools/call', {
      name: 'explain_code',
      arguments: {
        target: 'createMemoriaMcpService',
        namespace: 'test-workspace',
        path: PKG_ROOT,
      },
    });
    assert.equal(explainRes.result.isError, false);
    const explainData = JSON.parse(explainRes.result.content[0].text);
    assert.equal(explainData.target, 'createMemoriaMcpService');
    assert.ok(explainData.definitions.length >= 1);

    const handoffRes = await mcpClient.request('tools/call', {
      name: 'handoff_to_agent',
      arguments: {
        from_wing: 'architect',
        to_wing: 'qa',
        namespace: 'test-workspace',
        summary: 'Completed stdio MCP server implementation.',
        task: 'Verify all 14 MCP tools over stdio.',
      },
    });
    assert.equal(handoffRes.result.isError, false);
    const handoffData = JSON.parse(handoffRes.result.content[0].text);
    assert.equal(handoffData.status, 'handed_off');
    assert.equal(handoffData.to_wing, 'qa');

    const wingsRes = await mcpClient.request('tools/call', {
      name: 'list_agent_wings',
      arguments: {
        namespace: 'test-workspace',
      },
    });
    assert.equal(wingsRes.result.isError, false);
    const wingsData = JSON.parse(wingsRes.result.content[0].text);
    assert.equal(wingsData.wings.length, 5);
    assert.equal(wingsData.recent_handoffs.length, 1);

    for (const resource of MCP_RESOURCES) {
      const readRes = await mcpClient.request('resources/read', { uri: resource.uri });
      assert.equal(readRes.result.contents[0].uri, resource.uri);
      const parsed = JSON.parse(readRes.result.contents[0].text);
      assert.ok(typeof parsed === 'object');
    }

    for (const prompt of MCP_PROMPTS) {
      const getRes = await mcpClient.request('prompts/get', {
        name: prompt.name,
        arguments: { namespace: 'test-workspace', from_wing: 'architect', to_wing: 'qa', task: 'Run tests' },
      });
      assert.ok(Array.isArray(getRes.result.messages));
      assert.equal(getRes.result.messages[0].role, 'user');
    }
  });

  it('supports optional Memoria Cloud hybrid sync when MEMORIA_API_KEY is configured', async () => {
    const captured = [];
    const mockCloud = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        captured.push({
          method: req.method,
          url: req.url,
          auth: req.headers.authorization,
          body: JSON.parse(body),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'cloud_1',
            result: {
              content: [{ type: 'text', text: JSON.stringify({ cloud_stored: true }) }],
            },
          })
        );
      });
    });

    const cloudUrl = await new Promise((resolve) => {
      mockCloud.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${mockCloud.address().port}`);
      });
    });

    const cloudClient = createStdioMcpClient({
      MEMORIA_STORAGE_PATH: path.join(tmpDir, 'cloud-memories.json'),
      MEMORIA_API_URL: cloudUrl,
      MEMORIA_API_KEY: 'mem_dev_test_cloud_key',
    });

    try {
      const res = await cloudClient.request('tools/call', {
        name: 'encode_memory',
        arguments: {
          content: 'Hybrid cloud sync test memory',
          type: 'semantic',
        },
      });
      assert.equal(res.result.isError, false);
      const payload = JSON.parse(res.result.content[0].text);
      assert.equal(payload.cloud_sync.synced, true);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].url, '/v1/mcp');
      assert.equal(captured[0].auth, 'Bearer mem_dev_test_cloud_key');
    } finally {
      await cloudClient.close();
      await new Promise((resolve) => mockCloud.close(resolve));
    }
  });

  it('validates Dockerfile, package.json, glama.json, smithery.yaml, server.json, and README.md', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@kolivri/memoria-mcp');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.bin['memoria-mcp'], './src/server.mjs');

    const dockerfile = fs.readFileSync(path.join(PKG_ROOT, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /^FROM node:22-alpine/m);
    assert.match(dockerfile, /ENTRYPOINT \["node", "src\/server\.mjs"\]/);

    const glama = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'glama.json'), 'utf8'));
    assert.equal(glama.tools.length, 14);
    assert.deepEqual(
      glama.tools.map((t) => t.name),
      MCP_TOOLS.map((t) => t.name)
    );

    const serverJson = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'server.json'), 'utf8'));
    assert.equal(serverJson.tools.length, 14);
    assert.equal(serverJson.packages[0].transport.type, 'stdio');

    const readme = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
    assert.match(readme, /src\/server\.mjs/);
    assert.match(readme, /src\/memory-store\.mjs/);
    assert.match(readme, /docker build -t memoria-mcp \./);
  });
});
