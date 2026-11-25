import child_process from 'node:child_process';
import readline from 'node:readline';
import {
  sanitizeApiKey,
  resolveHomeDir,
  resolveEffectiveApiKey,
  resolveEffectiveApiUrl,
  saveMemorealConfig,
  configureDetectedIdes,
} from './config-store.mjs';

export function normalizeClientToolSlug(rawName) {
  if (typeof rawName !== 'string') return '';
  const trimmed = rawName.trim();
  if (/opencode/i.test(trimmed)) return 'opencode';
  if (/cursor/i.test(trimmed)) return 'cursor';
  if (/claude[-_\s]*code|claude[-_\s]*cli|^claude$/i.test(trimmed)) return 'claude-code';
  if (/visual\s*studio\s*code|\bvscode\b|vs[-_\s]*code|copilot/i.test(trimmed)) return 'vscode';
  if (/windsurf|codeium/i.test(trimmed)) return 'windsurf';
  if (/\bzed\b/i.test(trimmed)) return 'zed';
  if (/\bcodex\b/i.test(trimmed)) return 'codex';
  return '';
}

export function sanitizeClientName(rawName) {
  if (typeof rawName !== 'string') return '';
  return rawName
    .replace(/[^\w\s.+-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function sanitizeWorkspaceMetadata(workspace) {
  if (!workspace || typeof workspace !== 'object') {
    return undefined;
  }

  if (Array.isArray(workspace)) {
    return workspace
      .filter((item) => typeof item !== 'string' || !/^mem_(dev|live|start|biz|prod|test)_/i.test(item))
      .map((item) => (item && typeof item === 'object' ? sanitizeWorkspaceMetadata(item) : item));
  }

  const result = {};
  for (const [key, value] of Object.entries(workspace)) {
    if (/^(api_?key|raw_?key|secret|token|access_?token|authorization)$/i.test(key)) {
      continue;
    }
    if (typeof value === 'string' && /^mem_(dev|live|start|biz|prod|test)_/i.test(value)) {
      continue;
    }
    if (value && typeof value === 'object') {
      const sanitizedChild = sanitizeWorkspaceMetadata(value);
      if (sanitizedChild !== undefined) {
        result[key] = sanitizedChild;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function openUrlInBrowser(url, options = {}) {
  const env = options.env || process.env;
  if (env.MEMOREAL_NO_BROWSER === '1') {
    return false;
  }
  if (typeof url !== 'string' || !/^https?:\/\/[^\s"<>]+$/i.test(url.trim())) {
    return false;
  }

  const targetUrl = url.trim();
  const platform = options.platform || process.platform;
  const spawn = options.spawnImpl || child_process.spawn;

  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [targetUrl];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', targetUrl];
  } else {
    cmd = 'xdg-open';
    args = [targetUrl];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    if (child) {
      if (typeof child.on === 'function') {
        child.on('error', () => {});
      }
      if (typeof child.unref === 'function') {
        child.unref();
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function createConnectWizardController(options = {}) {
  const {
    getApiUrl,
    getExistingApiKey,
    getConnectedClientName,
    onApproved,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 15000,
    homeDir,
    env = process.env,
    spawnImpl,
    platform,
  } = options;

  let state = {
    status: 'not_started',
    device_code: null,
    user_code: null,
    verification_uri: null,
    verification_uri_complete: null,
    expiresAtMs: 0,
    workspace: null,
  };

  let activePollerTimer = null;
  let activeAbortController = null;

  function close() {
    if (activePollerTimer) {
      clearTimeout(activePollerTimer);
      activePollerTimer = null;
    }
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {}
      activeAbortController = null;
    }
  }

  function resolveApiUrl() {
    const rawUrl = typeof getApiUrl === 'function' ? getApiUrl() : getApiUrl;
    return resolveEffectiveApiUrl(rawUrl, { homeDir, env });
  }

  function resolveApiKey() {
    if (typeof getExistingApiKey === 'function') {
      return sanitizeApiKey(getExistingApiKey());
    }
    return sanitizeApiKey(getExistingApiKey) || resolveEffectiveApiKey('', { homeDir, env });
  }

  async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    if (typeof timeoutId?.unref === 'function') {
      timeoutId.unref();
    }
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: init.signal || controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function handleConnectAccount(args = {}) {
    const action = args?.action;
    const apiUrl = resolveApiUrl();

    // 1. Status action
    if (action === 'status') {
      if (state.status === 'waiting_for_browser' && Date.now() >= state.expiresAtMs) {
        state.status = 'expired';
      }

      if (state.status === 'connected') {
        return {
          status: 'connected',
          ...(state.workspace ? { workspace: state.workspace } : {}),
          message:
            'Memoreal is connected and ready with zero IDE restart! Present Step 3 of the 3-Click Wizard via AskUserQuestion (Claude Code) or question (OpenCode & Cursor): "Yes — Index repo now (Recommended)" vs "Later".',
        };
      }

      if (state.status === 'waiting_for_browser') {
        return {
          status: 'waiting_for_browser',
          user_code: state.user_code,
          verification_uri: state.verification_uri,
          verification_uri_complete: state.verification_uri_complete,
          message:
            'Waiting for browser authorization. Share the clickable verification link and present the "I clicked Authorize — Verify" card via AskUserQuestion / question calling connect_account({ action: "status" }).',
        };
      }

      if (state.status === 'denied') {
        return {
          status: 'denied',
          message:
            'Device pairing was denied. Present Step 1 via AskUserQuestion / question ("Connect in 1 Click via Google / Browser (Recommended)" vs "Skip for this session") or call connect_account({ action: "start" }) to retry.',
        };
      }

      if (state.status === 'expired') {
        return {
          status: 'expired',
          message:
            'Device authorization expired. Call connect_account({ action: "start" }) or run npx -y @kolivri/memoreal-mcp setup to generate a fresh code.',
        };
      }

      if (state.status === 'not_started') {
        const existingKey = resolveApiKey();
        if (existingKey) {
          try {
            const healthRes = await fetchWithTimeout(`${apiUrl}/v1/health`, {
              headers: { Authorization: `Bearer ${existingKey}` },
            });
            if (healthRes.ok) {
              return {
                status: 'connected',
                message:
                  'Memoreal is connected and ready. Offer Step 3 ("Yes — Index repo now (Recommended)" vs "Later") via AskUserQuestion / question if not yet indexed.',
              };
            }
          } catch {}
        }
        return {
          status: 'not_started',
          message:
            'Device pairing has not been started. Offer Step 1 ("Connect in 1 Click via Google / Browser (Recommended)" vs "Skip for this session") via AskUserQuestion / question.',
        };
      }
    }

    // 2. Action !== 'start' (action omitted or falsy): check already_connected
    if (action !== 'start') {
      const existingKey = resolveApiKey();
      if (existingKey) {
        try {
          const healthRes = await fetchWithTimeout(`${apiUrl}/v1/health`, {
            headers: { Authorization: `Bearer ${existingKey}` },
          });
          if (healthRes.ok) {
            return {
              status: 'already_connected',
              api_url: apiUrl,
              message: 'Memoreal is already connected and ready.',
            };
          }
        } catch {}
      }
    }

    // 3. Start flow
    close();

    const rawConnected = typeof getConnectedClientName === 'function' ? getConnectedClientName() : '';
    const connectedName = sanitizeClientName(rawConnected);
    const clientName = sanitizeClientName(args.client_name) || connectedName || 'Memoreal MCP';
    const toolSlug = normalizeClientToolSlug(args.client_name) || normalizeClientToolSlug(connectedName);

    const startPayload = {
      client_name: clientName,
      ...(toolSlug ? { tool: toolSlug } : {}),
    };

    const startRes = await fetchWithTimeout(`${apiUrl}/v1/auth/device/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(startPayload),
    });

    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => '');
      throw new Error(`Failed to start device authorization (${startRes.status}): ${errorText || startRes.statusText}`);
    }

    const startData = await startRes.json();
    const expiresIn = Number(startData.expires_in) || 600;
    const intervalSec = Number(startData.interval) || 2;
    const pollIntervalMs = Math.max(25, Math.round(intervalSec * 1000));
    const deviceCode = startData.device_code;

    state = {
      status: 'waiting_for_browser',
      device_code: deviceCode,
      user_code: startData.user_code,
      verification_uri: startData.verification_uri,
      verification_uri_complete: startData.verification_uri_complete,
      expiresAtMs: Date.now() + expiresIn * 1000,
      workspace: null,
    };

    let browserOpened = false;
    const shouldOpenBrowser = args.open_browser !== false && env.MEMOREAL_NO_BROWSER !== '1';
    if (shouldOpenBrowser) {
      const targetBrowserUrl = startData.verification_uri_complete || startData.verification_uri;
      if (targetBrowserUrl) {
        browserOpened = openUrlInBrowser(targetBrowserUrl, { env, platform, spawnImpl });
      }
    }

    const scheduleNextPoll = () => {
      if (activePollerTimer) {
        clearTimeout(activePollerTimer);
      }
      activePollerTimer = setTimeout(async () => {
        activePollerTimer = null;
        await executePoll();
      }, pollIntervalMs);
      if (typeof activePollerTimer?.unref === 'function') {
        activePollerTimer.unref();
      }
    };

    const executePoll = async () => {
      if (state.status !== 'waiting_for_browser') {
        return;
      }
      if (Date.now() >= state.expiresAtMs) {
        state.status = 'expired';
        return;
      }

      try {
        activeAbortController = new AbortController();
        const pollRes = await fetchImpl(`${apiUrl}/v1/auth/device/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode }),
          signal: activeAbortController.signal,
        });

        if (!pollRes.ok) {
          const errData = await pollRes.json().catch(() => ({}));
          const errCode = (errData.status || errData.error || '').toLowerCase();
          if (errCode === 'expired' || errCode === 'expired_token') {
            state.status = 'expired';
            return;
          }
          if (errCode === 'denied' || errCode === 'access_denied') {
            state.status = 'denied';
            return;
          }
          if (state.status === 'waiting_for_browser' && Date.now() < state.expiresAtMs) {
            scheduleNextPoll();
          }
          return;
        }

        const pollData = await pollRes.json();
        const pollStatus = (pollData.status || '').toLowerCase();

        if (pollStatus === 'approved') {
          const freshKey = sanitizeApiKey(pollData.api_key || pollData.apiKey);
          if (freshKey) {
            saveMemorealConfig({ apiKey: freshKey, apiUrl, homeDir, env });
            configureDetectedIdes({
              apiKey: freshKey,
              apiUrl,
              homeDir,
              env,
              preferredTool: toolSlug,
            });
            const cleanWs = sanitizeWorkspaceMetadata(pollData.workspace);
            state.status = 'connected';
            state.workspace = cleanWs;
            try {
              onApproved?.({ apiKey: freshKey, apiUrl, workspace: cleanWs });
            } catch {}
          }
          return;
        }

        if (pollStatus === 'denied' || pollStatus === 'access_denied') {
          state.status = 'denied';
          return;
        }

        if (pollStatus === 'expired' || pollStatus === 'expired_token' || Date.now() >= state.expiresAtMs) {
          state.status = 'expired';
          return;
        }

        if (state.status === 'waiting_for_browser' && Date.now() < state.expiresAtMs) {
          scheduleNextPoll();
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (state.status === 'waiting_for_browser' && Date.now() < state.expiresAtMs) {
          scheduleNextPoll();
        }
      } finally {
        activeAbortController = null;
      }
    };

    scheduleNextPoll();

    return {
      status: 'waiting_for_browser',
      user_code: startData.user_code,
      verification_uri: startData.verification_uri,
      verification_uri_complete: startData.verification_uri_complete,
      expires_in: expiresIn,
      browser_opened: Boolean(browserOpened),
      message:
        'Please ask the user nicely in chat to click the link (or check their opened browser tab) to sign in with Google or Email (1,000 free calls). Once they click Authorize, Memoreal connects automatically with zero copy-paste! Present Step 2 via AskUserQuestion (Claude Code) or question (OpenCode & Cursor): share the clickable link and show card "I clicked Authorize — Verify" calling connect_account({ action: "status" }).',
    };
  }

  return {
    handleConnectAccount,
    close,
  };
}

function createLineReader(input, output) {
  const rl = readline.createInterface({ input, output, terminal: false });
  const lineQueue = [];
  let pendingResolve = null;

  rl.on('line', (line) => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.on('close', () => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve('');
    }
  });

  return {
    async nextLine(promptText) {
      if (promptText) output.write(promptText);
      if (lineQueue.length > 0) {
        return lineQueue.shift();
      }
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
    close() {
      rl.close();
    },
  };
}

function promptHidden(promptText, input, output) {
  return new Promise((resolve) => {
    output.write(promptText);
    let password = '';
    const onData = (chunk) => {
      const str = chunk.toString('utf8');
      for (const char of str) {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          input.removeListener('data', onData);
          try {
            input.setRawMode(false);
          } catch {}
          output.write('\n');
          resolve(password.trim());
          return;
        }
        if (char === '\u0003') {
          input.removeListener('data', onData);
          try {
            input.setRawMode(false);
          } catch {}
          output.write('\n');
          process.exit(1);
        }
        if (char === '\u0008' || char === '\x7f') {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      }
    };

    try {
      input.setRawMode(true);
    } catch {}
    input.resume();
    input.on('data', onData);
  });
}

function printSummary(output, apiUrl, configPath, updatedIdes = []) {
  output.write('\n======================================================\n');
  output.write('   ✓ Memoreal Connected Successfully!\n');
  output.write('======================================================\n');
  output.write(`API URL:      ${apiUrl}\n`);
  output.write(`Config File:  ${configPath} (mode 0600)\n`);
  if (updatedIdes.length > 0) {
    const list = updatedIdes.map((i) => ` - ${i.file} (${i.status})`).join('\n');
    output.write(`Updated IDE Configurations:\n${list}\n`);
  } else {
    output.write('No existing IDE config files detected.\n');
  }
  output.write('======================================================\n\n');
}

export async function runCliSetupWizard(options = {}) {
  const {
    argv = process.argv.slice(2),
    input = process.stdin,
    output = process.stdout,
    fetchImpl = globalThis.fetch,
    homeDir,
    env = process.env,
    spawnImpl,
    platform,
  } = options;

  let rawArgs = [...argv];
  if (rawArgs[0] === 'setup' || rawArgs[0] === 'login' || rawArgs[0] === 'init') {
    rawArgs = rawArgs.slice(1);
  }

  let cliBrowser = null;
  let cliApiUrl = '';
  let cliKey = '';
  let cliTool = '';
  let showHelp = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--browser') {
      cliBrowser = true;
    } else if (arg === '--no-browser') {
      cliBrowser = false;
    } else if (arg === '--api-url' || arg === '--url') {
      cliApiUrl = rawArgs[++i] || '';
    } else if (arg.startsWith('--api-url=')) {
      cliApiUrl = arg.slice('--api-url='.length);
    } else if (arg.startsWith('--url=')) {
      cliApiUrl = arg.slice('--url='.length);
    } else if (arg === '--key') {
      cliKey = rawArgs[++i] || '';
    } else if (arg.startsWith('--key=')) {
      cliKey = arg.slice('--key='.length);
    } else if (arg === '--tool') {
      cliTool = rawArgs[++i] || '';
    } else if (arg.startsWith('--tool=')) {
      cliTool = arg.slice('--tool='.length);
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    }
  }

  if (showHelp) {
    output.write(
      'Usage: memoreal-mcp setup [options]\n\n' +
      'Options:\n' +
      '  --browser           Non-interactive browser OAuth device pairing\n' +
      '  --no-browser        Do not launch browser automatically\n' +
      '  --key <api-key>     Configure using an existing Memoreal API key\n' +
      '  --tool <slug>       Preferred IDE tool (cursor, opencode, claude-code, vscode, etc.)\n' +
      '  --api-url <url>     Custom Memoreal Cloud API URL\n' +
      '  --help, -h          Show this help message\n'
    );
    return { ok: true, help: true };
  }

  const effectiveApiUrl = resolveEffectiveApiUrl(cliApiUrl, { homeDir, env });
  const toolSlug = normalizeClientToolSlug(cliTool);

  let mode = null;
  let enteredKey = '';

  let reader = null;
  const getReader = () => {
    if (!reader) {
      reader = createLineReader(input, output);
    }
    return reader;
  };

  try {
    if (cliKey) {
      mode = 'key';
      enteredKey = cliKey;
    } else if (cliBrowser === true) {
      mode = 'browser';
    } else {
      output.write(
        '\n======================================================\n' +
        '       Memoreal Cloud Terminal Setup Wizard\n' +
        '======================================================\n\n' +
        'Choose sign-in method:\n' +
        '  [1] Sign in via Browser with Google / Email (Recommended — 1,000 free calls, zero copy-paste)\n' +
        '  [2] Enter an existing API key (hidden input)\n\n'
      );

      const choice = (await getReader().nextLine('Choice [1]: ')).trim();
      if (choice === '2') {
        mode = 'key';
      } else {
        mode = 'browser';
      }
    }

    if (mode === 'key') {
      if (!enteredKey) {
        if (!input.isTTY || typeof input.setRawMode !== 'function') {
          enteredKey = (await getReader().nextLine('Enter Memoreal API key: ')).trim();
        } else {
          if (reader) {
            reader.close();
            reader = null;
          }
          enteredKey = await promptHidden('Enter Memoreal API key: ', input, output);
        }
      }
    }
  } finally {
    if (reader) {
      reader.close();
      reader = null;
    }
  }

  if (mode === 'key') {
    const cleanKey = sanitizeApiKey(enteredKey);
    if (!cleanKey) {
      throw new Error('Invalid or empty Memoreal API key');
    }

    output.write('\nSaving configuration...\n');
    const saved = saveMemorealConfig({
      apiKey: cleanKey,
      apiUrl: effectiveApiUrl,
      homeDir,
      env,
    });
    const ides = configureDetectedIdes({
      apiKey: cleanKey,
      apiUrl: effectiveApiUrl,
      homeDir,
      env,
      preferredTool: toolSlug,
    });

    output.write('Verifying connection with Memoreal Cloud...\n');
    let workspace = null;
    try {
      const healthRes = await fetchImpl(`${effectiveApiUrl}/v1/health`, {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (healthRes.ok) {
        const healthJson = await healthRes.json().catch(() => ({}));
        workspace = sanitizeWorkspaceMetadata(healthJson.workspace);
      } else {
        output.write(`Warning: /v1/health returned status ${healthRes.status}\n`);
      }
    } catch (err) {
      output.write(`Warning: Failed to reach /v1/health: ${err.message}\n`);
    }

    printSummary(output, effectiveApiUrl, saved.configPath, ides.updated);

    return {
      ok: true,
      apiUrl: effectiveApiUrl,
      configPath: saved.configPath,
      updatedIdes: ides.updated,
      workspace,
    };
  }

  // mode === 'browser'
  output.write(`\nConnecting to ${effectiveApiUrl}...\n`);
  const clientName = 'Memoreal CLI';
  const startRes = await fetchImpl(`${effectiveApiUrl}/v1/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      ...(toolSlug ? { tool: toolSlug } : {}),
    }),
  });

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => '');
    throw new Error(`Failed to start device pairing (${startRes.status}): ${errText || startRes.statusText}`);
  }

  const startData = await startRes.json();
  const targetUrl = startData.verification_uri_complete || startData.verification_uri;

  output.write(
    '\nDevice pairing initialized:\n' +
    `  User Code:        ${startData.user_code}\n` +
    `  Verification URL: ${targetUrl}\n\n`
  );

  const autoOpenBrowser = cliBrowser !== false && env.MEMOREAL_NO_BROWSER !== '1';
  if (autoOpenBrowser && targetUrl) {
    output.write('Opening default browser for 1-click authorization...\n');
    openUrlInBrowser(targetUrl, { env, platform, spawnImpl });
  } else {
    output.write('Please open the verification URL in your browser to authorize.\n');
  }

  output.write('Waiting for authorization (press Ctrl+C to cancel)...\n');

  const intervalMs = Math.max(50, Math.round((Number(startData.interval) || 2) * 1000));
  const expiresAt = Date.now() + (Number(startData.expires_in) || 600) * 1000;
  let freshKey = '';
  let workspace = null;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const pollRes = await fetchImpl(`${effectiveApiUrl}/v1/auth/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: startData.device_code }),
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const status = (pollData.status || '').toLowerCase();
        if (status === 'approved') {
          freshKey = sanitizeApiKey(pollData.api_key || pollData.apiKey);
          workspace = sanitizeWorkspaceMetadata(pollData.workspace);
          break;
        }
        if (status === 'denied' || status === 'access_denied') {
          throw new Error('Device authorization was denied by user');
        }
        if (status === 'expired' || status === 'expired_token') {
          throw new Error('Device authorization code expired');
        }
      } else {
        const errJson = await pollRes.json().catch(() => ({}));
        const errStatus = (errJson.status || errJson.error || '').toLowerCase();
        if (errStatus === 'denied' || errStatus === 'access_denied') {
          throw new Error('Device authorization was denied by user');
        }
        if (errStatus === 'expired' || errStatus === 'expired_token') {
          throw new Error('Device authorization code expired');
        }
      }
    } catch (err) {
      if (err.message.includes('denied') || err.message.includes('expired')) {
        throw err;
      }
    }
  }

  if (!freshKey) {
    throw new Error('Device pairing timed out');
  }

  output.write('\nAuthorization confirmed!\n');
  const saved = saveMemorealConfig({
    apiKey: freshKey,
    apiUrl: effectiveApiUrl,
    homeDir,
    env,
  });
  const ides = configureDetectedIdes({
    apiKey: freshKey,
    apiUrl: effectiveApiUrl,
    homeDir,
    env,
    preferredTool: toolSlug,
  });

  output.write('Verifying connection with Memoreal Cloud...\n');
  try {
    const healthRes = await fetchImpl(`${effectiveApiUrl}/v1/health`, {
      headers: { Authorization: `Bearer ${freshKey}` },
    });
    if (!healthRes.ok) {
      output.write(`Warning: /v1/health returned status ${healthRes.status}\n`);
    }
  } catch (err) {
    output.write(`Warning: Failed to reach /v1/health: ${err.message}\n`);
  }

  printSummary(output, effectiveApiUrl, saved.configPath, ides.updated);

  return {
    ok: true,
    apiUrl: effectiveApiUrl,
    configPath: saved.configPath,
    updatedIdes: ides.updated,
    workspace,
  };
}
