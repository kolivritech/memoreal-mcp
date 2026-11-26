import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const POLITE_ONBOARDING_ACTION =
  'Polite Onboarding Action: Invite the user in chat to connect their free Memoreal account (1,000 free API calls & memories) in 1 click by calling the connect_account tool (opens Chrome OAuth automatically, zero copy-paste), or share https://memoreal.kolivri.com/connect (terminal wizard: npx -y @kolivri/memoreal-mcp setup). Never ask the user to paste their raw API key into chat.\n\n' +
  'Drive the 3-Click Interactive In-Chat Wizard using AskUserQuestion (Claude Code) or question (OpenCode & Cursor):\n' +
  '- Step 1: Present choice card "Connect in 1 Click via Google / Browser (Recommended)" vs "Skip for this session".\n' +
  '- Step 2: Call connect_account({ action: "start" }) and present clickable https://memoreal.kolivri.com/connect?code=XXXX-YYYY link with "I clicked Authorize — Verify" card (calling connect_account({ action: "status" })).\n' +
  '- Step 3: Once connected, present choice card "Yes — Index repo now (Recommended)" vs "Later".';

export const ONBOARDING_WIZARD_PROMPT = POLITE_ONBOARDING_ACTION;

export function isPlaceholderApiKey(raw) {
  if (typeof raw !== 'string') return true;
  let str = raw.trim();
  while ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  if (!str) return true;
  if (str.includes('...')) return true;
  if (str.startsWith('<') && str.endsWith('>')) return true;
  if (str.startsWith('${') && str.endsWith('}')) return true;
  const lower = str.toLowerCase();
  if (
    lower === 'mem_dev_your_key_here' ||
    lower === 'your_api_key' ||
    lower === 'your-api-key' ||
    lower === 'your-memoreal-api-key' ||
    lower === 'your_memoreal_api_key' ||
    lower === 'placeholder' ||
    lower.includes('your_key_here') ||
    lower.includes('your_api_key') ||
    lower.includes('your-api-key') ||
    lower.includes('your-memoreal-api-key')
  ) {
    return true;
  }
  return false;
}

export function sanitizeApiKey(raw) {
  if (typeof raw !== 'string') return '';
  let str = raw.trim();
  while ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  if (isPlaceholderApiKey(str)) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(str)) return '';
  return str;
}

export function resolveHomeDir(options = {}) {
  return options.homeDir || options.env?.MEMOREAL_HOME || process.env.MEMOREAL_HOME || os.homedir();
}

export function normalizeApiUrl(raw) {
  if (typeof raw !== 'string') return '';
  let url = raw.trim();
  while ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  if (!url) return '';
  url = url.replace(/\/v1\/mcp\/?$/i, '');
  url = url.replace(/\/+$/, '');
  if (!url) return '';

  if (/[\"$`\\\s<>]|\x27/.test(url)) {
    return '';
  }

  const isHttps = /^https:\/\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._/-]*)?$/i.test(url);
  const isLoopbackHttp = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[A-Za-z0-9._/-]*)?$/i.test(url);

  if (!isHttps && !isLoopbackHttp) {
    return '';
  }

  return url;
}

export function parseConfigEnv(content) {
  const result = {};
  if (typeof content !== 'string') return result;
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cleanLine = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIdx = cleanLine.indexOf('=');
    if (eqIdx === -1) continue;
    const key = cleanLine.slice(0, eqIdx).trim();
    let val = cleanLine.slice(eqIdx + 1).trim();
    while ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    result[key] = val;
  }
  return result;
}

export function readSavedMemorealConfig(options = {}) {
  const env = options.env || process.env;
  let candidates = [];

  const configDir = options.configDir || env.MEMOREAL_CONFIG_DIR;
  const explicitHome = options.homeDir || env.MEMOREAL_HOME;

  if (configDir) {
    candidates = [path.join(configDir, 'config.env')];
  } else if (explicitHome) {
    candidates = [
      path.join(explicitHome, '.memoreal', 'config.env'),
      path.join(explicitHome, '.memoria', 'config.env'),
    ];
  } else {
    const home = os.homedir();
    candidates = [
      path.join(home, '.memoreal', 'config.env'),
      path.join(home, '.memoria', 'config.env'),
    ];
  }

  let firstFound = null;

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8');
        const parsed = parseConfigEnv(content);
        const apiKey =
          sanitizeApiKey(parsed.MEMOREAL_API_KEY) ||
          sanitizeApiKey(parsed.MEMOREAL_KEY) ||
          sanitizeApiKey(parsed.MEMORIA_API_KEY) ||
          sanitizeApiKey(parsed.MEMORIA_KEY);
        const rawUrl =
          parsed.MEMOREAL_API_URL ||
          parsed.MEMOREAL_URL ||
          parsed.MEMORIA_API_URL ||
          parsed.MEMORIA_URL ||
          '';
        const apiUrl = normalizeApiUrl(rawUrl);
        const entry = { apiKey, apiUrl, configPath: candidate };
        if (apiKey) {
          return entry;
        }
        if (!firstFound) {
          firstFound = entry;
        }
      }
    } catch {
      // Continue searching next candidate
    }
  }

  return firstFound || { apiKey: '', apiUrl: '', configPath: null };
}

export function resolveEffectiveApiKey(overrideKey, options = {}) {
  const env = options.env || process.env;

  const key1 = sanitizeApiKey(overrideKey);
  if (key1) return key1;

  const key2 = sanitizeApiKey(options.runtimePairedApiKey);
  if (key2) return key2;

  const key3 = sanitizeApiKey(options.apiKey);
  if (key3) return key3;

  const key4 =
    sanitizeApiKey(env.MEMOREAL_API_KEY) ||
    sanitizeApiKey(env.MEMOREAL_KEY) ||
    sanitizeApiKey(env.MEMORIA_API_KEY) ||
    sanitizeApiKey(env.MEMORIA_KEY);
  if (key4) return key4;

  const isExplicitEmptyAmbientKey =
    'MEMOREAL_API_KEY' in env &&
    env.MEMOREAL_API_KEY === '' &&
    !options.homeDir &&
    !options.configDir &&
    !env.MEMOREAL_CONFIG_DIR &&
    !env.MEMOREAL_HOME;

  if (options.disableConfigFileFallback === true || isExplicitEmptyAmbientKey) {
    return '';
  }

  const saved = readSavedMemorealConfig(options);
  return saved.apiKey || '';
}

export function resolveEffectiveApiUrl(overrideUrl, options = {}) {
  const env = options.env || process.env;

  const url1 = normalizeApiUrl(overrideUrl);
  if (url1) return url1;

  const url2 = normalizeApiUrl(options.apiUrl);
  if (url2) return url2;

  const url3 = normalizeApiUrl(env.MEMOREAL_API_URL || env.MEMOREAL_URL);
  if (url3) return url3;

  const url4 = normalizeApiUrl(env.MEMORIA_API_URL || env.MEMORIA_URL);
  if (url4) return url4;

  const isExplicitEmptyAmbientKey =
    'MEMOREAL_API_KEY' in env &&
    env.MEMOREAL_API_KEY === '' &&
    !options.homeDir &&
    !options.configDir &&
    !env.MEMOREAL_CONFIG_DIR &&
    !env.MEMOREAL_HOME;

  if (options.disableConfigFileFallback !== true && !isExplicitEmptyAmbientKey) {
    const saved = readSavedMemorealConfig(options);
    if (saved.apiUrl) {
      return saved.apiUrl;
    }
  }

  return 'https://memoria.kolivri.com';
}

export function saveMemorealConfig({ apiKey, apiUrl, homeDir, env, configDir } = {}) {
  const cleanKey = sanitizeApiKey(apiKey);
  if (!cleanKey) {
    throw new Error('Cannot save empty or placeholder Memoreal API key');
  }

  if (apiUrl !== undefined && String(apiUrl).trim() !== '' && !normalizeApiUrl(String(apiUrl))) {
    throw new Error('Invalid or insecure Memoreal API URL');
  }

  const resolvedHome = resolveHomeDir({ homeDir, env });
  const cleanUrl = resolveEffectiveApiUrl(apiUrl, { homeDir, env });
  const mcpUrl = cleanUrl.endsWith('/v1/mcp') ? cleanUrl : `${cleanUrl}/v1/mcp`;

  const configContent =
    `MEMOREAL_URL="${mcpUrl}"\n` +
    `MEMOREAL_API_URL="${cleanUrl}"\n` +
    `MEMOREAL_API_KEY="${cleanKey}"\n` +
    `MEMORIA_URL="${mcpUrl}"\n` +
    `MEMORIA_API_URL="${cleanUrl}"\n` +
    `MEMORIA_API_KEY="${cleanKey}"\n`;

  const writtenPaths = [];

  function writeConfigFile(targetDir) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(targetDir, 0o700);
    } catch {}

    const targetFile = path.join(targetDir, 'config.env');
    if (fs.existsSync(targetFile)) {
      const bakFile = targetFile + '.bak';
      fs.copyFileSync(targetFile, bakFile);
      try {
        fs.chmodSync(bakFile, 0o600);
      } catch {}
    }

    fs.writeFileSync(targetFile, configContent, { mode: 0o600 });
    try {
      fs.chmodSync(targetFile, 0o600);
    } catch {}
    writtenPaths.push(targetFile);
    return targetFile;
  }

  const memorealDir = path.join(resolvedHome, '.memoreal');
  const memoriaDir = path.join(resolvedHome, '.memoria');

  const primaryFile = writeConfigFile(memorealDir);

  let isSameDir = false;
  try {
    if (fs.existsSync(memoriaDir)) {
      const realMemoreal = fs.realpathSync(memorealDir);
      const realMemoria = fs.realpathSync(memoriaDir);
      if (realMemoreal === realMemoria) {
        isSameDir = true;
      }
    }
  } catch {}

  if (!isSameDir) {
    writeConfigFile(memoriaDir);
  }

  const extraDir = configDir || env?.MEMOREAL_CONFIG_DIR;
  if (extraDir) {
    writeConfigFile(extraDir);
  }

  return {
    apiKey: cleanKey,
    apiUrl: cleanUrl,
    configPath: primaryFile,
    writtenPaths,
  };
}

export function configureDetectedIdes({ apiKey, apiUrl, homeDir, env, preferredTool } = {}) {
  const cleanKey = sanitizeApiKey(apiKey);
  const resolvedHome = resolveHomeDir({ homeDir, env });
  const cleanUrl = resolveEffectiveApiUrl(apiUrl, { homeDir, env });
  const mcpUrl = cleanUrl.endsWith('/v1/mcp') ? cleanUrl : `${cleanUrl}/v1/mcp`;

  const updated = [];
  const normalizedPreferred = (preferredTool || '').toLowerCase().trim();

  function writeIdeJson(filePath, newObj, isCreate) {
    if (!isCreate && fs.existsSync(filePath)) {
      const bakPath = filePath + '.bak';
      fs.copyFileSync(filePath, bakPath);
      try {
        fs.chmodSync(bakPath, 0o600);
      } catch {}
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(newObj, null, 2) + '\n', { mode: 0o600 });
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}
    updated.push({ file: filePath, status: isCreate ? 'created' : 'updated' });
  }

  function readIdeJson(filePath) {
    if (!fs.existsSync(filePath)) {
      return { parsed: null, isCreate: true, malformed: false };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { parsed: null, isCreate: false, malformed: true };
      }
      return { parsed, isCreate: false, malformed: false };
    } catch {
      return { parsed: null, isCreate: false, malformed: true };
    }
  }

  // 1. OpenCode: <resolvedHome>/.config/opencode/opencode.json
  const opencodePath = path.join(resolvedHome, '.config', 'opencode', 'opencode.json');
  const opencodeDir = path.dirname(opencodePath);
  const shouldTouchOpencode =
    fs.existsSync(opencodePath) ||
    fs.existsSync(opencodeDir) ||
    normalizedPreferred === 'opencode';

  if (shouldTouchOpencode) {
    const { parsed, isCreate, malformed } = readIdeJson(opencodePath);
    if (malformed) {
      updated.push({ file: opencodePath, status: 'skipped_malformed_json' });
    } else {
      const config = parsed || {
        '$schema': 'https://opencode.ai/config.json',
        mcp: {},
      };
      config.mcp = config.mcp || {};
      if (config.mcp.memoreal && config.mcp.memoreal.type === 'local') {
        config.mcp.memoreal.environment = config.mcp.memoreal.environment || {};
        if (cleanKey) {
          config.mcp.memoreal.environment.MEMOREAL_API_KEY = cleanKey;
          config.mcp.memoreal.environment.MEMORIA_API_KEY = cleanKey;
        }
      } else {
        const memorealEntry = {
          type: 'remote',
          url: mcpUrl,
          enabled: true,
        };
        if (cleanKey) {
          memorealEntry.headers = { Authorization: `Bearer ${cleanKey}` };
        }
        config.mcp.memoreal = {
          ...(config.mcp.memoreal || {}),
          ...memorealEntry,
        };
      }
      if (config.mcpServers?.memoreal) {
        delete config.mcpServers.memoreal;
        if (Object.keys(config.mcpServers).length === 0) {
          delete config.mcpServers;
        }
      }
      writeIdeJson(opencodePath, config, isCreate);
    }
  }

  // Helper for IDEs using .mcpServers.memoreal
  function handleMcpServersIde(filePath, shouldTouch) {
    if (!shouldTouch) return;
    const { parsed, isCreate, malformed } = readIdeJson(filePath);
    if (malformed) {
      updated.push({ file: filePath, status: 'skipped_malformed_json' });
      return;
    }
    const config = parsed || { mcpServers: {} };
    config.mcpServers = config.mcpServers || {};

    const existing = config.mcpServers.memoreal;
    if (existing && (existing.command || existing.type === 'stdio' || (!existing.type && existing.command))) {
      config.mcpServers.memoreal.env = config.mcpServers.memoreal.env || {};
      if (cleanKey) {
        config.mcpServers.memoreal.env.MEMOREAL_API_KEY = cleanKey;
        config.mcpServers.memoreal.env.MEMORIA_API_KEY = cleanKey;
      }
    } else {
      const memorealEntry = {
        type: 'http',
        url: mcpUrl,
      };
      if (cleanKey) {
        memorealEntry.headers = { Authorization: `Bearer ${cleanKey}` };
      }
      config.mcpServers.memoreal = {
        ...(existing || {}),
        ...memorealEntry,
      };
    }
    writeIdeJson(filePath, config, isCreate);
  }

  // 2. Cursor: <resolvedHome>/.cursor/mcp.json
  const cursorPath = path.join(resolvedHome, '.cursor', 'mcp.json');
  const shouldTouchCursor =
    fs.existsSync(cursorPath) ||
    fs.existsSync(path.dirname(cursorPath)) ||
    normalizedPreferred === 'cursor';
  handleMcpServersIde(cursorPath, shouldTouchCursor);

  // Windsurf: <resolvedHome>/.codeium/windsurf/mcp_config.json
  const windsurfPath = path.join(resolvedHome, '.codeium', 'windsurf', 'mcp_config.json');
  const shouldTouchWindsurf =
    fs.existsSync(windsurfPath) ||
    fs.existsSync(path.dirname(windsurfPath)) ||
    normalizedPreferred === 'windsurf';
  handleMcpServersIde(windsurfPath, shouldTouchWindsurf);

  // VS Code: <resolvedHome>/.vscode/mcp.json
  const vscodePath = path.join(resolvedHome, '.vscode', 'mcp.json');
  const shouldTouchVscode =
    fs.existsSync(vscodePath) ||
    fs.existsSync(path.dirname(vscodePath)) ||
    normalizedPreferred === 'vscode';
  handleMcpServersIde(vscodePath, shouldTouchVscode);

  // Claude Desktop:
  const claudeDesktopPaths = [
    path.join(resolvedHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(resolvedHome, '.config', 'Claude', 'claude_desktop_config.json'),
    path.join(resolvedHome, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  ];
  for (const desktopPath of claudeDesktopPaths) {
    const shouldTouchDesktop =
      fs.existsSync(desktopPath) ||
      fs.existsSync(path.dirname(desktopPath));
    if (shouldTouchDesktop) {
      handleMcpServersIde(desktopPath, true);
    }
  }

  // Codex CLI: <resolvedHome>/.codex/mcp.json
  const codexPath = path.join(resolvedHome, '.codex', 'mcp.json');
  const shouldTouchCodex =
    fs.existsSync(codexPath) ||
    fs.existsSync(path.dirname(codexPath)) ||
    normalizedPreferred === 'codex';
  if (shouldTouchCodex) {
    handleMcpServersIde(codexPath, true);
  }

  // 3. Claude Code: <resolvedHome>/.claude.json (ONLY if already exists!)
  const claudeCodePath = path.join(resolvedHome, '.claude.json');
  if (fs.existsSync(claudeCodePath)) {
    handleMcpServersIde(claudeCodePath, true);
  }

  return { updated };
}
