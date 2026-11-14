#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  LocalMemoryStore,
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_TOOLS,
} from './memory-store.mjs';

export function createMemoriaMcpService(options = {}) {
  const apiUrl = (
    options.apiUrl ||
    process.env.MEMORIA_API_URL ||
    'https://memoria.kolivri.com'
  ).replace(/\/+$/, '');
  const apiKey = (options.apiKey ?? process.env.MEMORIA_API_KEY ?? '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? process.env.MEMORIA_TIMEOUT_MS ?? 10_000);
  const store = options.store || new LocalMemoryStore(options);

  async function syncWithCloud(toolName, args) {
    if (!apiKey || typeof fetchImpl !== 'function') {
      return null;
    }
    const endpoint = apiUrl.endsWith('/v1/mcp') ? apiUrl : `${apiUrl}/v1/mcp`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `cloud_${Date.now()}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Memoria Cloud API error (${response.status})`);
    }
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error.message || 'Memoria Cloud RPC error');
    }
    const textBlock = payload?.result?.content?.[0]?.text;
    if (textBlock) {
      try {
        return JSON.parse(textBlock);
      } catch {
        return { raw: textBlock };
      }
    }
    return payload?.result ?? null;
  }

  function executeLocalTool(name, args = {}) {
    switch (name) {
      case 'encode_memory':
        return store.encodeMemory(args);
      case 'batch_encode':
        return store.batchEncode(args);
      case 'recall_memories':
        return store.recallMemories(args);
      case 'build_context':
        return store.buildContext(args);
      case 'forget_memory':
        return store.forgetMemory(args);
      case 'delete_by_context':
        return store.deleteByContext(args);
      case 'feedback':
        return store.feedback(args);
      case 'consolidate':
        return store.consolidate(args);
      case 'health':
        return store.health({ cloudSyncEnabled: Boolean(apiKey) });
      case 'stats':
        return store.stats(args);
      case 'search_code':
        return store.searchCode(args);
      case 'explain_code':
        return store.explainCode(args);
      case 'list_agent_wings':
        return store.listAgentWings(args);
      case 'handoff_to_agent':
        return store.handoffToAgent(args);
      default:
        throw new Error(`Unknown tool: "${name}"`);
    }
  }

  async function callTool(name, args = {}) {
    const localResult = executeLocalTool(name, args);
    if (!apiKey) {
      return localResult;
    }
    try {
      const cloudResult = await syncWithCloud(name, args);
      if (cloudResult && typeof cloudResult === 'object') {
        return {
          ...localResult,
          cloud_sync: {
            synced: true,
            api_url: apiUrl,
            cloud_response: cloudResult,
          },
        };
      }
    } catch (cloudErr) {
      return {
        ...localResult,
        cloud_sync: {
          synced: false,
          api_url: apiUrl,
          warning: cloudErr.message || String(cloudErr),
        },
      };
    }
    return localResult;
  }

  function readResource(uri) {
    if (uri === 'memory://rules') {
      const rules = store.state.memories
        .filter((m) => !m.superseded_by && (m.type === 'core' || m.salience >= 0.8))
        .sort((a, b) => b.salience - a.salience);
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ count: rules.length, rules }, null, 2),
      };
    }

    if (uri === 'memory://recent') {
      const recent = store.state.memories
        .filter((m) => !m.superseded_by)
        .slice(-25)
        .reverse();
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ count: recent.length, memories: recent }, null, 2),
      };
    }

    if (uri === 'memory://stats') {
      const healthData = store.health({ cloudSyncEnabled: Boolean(apiKey) });
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(healthData, null, 2),
      };
    }

    throw new Error(`Unknown resource URI: "${uri}"`);
  }

  function getPrompt(name, promptArgs = {}) {
    const ns = promptArgs.namespace || store.defaultNamespace;
    if (name === 'memoria-session-start') {
      return {
        description: 'Load session context and check Memoria health.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Call build_context with namespace "${ns}", query "previous tasks, plans, pending work, key decisions, progress, recent context", and token_budget 4096, and call health in parallel.`,
            },
          },
        ],
      };
    }

    if (name === 'memoria-wrap-up') {
      return {
        description: 'Encode key session learnings and consolidate duplicate memories.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review the session using the Memoria write gate, encode any lasting lessons or decisions via encode_memory in namespace "${ns}", and then run consolidate on "${ns}".`,
            },
          },
        ],
      };
    }

    if (name === 'memoria-handoff') {
      const fromWing = promptArgs.from_wing || 'architect';
      const toWing = promptArgs.to_wing || 'qa';
      const task = promptArgs.task || 'Verify implementation';
      return {
        description: `Hand off context from ${fromWing} wing to ${toWing} wing.`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Call handoff_to_agent with from_wing="${fromWing}", to_wing="${toWing}", namespace="${ns}", and task="${task}".`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: "${name}"`);
  }

  async function handleJsonRpcMessage(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC 2.0 request',
        },
      };
    }

    const { id, method, params } = message;

    if (id === undefined) {
      return null;
    }

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion || '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: {
              name: '@kolivri/memoria-mcp',
              version: '1.0.0',
            },
          },
        };
      }

      if (method === 'ping') {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS,
          },
        };
      }

      if (method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: MCP_RESOURCES,
          },
        };
      }

      if (method === 'resources/read') {
        const uri = params?.uri;
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing resource "uri" parameter' },
          };
        }
        const resourceContent = readResource(uri);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [resourceContent],
          },
        };
      }

      if (method === 'prompts/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: MCP_PROMPTS,
          },
        };
      }

      if (method === 'prompts/get') {
        const promptName = params?.name;
        if (!promptName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing prompt "name" parameter' },
          };
        }
        const promptResult = getPrompt(promptName, params?.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: promptResult,
        };
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (!MCP_TOOLS.some((t) => t.name === toolName)) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Unknown tool: ${toolName}`,
            },
          };
        }

        try {
          const data = await callTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(data, null, 2),
                },
              ],
              structuredContent: data,
              isError: false,
            },
          };
        } catch (toolErr) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    { error: toolErr.message || String(toolErr) },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            },
          };
        }
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message || 'Internal JSON-RPC error',
        },
      };
    }
  }

  return {
    store,
    callTool,
    readResource,
    getPrompt,
    handleJsonRpcMessage,
  };
}

export function startMcpStdioServer({
  input = process.stdin,
  output = process.stdout,
  serviceOptions = {},
} = {}) {
  const service = createMemoriaMcpService(serviceOptions);
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  const writeResponse = (payload) => {
    if (payload !== null && payload !== undefined) {
      output.write(`${JSON.stringify(payload)}\n`);
    }
  };

  let queue = Promise.resolve();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    queue = queue.then(async () => {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        writeResponse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error: invalid JSON',
          },
        });
        return;
      }

      const response = await service.handleJsonRpcMessage(parsed);
      writeResponse(response);
    });
  });

  return {
    service,
    close: () => rl.close(),
  };
}

const isDirectExecution =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  startMcpStdioServer();
}
