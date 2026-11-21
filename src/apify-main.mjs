#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemorealMcpService, startMcpStdioServer } from './server.mjs';
import { MEMORY_TYPES } from './schemas.mjs';

export const VALID_ACTIONS = Object.freeze([
  'recall',
  'context',
  'encode',
  'search_code',
  'health',
  'standby_mcp',
]);

export function normalizeInput(rawInput = {}) {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const apiKey = (input.apiKey || process.env.MEMOREAL_API_KEY || process.env.MEMORIA_API_KEY || '').trim();
  const apiUrl = (input.apiUrl || process.env.MEMOREAL_API_URL || process.env.MEMORIA_API_URL || 'https://memoria.kolivri.com').trim();
  const namespace = (input.namespace || process.env.MEMOREAL_NAMESPACE || process.env.MEMORIA_NAMESPACE || 'default').trim() || 'default';
  const action = (input.action ?? 'context').trim();
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const type = MEMORY_TYPES.includes(input.type) ? input.type : 'episodic';
  const salience =
    typeof input.salience === 'number'
      ? Math.max(0, Math.min(1, input.salience))
      : Number.isFinite(Number(input.salience))
        ? Math.max(0, Math.min(1, Number(input.salience)))
        : 0.5;
  const tokenBudget =
    Number.isInteger(Number(input.tokenBudget)) && Number(input.tokenBudget) > 0
      ? Number(input.tokenBudget)
      : 4096;

  return {
    apiKey,
    apiUrl,
    namespace,
    action,
    query,
    content,
    type,
    salience,
    tokenBudget,
  };
}

function readStdin(timeoutMs = 150) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      resolve(data.trim() || null);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      data += chunk;
    };
    const onEnd = () => {
      clearTimeout(timer);
      cleanup();
      resolve(data.trim() || null);
    };
    const onError = () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    };
    function cleanup() {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    }

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
  });
}

export async function readApifyInput(explicitInput = null) {
  if (explicitInput && typeof explicitInput === 'object') {
    return explicitInput;
  }

  // 1. Try Actor from 'apify' package if installed
  try {
    const apifyMod = await import('apify');
    if (apifyMod?.Actor) {
      if (typeof apifyMod.Actor.isInitialized === 'function' && !apifyMod.Actor.isInitialized()) {
        await apifyMod.Actor.init();
      }
      const actorInput = await apifyMod.Actor.getInput();
      if (actorInput && typeof actorInput === 'object') {
        return actorInput;
      }
    }
  } catch {
    // Apify package not installed or not in Apify Actor container
  }

  // 2. Check environment variable JSON strings
  const envJsonStr = process.env.APIFY_INPUT_JSON || process.env.INPUT_JSON || process.env.APIFY_INPUT_KEY;
  if (envJsonStr) {
    try {
      const parsed = JSON.parse(envJsonStr);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Invalid JSON string in environment variable, continue
    }
  }

  // 3. Check storage paths
  const storageDir = process.env.APIFY_LOCAL_STORAGE_DIR || process.env.CRAWLEE_STORAGE_DIR;
  const candidatePaths = [
    ...(storageDir ? [path.resolve(storageDir, 'key_value_stores', 'default', 'INPUT.json')] : []),
    path.resolve(process.cwd(), 'apify_storage', 'key_value_stores', 'default', 'INPUT.json'),
    path.resolve(process.cwd(), 'INPUT.json'),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  // 4. Check stdin if piped
  if (!process.stdin.isTTY) {
    try {
      const stdinData = await readStdin(150);
      if (stdinData) {
        const parsed = JSON.parse(stdinData);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // Stdin not valid JSON
    }
  }

  return {};
}

export async function executeMemorealActorAction(rawInput = {}, options = {}) {
  const normalized = normalizeInput(rawInput);
  const { action, apiKey, apiUrl, namespace, query, content, type, salience, tokenBudget } = normalized;

  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(
      `Unsupported action: "${action}". Valid actions are: ${VALID_ACTIONS.join(', ')}.`
    );
  }

  if (action === 'standby_mcp') {
    const server = startMcpStdioServer({
      serviceOptions: {
        apiKey,
        apiUrl,
        namespace,
        fetchImpl: options.fetchImpl,
      },
      input: options.stdioInput || process.stdin,
      output: options.stdioOutput || process.stdout,
    });
    return {
      ok: true,
      action: 'standby_mcp',
      status: 'standby_mcp_running',
      namespace,
      server,
    };
  }

  const service = createMemorealMcpService({
    apiKey,
    apiUrl,
    namespace,
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  let result;
  switch (action) {
    case 'context': {
      result = await service.callTool('build_context', {
        query,
        namespace,
        token_budget: tokenBudget,
      });
      break;
    }
    case 'recall': {
      result = await service.callTool('recall_memories', {
        query,
        namespace,
        token_budget: tokenBudget,
      });
      break;
    }
    case 'encode': {
      if (!content) {
        throw new Error('Action "encode" requires non-empty "content" parameter.');
      }
      result = await service.callTool('encode_memory', {
        content,
        namespace,
        type,
        salience,
      });
      break;
    }
    case 'search_code': {
      result = await service.callTool('search_code', {
        query,
        namespace,
      });
      break;
    }
    case 'health': {
      result = await service.callTool('health', {});
      break;
    }
  }

  return {
    ok: true,
    action,
    namespace,
    result,
  };
}

export const executeMemoriaActorAction = executeMemorealActorAction;

export async function outputApifyResult(result) {
  // 1. Try Actor.setValue from 'apify' if available
  let actorValueSaved = false;
  try {
    const apifyMod = await import('apify');
    if (apifyMod?.Actor?.setValue) {
      await apifyMod.Actor.setValue('OUTPUT', result);
      actorValueSaved = true;
    }
  } catch {
    // Apify package not installed
  }

  // 2. Write to local storage directory if configured
  const storageDir = process.env.APIFY_LOCAL_STORAGE_DIR || process.env.CRAWLEE_STORAGE_DIR;
  if (storageDir) {
    try {
      const outputDir = path.resolve(storageDir, 'key_value_stores', 'default');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.resolve(outputDir, 'OUTPUT.json'), JSON.stringify(result, null, 2), 'utf8');
    } catch {
      // Ignore storage write error
    }
  }

  // 3. Log JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  return { actorValueSaved };
}

export async function main(options = {}) {
  const input = await readApifyInput(options.input);
  try {
    const result = await executeMemorealActorAction(input, options);

    if (result.action === 'standby_mcp') {
      return result;
    }

    await outputApifyResult(result);

    try {
      const apifyMod = await import('apify');
      if (apifyMod?.Actor?.exit) {
        await apifyMod.Actor.exit();
      }
    } catch {
      // Ignore
    }

    return result;
  } catch (err) {
    const errorPayload = {
      ok: false,
      error: err.message || String(err),
      action: input?.action || 'context',
    };
    await outputApifyResult(errorPayload);
    if (options.throwOnError) {
      throw err;
    }
    return errorPayload;
  }
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
  main().then((res) => {
    if (res && res.ok === false) {
      process.exitCode = 1;
    }
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
