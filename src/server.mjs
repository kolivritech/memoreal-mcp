#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOLS,
} from './schemas.mjs';
import {
  POLITE_ONBOARDING_ACTION,
  resolveEffectiveApiKey,
  resolveEffectiveApiUrl,
} from './config-store.mjs';
import {
  createConnectWizardController,
  runCliSetupWizard,
  sanitizeClientName,
} from './wizard.mjs';

const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof pkg?.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // Fallback below if package.json cannot be read
  }
  return '1.0.1';
})();

export function createMemorealMcpService(options = {}) {
  let runtimePairedApiKey = '';
  let connectedClientName = sanitizeClientName(options.clientName || '');
  const env = options.env || process.env;

  const getConfigOpts = () => ({
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    runtimePairedApiKey,
    homeDir: options.homeDir,
    configDir: options.configDir,
    disableConfigFileFallback: options.disableConfigFileFallback,
    env,
  });

  const getApiUrl = () => resolveEffectiveApiUrl('', getConfigOpts());

  const defaultNamespace = (
    options.namespace ??
    env.MEMOREAL_NAMESPACE ??
    env.MEMORIA_NAMESPACE ??
    'default'
  ).trim() || 'default';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = Number(
    options.requestTimeoutMs ??
    env.MEMOREAL_TIMEOUT_MS ??
    env.MEMORIA_TIMEOUT_MS ??
    15_000
  );

  function requireApiKey(overrideKey) {
    const key = resolveEffectiveApiKey(overrideKey, getConfigOpts());
    if (!key) {
      throw new Error(
        'Missing Memoreal API key: set MEMOREAL_API_KEY in environment or connect in 1 click. ' +
          POLITE_ONBOARDING_ACTION
      );
    }
    return key;
  }

  async function forwardCloudRpc(method, params, overrideKey) {
    const apiKey = requireApiKey(overrideKey);
    const apiUrl = getApiUrl();
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
      const detail =
        payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        responseText ||
        'Request failed';
      if (response.status === 401) {
        if (!overrideKey && runtimePairedApiKey) runtimePairedApiKey = '';
        throw new Error(
          'Memoreal Cloud API error (401): ' +
            detail +
            '. Missing Memoreal API key: set MEMOREAL_API_KEY or reconnect. ' +
            POLITE_ONBOARDING_ACTION
        );
      }
      throw new Error(`Memoreal Cloud API error (${response.status}): ${detail}`);
    }

    if (payload?.error) {
      throw new Error(payload.error.message || 'Memoreal Cloud RPC error');
    }

    return payload?.result ?? payload;
  }

  const wizard = createConnectWizardController({
    getApiUrl,
    getExistingApiKey: () => resolveEffectiveApiKey('', getConfigOpts()),
    getConnectedClientName: () => connectedClientName,
    onApproved: ({ apiKey }) => {
      runtimePairedApiKey = apiKey;
    },
    fetchImpl,
    requestTimeoutMs,
    homeDir: options.homeDir,
    env,
    spawnImpl: options.spawnImpl,
    platform: options.platform,
  });

  async function callTool(name, args = {}) {
    if (!MCP_TOOLS.some((t) => t.name === name)) {
      throw new Error(`Unknown tool: "${name}"`);
    }

    if (name === 'connect_account') {
      return await wizard.handleConnectAccount(args);
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
    if (name === 'memoreal-session-start' || name === 'memoria-session-start') {
      return {
        description: 'Load session context and check Memoreal Cloud health.',
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

    if (name === 'memoreal-wrap-up' || name === 'memoria-wrap-up') {
      return {
        description: 'Encode key session learnings and consolidate duplicate memories.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review the session using the Memoreal write gate, encode any lasting lessons or decisions via encode_memory in namespace "${ns}", and then run consolidate on "${ns}".`,
            },
          },
        ],
      };
    }

    if (name === 'memoreal-handoff' || name === 'memoria-handoff') {
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
        if (
          typeof params?.clientInfo?.name === 'string' &&
          params.clientInfo.name.trim()
        ) {
          connectedClientName = sanitizeClientName(params.clientInfo.name);
        }
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
              name: '@kolivri/memoreal-mcp',
              version: PACKAGE_VERSION,
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
    close: () => wizard.close(),
  };
}

export const createMemoriaMcpService = createMemorealMcpService;

export function startMcpStdioServer({
  input = process.stdin,
  output = process.stdout,
  serviceOptions = {},
} = {}) {
  const service = createMemorealMcpService(serviceOptions);
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

  rl.on('close', () => {
    try {
      service.close?.();
    } catch {}
  });

  return {
    service,
    close: () => {
      try {
        service.close?.();
      } catch {}
      rl.close();
    },
  };
}

const isDirectExecution = (() => {
  if (!process.argv[1]) return false;
  const selfPath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(selfPath);
  } catch {
    return path.resolve(process.argv[1]) === selfPath;
  }
})();

if (isDirectExecution) {
  const subCmd = (process.argv[2] || '').trim().toLowerCase();
  if (subCmd === 'setup' || subCmd === 'login' || subCmd === 'init') {
    runCliSetupWizard({ argv: process.argv.slice(2) })
      .then((res) => {
        if (!res?.ok) process.exitCode = 1;
      })
      .catch((err) => {
        console.error(err.message || String(err));
        process.exit(1);
      });
  } else {
    startMcpStdioServer();
  }
}
