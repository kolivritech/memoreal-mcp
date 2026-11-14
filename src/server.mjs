#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOLS,
} from './schemas.mjs';

export function createMemoriaMcpService(options = {}) {
  const apiUrl = (
    options.apiUrl ||
    process.env.MEMORIA_API_URL ||
    'https://memoria.kolivri.com'
  ).replace(/\/+$/, '');
  const defaultApiKey = (options.apiKey ?? process.env.MEMORIA_API_KEY ?? '').trim();
  const defaultNamespace = (options.namespace ?? process.env.MEMORIA_NAMESPACE ?? 'default').trim() || 'default';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? process.env.MEMORIA_TIMEOUT_MS ?? 15_000);

  function requireApiKey(overrideKey) {
    const key = (overrideKey || defaultApiKey || '').trim();
    if (!key) {
      throw new Error(
        'Missing Memoria API key: set MEMORIA_API_KEY in environment (get your key at https://memoria.kolivri.com/register).'
      );
    }
    return key;
  }

  async function forwardCloudRpc(method, params, overrideKey) {
    const apiKey = requireApiKey(overrideKey);
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
        id: `mem_${Date.now()}`,
        method,
        params,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    const responseText = await response.text();
    let payload = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { raw: responseText };
      }
    }

    if (!response.ok) {
      throw new Error(
        `Memoria Cloud API error (${response.status}): ${payload?.error?.message || payload?.error || payload?.message || responseText || 'Request failed'}`
      );
    }

    if (payload?.error) {
      throw new Error(payload.error.message || 'Memoria Cloud RPC error');
    }

    return payload?.result ?? payload;
  }

  async function callTool(name, args = {}) {
    if (!MCP_TOOLS.some((t) => t.name === name)) {
      throw new Error(`Unknown tool: "${name}"`);
    }

    const normalizedArgs = { ...args };
    if (name === 'explain_code') {
      const targetStr = typeof args.target === 'string' ? args.target.trim() : '';
      const symbolStr = typeof args.symbol === 'string' ? args.symbol.trim() : '';
      const sym = targetStr || symbolStr;
      if (!sym) {
        throw new Error('explain_code requires a non-empty string "target" or "symbol" parameter');
      }
      normalizedArgs.target = sym;
      normalizedArgs.symbol = sym;
    }

    const enrichedArgs = {
      ...normalizedArgs,
      ...(normalizedArgs.namespace === undefined && name !== 'health' ? { namespace: defaultNamespace } : {}),
    };

    const result = await forwardCloudRpc(
      'tools/call',
      {
        name,
        arguments: enrichedArgs,
      },
      args.apiKey
    );

    const textBlock = result?.content?.[0]?.text;
    if (textBlock) {
      try {
        return JSON.parse(textBlock);
      } catch {
        return { raw: textBlock };
      }
    }
    return result;
  }

  async function readResource(uri) {
    if (!MCP_RESOURCES.some((r) => r.uri === uri)) {
      throw new Error(`Unknown resource URI: "${uri}"`);
    }

    const result = await forwardCloudRpc('resources/read', { uri });
    if (Array.isArray(result?.contents) && result.contents[0]) {
      return result.contents[0];
    }
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2),
    };
  }

  function getPrompt(name, promptArgs = {}) {
    const ns = promptArgs.namespace || defaultNamespace;
    if (name === 'memoria-session-start') {
      return {
        description: 'Load session context and check Memoria Cloud health.',
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
        const requestedProto =
          typeof params?.protocolVersion === 'string' && params.protocolVersion.trim()
            ? params.protocolVersion.trim()
            : '2024-11-05';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: requestedProto,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: {
              name: '@kolivri/memoria-mcp',
              version: '1.0.0',
            },
            instructions: MCP_SERVER_INSTRUCTIONS,
          },
        };
      }

      if (method === 'initialized' || method === 'notifications/initialized') {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
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
        const resourceContent = await readResource(uri);
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
