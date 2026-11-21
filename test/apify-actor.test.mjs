import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeInput,
  readApifyInput,
  executeMemorealActorAction,
  executeMemoriaActorAction,
  outputApifyResult,
  main,
  VALID_ACTIONS,
} from '../src/apify-main.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

describe('Apify Actor Specification and Runner Suite', () => {
  let mockServer;
  let mockServerUrl;
  let recordedRequests = [];

  before(async () => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          // ignore
        }
        recordedRequests.push({
          method: req.method,
          headers: req.headers,
          body: parsed,
        });

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id || 'test_id',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    dispatched_tool: parsed.params?.name,
                    dispatched_args: parsed.params?.arguments,
                    received_auth: req.headers.authorization,
                  }),
                },
              ],
            },
          })
        );
      });
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const addr = mockServer.address();
    mockServerUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  it('validates .actor/actor.json specification metadata', () => {
    const actorJsonPath = path.join(PKG_ROOT, '.actor/actor.json');
    assert.ok(fs.existsSync(actorJsonPath), '.actor/actor.json must exist');
    const actorConfig = JSON.parse(fs.readFileSync(actorJsonPath, 'utf8'));

    assert.equal(actorConfig.actorSpecification, 1);
    assert.equal(actorConfig.name, 'memoreal-mcp');
    assert.equal(actorConfig.input, './input_schema.json');
    assert.equal(actorConfig.dockerfile, './Dockerfile');
    assert.equal(actorConfig.readme, '../README.md');
    assert.equal(actorConfig.environmentVariables?.MEMOREAL_API_URL, 'https://memoreal.kolivri.com');
    assert.equal(actorConfig.environmentVariables?.MEMORIA_API_URL, 'https://memoria.kolivri.com');
  });

  it('validates .actor/input_schema.json schema properties and action enum', () => {
    const schemaPath = path.join(PKG_ROOT, '.actor/input_schema.json');
    assert.ok(fs.existsSync(schemaPath), '.actor/input_schema.json must exist');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

    assert.equal(schema.type, 'object');
    assert.ok(schema.properties.apiKey, 'apiKey field declared');
    assert.equal(schema.properties.apiKey.isSecret, true, 'apiKey marked secret');
    assert.ok(schema.properties.namespace, 'namespace field declared');
    assert.ok(schema.properties.action, 'action field declared');
    assert.deepEqual(schema.properties.action.enum, VALID_ACTIONS);
    assert.ok(schema.properties.query, 'query field declared');
    assert.ok(schema.properties.content, 'content field declared');
    assert.ok(schema.properties.type, 'type field declared');
    assert.deepEqual(schema.properties.type.enum, ['episodic', 'semantic', 'buffer', 'core']);
    assert.ok(schema.properties.salience, 'salience field declared');
    assert.ok(schema.properties.tokenBudget, 'tokenBudget field declared');
  });

  it('validates .actor/Dockerfile uses Node 20 actor base and invokes apify-main.mjs', () => {
    const dockerfilePath = path.join(PKG_ROOT, '.actor/Dockerfile');
    assert.ok(fs.existsSync(dockerfilePath), '.actor/Dockerfile must exist');
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

    assert.match(dockerfile, /FROM apify\/actor-node:20/);
    assert.match(dockerfile, /RUN npm ci --omit=dev/);
    assert.match(dockerfile, /CMD \["node", "\.\/src\/apify-main\.mjs"\]/);
  });

  it('normalizes raw input with secure defaults and clamps salience', () => {
    const defaults = normalizeInput({});
    assert.equal(defaults.namespace, 'default');
    assert.equal(defaults.action, 'context');
    assert.equal(defaults.type, 'episodic');
    assert.equal(defaults.salience, 0.5);
    assert.equal(defaults.tokenBudget, 4096);

    const custom = normalizeInput({
      apiKey: '  mem_test_key  ',
      namespace: '  custom-workspace  ',
      action: 'recall',
      query: '  how does memory work?  ',
      salience: 1.5,
      tokenBudget: '1024',
      type: 'invalid_type',
    });
    assert.equal(custom.apiKey, 'mem_test_key');
    assert.equal(custom.namespace, 'custom-workspace');
    assert.equal(custom.action, 'recall');
    assert.equal(custom.query, 'how does memory work?');
    assert.equal(custom.salience, 1.0, 'clamped to 1.0');
    assert.equal(custom.tokenBudget, 1024);
    assert.equal(custom.type, 'episodic', 'fallback to episodic on invalid type');
  });

  it('resolves input from explicit object, env JSON, and fallback files', async () => {
    const explicit = await readApifyInput({ action: 'health', namespace: 'explicit-ns' });
    assert.equal(explicit.namespace, 'explicit-ns');

    const origEnv = process.env.APIFY_INPUT_JSON;
    try {
      process.env.APIFY_INPUT_JSON = JSON.stringify({ action: 'recall', query: 'env-query' });
      const fromEnv = await readApifyInput(null);
      assert.equal(fromEnv.action, 'recall');
      assert.equal(fromEnv.query, 'env-query');
    } finally {
      if (origEnv !== undefined) {
        process.env.APIFY_INPUT_JSON = origEnv;
      } else {
        delete process.env.APIFY_INPUT_JSON;
      }
    }
  });

  it('throws descriptive error when API key is missing for tool actions', async () => {
    const origMemoreal = process.env.MEMOREAL_API_KEY;
    const origMemoria = process.env.MEMORIA_API_KEY;
    delete process.env.MEMOREAL_API_KEY;
    delete process.env.MEMORIA_API_KEY;
    try {
      await assert.rejects(
        () =>
          executeMemorealActorAction({
            action: 'context',
            apiKey: '',
            apiUrl: mockServerUrl,
          }),
        /Missing Memoreal API key/
      );

      await assert.rejects(
        () =>
          executeMemorealActorAction({
            action: 'health',
            apiKey: '',
            apiUrl: mockServerUrl,
          }),
        /Missing Memoreal API key/
      );
    } finally {
      if (origMemoreal !== undefined) {
        process.env.MEMOREAL_API_KEY = origMemoreal;
      }
      if (origMemoria !== undefined) {
        process.env.MEMORIA_API_KEY = origMemoria;
      }
    }
  });

  it('rejects unsupported actions with helpful allowed actions list', async () => {
    await assert.rejects(
      () =>
        executeMemorealActorAction({
          action: 'invalid_action_xyz',
          apiKey: 'test-key',
        }),
      /Unsupported action: "invalid_action_xyz"\. Valid actions are: recall, context, encode, search_code, health, standby_mcp\./
    );
  });

  it('dispatches action: "context" to build_context tool', async () => {
    recordedRequests = [];
    const res = await executeMemorealActorAction({
      action: 'context',
      apiKey: 'mem_test_token_ctx',
      apiUrl: mockServerUrl,
      namespace: 'ctx-namespace',
      query: 'active architectural decisions',
      tokenBudget: 2048,
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'context');
    assert.equal(res.namespace, 'ctx-namespace');
    assert.equal(res.result.dispatched_tool, 'build_context');
    assert.equal(res.result.dispatched_args.query, 'active architectural decisions');
    assert.equal(res.result.dispatched_args.token_budget, 2048);
    assert.equal(res.result.dispatched_args.namespace, 'ctx-namespace');
    assert.equal(res.result.received_auth, 'Bearer mem_test_token_ctx');
  });

  it('dispatches action: "recall" to recall_memories tool', async () => {
    recordedRequests = [];
    const res = await executeMemorealActorAction({
      action: 'recall',
      apiKey: 'mem_test_token_recall',
      apiUrl: mockServerUrl,
      namespace: 'recall-namespace',
      query: 'find invariant rules',
      tokenBudget: 1024,
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'recall');
    assert.equal(res.result.dispatched_tool, 'recall_memories');
    assert.equal(res.result.dispatched_args.query, 'find invariant rules');
    assert.equal(res.result.dispatched_args.token_budget, 1024);
  });

  it('dispatches action: "encode" to encode_memory tool and enforces content', async () => {
    await assert.rejects(
      () =>
        executeMemorealActorAction({
          action: 'encode',
          apiKey: 'mem_test_key',
          apiUrl: mockServerUrl,
          content: '',
        }),
      /Action "encode" requires non-empty "content" parameter/
    );

    recordedRequests = [];
    const res = await executeMemorealActorAction({
      action: 'encode',
      apiKey: 'mem_test_token_encode',
      apiUrl: mockServerUrl,
      namespace: 'encode-ns',
      content: 'Always use integration tests before merging to main.',
      type: 'semantic',
      salience: 0.9,
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'encode');
    assert.equal(res.result.dispatched_tool, 'encode_memory');
    assert.equal(res.result.dispatched_args.content, 'Always use integration tests before merging to main.');
    assert.equal(res.result.dispatched_args.type, 'semantic');
    assert.equal(res.result.dispatched_args.salience, 0.9);
  });

  it('dispatches action: "health" to health tool', async () => {
    recordedRequests = [];
    const res = await executeMemorealActorAction({
      action: 'health',
      apiKey: 'mem_test_token_health',
      apiUrl: mockServerUrl,
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'health');
    assert.equal(res.result.dispatched_tool, 'health');
  });

  it('dispatches action: "search_code" to search_code tool', async () => {
    recordedRequests = [];
    const res = await executeMemorealActorAction({
      action: 'search_code',
      apiKey: 'mem_test_token_code',
      apiUrl: mockServerUrl,
      namespace: 'code-ns',
      query: 'createMemorealMcpService',
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'search_code');
    assert.equal(res.result.dispatched_tool, 'search_code');
    assert.equal(res.result.dispatched_args.query, 'createMemorealMcpService');
  });

  it('supports action: "standby_mcp" and boots stdio server', async () => {
    const res = await executeMemorealActorAction({
      action: 'standby_mcp',
      apiKey: 'mem_test_token_standby',
      apiUrl: mockServerUrl,
      namespace: 'standby-ns',
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'standby_mcp');
    assert.equal(res.status, 'standby_mcp_running');
    assert.ok(res.server && typeof res.server.close === 'function');
    res.server.close();
  });

  it('writes output to local storage directory when configured', async () => {
    const tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'apify-storage-test-'));
    const origStorage = process.env.APIFY_LOCAL_STORAGE_DIR;
    process.env.APIFY_LOCAL_STORAGE_DIR = tempStorage;

    try {
      const outputData = { ok: true, testValue: 42 };
      await outputApifyResult(outputData);

      const writtenFile = path.join(tempStorage, 'key_value_stores', 'default', 'OUTPUT.json');
      assert.ok(fs.existsSync(writtenFile), 'OUTPUT.json was written to local storage');
      const loaded = JSON.parse(fs.readFileSync(writtenFile, 'utf8'));
      assert.deepEqual(loaded, outputData);
    } finally {
      if (origStorage !== undefined) {
        process.env.APIFY_LOCAL_STORAGE_DIR = origStorage;
      } else {
        delete process.env.APIFY_LOCAL_STORAGE_DIR;
      }
      fs.rmSync(tempStorage, { recursive: true, force: true });
    }
  });

  it('runs main() gracefully catching errors and returning error payload', async () => {
    const errorResult = await main({
      input: {
        action: 'invalid_xyz',
      },
      throwOnError: false,
    });
    assert.equal(errorResult.ok, false);
    assert.match(errorResult.error, /Unsupported action/);
  });

  it('supports MEMOREAL_API_KEY and legacy MEMORIA_API_KEY and executeMemoriaActorAction alias', async () => {
    recordedRequests = [];
    const origMemoreal = process.env.MEMOREAL_API_KEY;
    const origMemoria = process.env.MEMORIA_API_KEY;
    delete process.env.MEMOREAL_API_KEY;
    process.env.MEMORIA_API_KEY = 'legacy_env_key_apify';
    try {
      const resLegacy = await executeMemoriaActorAction({
        action: 'health',
        apiUrl: mockServerUrl,
      });
      assert.equal(resLegacy.ok, true);
      assert.equal(resLegacy.result.received_auth, 'Bearer legacy_env_key_apify');

      process.env.MEMOREAL_API_KEY = 'canonical_env_key_apify';
      const resCanonical = await executeMemorealActorAction({
        action: 'health',
        apiUrl: mockServerUrl,
      });
      assert.equal(resCanonical.ok, true);
      assert.equal(resCanonical.result.received_auth, 'Bearer canonical_env_key_apify');
    } finally {
      if (origMemoreal !== undefined) {
        process.env.MEMOREAL_API_KEY = origMemoreal;
      } else {
        delete process.env.MEMOREAL_API_KEY;
      }
      if (origMemoria !== undefined) {
        process.env.MEMORIA_API_KEY = origMemoria;
      } else {
        delete process.env.MEMORIA_API_KEY;
      }
    }
  });
});
