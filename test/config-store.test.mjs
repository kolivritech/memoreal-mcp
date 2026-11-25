import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  POLITE_ONBOARDING_ACTION,
  ONBOARDING_WIZARD_PROMPT,
  isPlaceholderApiKey,
  sanitizeApiKey,
  resolveHomeDir,
  normalizeApiUrl,
  parseConfigEnv,
  readSavedMemorealConfig,
  resolveEffectiveApiKey,
  resolveEffectiveApiUrl,
  saveMemorealConfig,
  configureDetectedIdes,
} from '../src/config-store.mjs';

describe('config-store', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-config-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('POLITE_ONBOARDING_ACTION & ONBOARDING_WIZARD_PROMPT', () => {
    it('matches exact required prefix and guidance', () => {
      const expectedPrefix =
        'Polite Onboarding Action: Invite the user in chat to connect their free Memoreal account (1,000 free API calls & memories) in 1 click by calling the connect_account tool (opens Chrome OAuth automatically, zero copy-paste), or share https://memoreal.kolivri.com/connect (terminal wizard: npx -y @kolivri/memoreal-mcp setup). Never ask the user to paste their raw API key into chat.';
      assert.ok(
        POLITE_ONBOARDING_ACTION.startsWith(expectedPrefix),
        'Must start with exact required prefix'
      );
      assert.match(POLITE_ONBOARDING_ACTION, /AskUserQuestion/);
      assert.match(POLITE_ONBOARDING_ACTION, /question/);
      assert.match(POLITE_ONBOARDING_ACTION, /Connect in 1 Click via Google \/ Browser \(Recommended\)/);
      assert.match(POLITE_ONBOARDING_ACTION, /Skip for this session/);
      assert.match(POLITE_ONBOARDING_ACTION, /connect_account\(\{ action: "start" \}\)/);
      assert.match(POLITE_ONBOARDING_ACTION, /I clicked Authorize — Verify/);
      assert.match(POLITE_ONBOARDING_ACTION, /Yes — Index repo now \(Recommended\)/);
      assert.equal(ONBOARDING_WIZARD_PROMPT, POLITE_ONBOARDING_ACTION);
    });
  });

  describe('isPlaceholderApiKey & sanitizeApiKey', () => {
    it('identifies placeholder keys and empty strings as placeholders', () => {
      const placeholders = [
        '',
        '   ',
        null,
        undefined,
        'mem_dev_your_key_here',
        'MEM_DEV_YOUR_KEY_HERE',
        '"mem_dev_your_key_here"',
        "'mem_dev_your_key_here'",
        'mem_dev_...',
        'YOUR_API_KEY',
        'your_api_key',
        'your-api-key',
        '<MEMOREAL_API_KEY>',
        '<MEMORIA_API_KEY>',
        '${MEMOREAL_API_KEY}',
        'your-memoreal-api-key',
        'mem_dev_abc...xyz',
        '"YOUR_API_KEY"',
      ];

      for (const ph of placeholders) {
        assert.equal(
          isPlaceholderApiKey(ph),
          true,
          `Expected isPlaceholderApiKey(${JSON.stringify(ph)}) to be true`
        );
        assert.equal(
          sanitizeApiKey(ph),
          '',
          `Expected sanitizeApiKey(${JSON.stringify(ph)}) to be empty string`
        );
      }
    });

    it('sanitizes valid keys by stripping surrounding quotes and whitespace', () => {
      assert.equal(sanitizeApiKey('mem_dev_valid_123'), 'mem_dev_valid_123');
      assert.equal(sanitizeApiKey('  "mem_dev_valid_123"  '), 'mem_dev_valid_123');
      assert.equal(sanitizeApiKey("  'mem_dev_valid_123'  "), 'mem_dev_valid_123');
      assert.equal(isPlaceholderApiKey('mem_dev_valid_123'), false);
    });
  });

  describe('resolveHomeDir', () => {
    it('honors options.homeDir, then options.env.MEMOREAL_HOME, then process.env.MEMOREAL_HOME, then os.homedir', () => {
      assert.equal(resolveHomeDir({ homeDir: '/custom/home' }), '/custom/home');
      assert.equal(
        resolveHomeDir({ env: { MEMOREAL_HOME: '/env/home' } }),
        '/env/home'
      );
      const orig = process.env.MEMOREAL_HOME;
      try {
        process.env.MEMOREAL_HOME = '/proc/home';
        assert.equal(resolveHomeDir({}), '/proc/home');
        assert.equal(resolveHomeDir({ homeDir: '/override/home' }), '/override/home');
      } finally {
        if (orig === undefined) {
          delete process.env.MEMOREAL_HOME;
        } else {
          process.env.MEMOREAL_HOME = orig;
        }
      }
    });
  });

  describe('normalizeApiUrl', () => {
    it('strips trailing /v1/mcp and trailing slashes and quotes', () => {
      assert.equal(
        normalizeApiUrl('https://memoria.kolivri.com/v1/mcp'),
        'https://memoria.kolivri.com'
      );
      assert.equal(
        normalizeApiUrl('https://memoria.kolivri.com/v1/mcp/'),
        'https://memoria.kolivri.com'
      );
      assert.equal(
        normalizeApiUrl('"https://memoria.kolivri.com///"'),
        'https://memoria.kolivri.com'
      );
      assert.equal(
        normalizeApiUrl('https://api.custom.com'),
        'https://api.custom.com'
      );
    });
  });

  describe('parseConfigEnv', () => {
    it('correctly parses key-value pairs ignoring comments and export prefix', () => {
      const raw = `
        # Comment line
        export MEMOREAL_URL="https://memoria.kolivri.com/v1/mcp"
        MEMOREAL_API_URL="https://memoria.kolivri.com"
        MEMOREAL_API_KEY="mem_dev_key_abc"
      `;
      const parsed = parseConfigEnv(raw);
      assert.equal(parsed.MEMOREAL_URL, 'https://memoria.kolivri.com/v1/mcp');
      assert.equal(parsed.MEMOREAL_API_URL, 'https://memoria.kolivri.com');
      assert.equal(parsed.MEMOREAL_API_KEY, 'mem_dev_key_abc');
    });
  });

  describe('readSavedMemorealConfig & resolveEffectiveApiKey test isolation', () => {
    it('reads isolated homeDir config without touching os.homedir', () => {
      const isolatedMemoreal = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(isolatedMemoreal, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoreal, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_isolated_key"\nMEMOREAL_API_URL="https://isolated.url"\n'
      );

      const config = readSavedMemorealConfig({ homeDir: tmpDir });
      assert.equal(config.apiKey, 'mem_dev_isolated_key');
      assert.equal(config.apiUrl, 'https://isolated.url');
      assert.equal(config.configPath, path.join(isolatedMemoreal, 'config.env'));
    });

    it('falls back to .memoria/config.env if .memoreal does not exist', () => {
      const isolatedMemoria = path.join(tmpDir, '.memoria');
      fs.mkdirSync(isolatedMemoria, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoria, 'config.env'),
        'MEMORIA_API_KEY="mem_dev_legacy_key"\nMEMORIA_API_URL="https://legacy.url"\n'
      );

      const config = readSavedMemorealConfig({ homeDir: tmpDir });
      assert.equal(config.apiKey, 'mem_dev_legacy_key');
      assert.equal(config.apiUrl, 'https://legacy.url');
      assert.equal(config.configPath, path.join(isolatedMemoria, 'config.env'));
    });

    it('honors configDir over homeDir', () => {
      const customDir = path.join(tmpDir, 'custom-cfg');
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(
        path.join(customDir, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_custom_key"\n'
      );

      const config = readSavedMemorealConfig({ configDir: customDir, homeDir: tmpDir });
      assert.equal(config.apiKey, 'mem_dev_custom_key');
      assert.equal(config.configPath, path.join(customDir, 'config.env'));
    });

    it('resolveEffectiveApiKey checks priority overrideKey -> runtimePairedApiKey -> options.apiKey -> env', () => {
      const env = { MEMOREAL_API_KEY: 'mem_dev_env' };
      assert.equal(
        resolveEffectiveApiKey('mem_dev_override', {
          runtimePairedApiKey: 'mem_dev_paired',
          apiKey: 'mem_dev_opt',
          env,
        }),
        'mem_dev_override'
      );

      assert.equal(
        resolveEffectiveApiKey(undefined, {
          runtimePairedApiKey: 'mem_dev_paired',
          apiKey: 'mem_dev_opt',
          env,
        }),
        'mem_dev_paired'
      );

      assert.equal(
        resolveEffectiveApiKey(undefined, {
          apiKey: 'mem_dev_opt',
          env,
        }),
        'mem_dev_opt'
      );

      assert.equal(
        resolveEffectiveApiKey(undefined, { env }),
        'mem_dev_env'
      );
    });

    it('ignores placeholder keys in env and falls through to saved config', () => {
      const isolatedMemoreal = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(isolatedMemoreal, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoreal, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_persisted_key"\n'
      );

      const env = { MEMOREAL_API_KEY: 'mem_dev_your_key_here' };
      const resolved = resolveEffectiveApiKey(undefined, {
        homeDir: tmpDir,
        env,
      });
      assert.equal(resolved, 'mem_dev_persisted_key');
    });

    it('falls back from placeholder MEMOREAL_API_KEY to valid MEMORIA_API_KEY in env', () => {
      const env = {
        MEMOREAL_API_KEY: 'mem_dev_your_key_here',
        MEMORIA_API_KEY: 'mem_dev_valid_legacy_999',
      };
      const resolved = resolveEffectiveApiKey(undefined, { env });
      assert.equal(resolved, 'mem_dev_valid_legacy_999');
    });

    it('falls back from placeholder MEMOREAL_API_KEY to valid MEMORIA_API_KEY in saved config', () => {
      const isolatedMemoreal = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(isolatedMemoreal, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoreal, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_your_key_here"\nMEMORIA_API_KEY="mem_dev_saved_legacy_key"\n'
      );

      const config = readSavedMemorealConfig({ homeDir: tmpDir });
      assert.equal(config.apiKey, 'mem_dev_saved_legacy_key');
    });

    it('honors explicit empty MEMOREAL_API_KEY === "" in ambient env by returning empty string without reading config', () => {
      const isolatedMemoreal = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(isolatedMemoreal, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoreal, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_persisted_key"\n'
      );

      // When ambient (no homeDir/configDir/MEMOREAL_HOME), MEMOREAL_API_KEY === '' isolates tests
      const env = { MEMOREAL_API_KEY: '' };
      const resolved = resolveEffectiveApiKey(undefined, { env });
      assert.equal(resolved, '');

      // But when homeDir is explicitly provided (isolated test harness), it reads the test home
      const isolatedResolved = resolveEffectiveApiKey(undefined, {
        homeDir: tmpDir,
        env,
      });
      assert.equal(isolatedResolved, 'mem_dev_persisted_key');
    });

    it('honors disableConfigFileFallback === true', () => {
      const isolatedMemoreal = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(isolatedMemoreal, { recursive: true });
      fs.writeFileSync(
        path.join(isolatedMemoreal, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_persisted_key"\n'
      );

      const resolved = resolveEffectiveApiKey(undefined, {
        homeDir: tmpDir,
        disableConfigFileFallback: true,
      });
      assert.equal(resolved, '');
    });
  });

  describe('resolveEffectiveApiUrl', () => {
    it('resolves URL with proper fallbacks and strips /v1/mcp', () => {
      assert.equal(
        resolveEffectiveApiUrl('https://override.url/v1/mcp/'),
        'https://override.url'
      );
      assert.equal(
        resolveEffectiveApiUrl(undefined, { apiUrl: 'https://option.url' }),
        'https://option.url'
      );
      assert.equal(
        resolveEffectiveApiUrl(undefined, {
          env: { MEMOREAL_API_URL: 'https://env.url/v1/mcp' },
        }),
        'https://env.url'
      );
      assert.equal(
        resolveEffectiveApiUrl(undefined, { env: {} }),
        'https://memoria.kolivri.com'
      );
    });
  });

  describe('saveMemorealConfig', () => {
    it('throws error when saving empty or placeholder key', () => {
      assert.throws(
        () => saveMemorealConfig({ apiKey: 'YOUR_API_KEY', homeDir: tmpDir }),
        /Cannot save empty or placeholder/
      );
      assert.throws(
        () => saveMemorealConfig({ apiKey: '', homeDir: tmpDir }),
        /Cannot save empty or placeholder/
      );
    });

    it('persists 6-key config.env with 0600 mode and creates 0700 directories', () => {
      const result = saveMemorealConfig({
        apiKey: 'mem_dev_save_123',
        apiUrl: 'https://save.kolivri.com',
        homeDir: tmpDir,
      });

      assert.equal(result.apiKey, 'mem_dev_save_123');
      assert.equal(result.apiUrl, 'https://save.kolivri.com');

      const memorealEnv = path.join(tmpDir, '.memoreal', 'config.env');
      const memoriaEnv = path.join(tmpDir, '.memoria', 'config.env');

      assert.ok(fs.existsSync(memorealEnv));
      assert.ok(fs.existsSync(memoriaEnv));

      const content = fs.readFileSync(memorealEnv, 'utf8');
      assert.match(content, /MEMOREAL_URL="https:\/\/save\.kolivri\.com\/v1\/mcp"/);
      assert.match(content, /MEMOREAL_API_URL="https:\/\/save\.kolivri\.com"/);
      assert.match(content, /MEMOREAL_API_KEY="mem_dev_save_123"/);
      assert.match(content, /MEMORIA_URL="https:\/\/save\.kolivri\.com\/v1\/mcp"/);
      assert.match(content, /MEMORIA_API_URL="https:\/\/save\.kolivri\.com"/);
      assert.match(content, /MEMORIA_API_KEY="mem_dev_save_123"/);

      // Verify file and directory permissions
      if (process.platform !== 'win32') {
        const dirStat = fs.statSync(path.join(tmpDir, '.memoreal'));
        assert.equal(dirStat.mode & 0o777, 0o700);

        const fileStat = fs.statSync(memorealEnv);
        assert.equal(fileStat.mode & 0o777, 0o600);
      }
    });

    it('creates .bak backup when overwriting existing config.env', () => {
      const memorealDir = path.join(tmpDir, '.memoreal');
      fs.mkdirSync(memorealDir, { recursive: true });
      const envPath = path.join(memorealDir, 'config.env');
      fs.writeFileSync(envPath, 'MEMOREAL_API_KEY="old_key"\n');

      saveMemorealConfig({
        apiKey: 'mem_dev_new_key',
        homeDir: tmpDir,
      });

      const bakPath = envPath + '.bak';
      assert.ok(fs.existsSync(bakPath));
      assert.match(fs.readFileSync(bakPath, 'utf8'), /old_key/);
      assert.match(fs.readFileSync(envPath, 'utf8'), /mem_dev_new_key/);

      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(bakPath).mode & 0o777, 0o600);
      }
    });
  });

  describe('configureDetectedIdes', () => {
    it('creates OpenCode native config with .mcp.memoreal (never .mcpServers) when preferredTool is opencode', () => {
      const res = configureDetectedIdes({
        apiKey: 'mem_dev_test_ide',
        apiUrl: 'https://memoria.kolivri.com',
        homeDir: tmpDir,
        preferredTool: 'opencode',
      });

      const opencodeJsonPath = path.join(
        tmpDir,
        '.config',
        'opencode',
        'opencode.json'
      );
      assert.ok(fs.existsSync(opencodeJsonPath));
      const parsed = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf8'));

      assert.equal(parsed.mcp.memoreal.type, 'remote');
      assert.equal(
        parsed.mcp.memoreal.url,
        'https://memoria.kolivri.com/v1/mcp'
      );
      assert.equal(parsed.mcp.memoreal.enabled, true);
      assert.deepEqual(parsed.mcp.memoreal.headers, {
        Authorization: 'Bearer mem_dev_test_ide',
      });
      assert.equal(parsed.mcpServers, undefined, 'Must NEVER write .mcpServers into opencode.json');

      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(opencodeJsonPath).mode & 0o777, 0o600);
      }
    });

    it('preserves existing local stdio OpenCode entry and sets environment key', () => {
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      fs.mkdirSync(opencodeDir, { recursive: true });
      const opencodeJsonPath = path.join(opencodeDir, 'opencode.json');
      fs.writeFileSync(
        opencodeJsonPath,
        JSON.stringify({
          mcp: {
            memoreal: {
              type: 'local',
              command: ['node', 'src/server.mjs'],
            },
          },
        })
      );

      configureDetectedIdes({
        apiKey: 'mem_dev_local_key',
        homeDir: tmpDir,
      });

      const parsed = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf8'));
      assert.equal(parsed.mcp.memoreal.type, 'local');
      assert.equal(
        parsed.mcp.memoreal.environment.MEMOREAL_API_KEY,
        'mem_dev_local_key'
      );
    });

    it('merges into Cursor, Windsurf, VS Code, and Claude Desktop when directories exist', () => {
      // Create parent directories
      const cursorDir = path.join(tmpDir, '.cursor');
      const windsurfDir = path.join(tmpDir, '.codeium', 'windsurf');
      const vscodeDir = path.join(tmpDir, '.vscode');
      const claudeDesktopDir = path.join(tmpDir, '.config', 'Claude');

      fs.mkdirSync(cursorDir, { recursive: true });
      fs.mkdirSync(windsurfDir, { recursive: true });
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.mkdirSync(claudeDesktopDir, { recursive: true });

      const res = configureDetectedIdes({
        apiKey: 'mem_dev_all_ides',
        apiUrl: 'https://memoria.kolivri.com',
        homeDir: tmpDir,
      });

      const cursorJson = JSON.parse(
        fs.readFileSync(path.join(cursorDir, 'mcp.json'), 'utf8')
      );
      assert.equal(cursorJson.mcpServers.memoreal.type, 'http');
      assert.equal(
        cursorJson.mcpServers.memoreal.url,
        'https://memoria.kolivri.com/v1/mcp'
      );
      assert.equal(
        cursorJson.mcpServers.memoreal.headers.Authorization,
        'Bearer mem_dev_all_ides'
      );

      const windsurfJson = JSON.parse(
        fs.readFileSync(path.join(windsurfDir, 'mcp_config.json'), 'utf8')
      );
      assert.equal(windsurfJson.mcpServers.memoreal.type, 'http');

      const vscodeJson = JSON.parse(
        fs.readFileSync(path.join(vscodeDir, 'mcp.json'), 'utf8')
      );
      assert.equal(vscodeJson.mcpServers.memoreal.type, 'http');

      const desktopJson = JSON.parse(
        fs.readFileSync(
          path.join(claudeDesktopDir, 'claude_desktop_config.json'),
          'utf8'
        )
      );
      assert.equal(desktopJson.mcpServers.memoreal.type, 'http');
    });

    it('updates .claude.json ONLY when it already exists', () => {
      // Does not exist: should not be created
      configureDetectedIdes({
        apiKey: 'mem_dev_claude',
        homeDir: tmpDir,
        preferredTool: 'claude-code',
      });
      const claudeJsonPath = path.join(tmpDir, '.claude.json');
      assert.equal(fs.existsSync(claudeJsonPath), false);

      // Now create existing .claude.json
      fs.writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: {} }));
      configureDetectedIdes({
        apiKey: 'mem_dev_claude',
        homeDir: tmpDir,
      });
      assert.ok(fs.existsSync(claudeJsonPath));
      assert.ok(fs.existsSync(claudeJsonPath + '.bak'));
      const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      assert.equal(parsed.mcpServers.memoreal.type, 'http');
    });

    it('leaves malformed JSON completely untouched and reports skipped_malformed_json', () => {
      const cursorDir = path.join(tmpDir, '.cursor');
      fs.mkdirSync(cursorDir, { recursive: true });
      const cursorJsonPath = path.join(cursorDir, 'mcp.json');
      const malformedContent = '{ invalid json "missing close brace"';
      fs.writeFileSync(cursorJsonPath, malformedContent);

      const result = configureDetectedIdes({
        apiKey: 'mem_dev_malformed_test',
        homeDir: tmpDir,
      });

      // Verify file was NOT modified
      assert.equal(fs.readFileSync(cursorJsonPath, 'utf8'), malformedContent);
      // Verify .bak was NOT created
      assert.equal(fs.existsSync(cursorJsonPath + '.bak'), false);
      // Verify skipped status in report
      const entry = result.updated.find((u) => u.file === cursorJsonPath);
      assert.ok(entry);
      assert.equal(entry.status, 'skipped_malformed_json');
    });
  });
});
