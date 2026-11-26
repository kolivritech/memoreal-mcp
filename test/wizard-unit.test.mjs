import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';

import {
  normalizeClientToolSlug,
  sanitizeClientName,
  sanitizeWorkspaceMetadata,
  openUrlInBrowser,
  createConnectWizardController,
  runCliSetupWizard,
  promptHidden,
  verifyApiKeyAuth,
} from '../src/wizard.mjs';

describe('wizard-unit', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memoreal-wizard-test-'));
  });

  afterEach(() => {
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  describe('normalizeClientToolSlug', () => {
    it('normalizes common IDE and assistant names case-insensitively', () => {
      assert.equal(normalizeClientToolSlug('OpenCode'), 'opencode');
      assert.equal(normalizeClientToolSlug('opencode-ai'), 'opencode');
      assert.equal(normalizeClientToolSlug('Cursor'), 'cursor');
      assert.equal(normalizeClientToolSlug('cursor-agent'), 'cursor');
      assert.equal(normalizeClientToolSlug('Claude Code'), 'claude-code');
      assert.equal(normalizeClientToolSlug('claude_code'), 'claude-code');
      assert.equal(normalizeClientToolSlug('claude-cli'), 'claude-code');
      assert.equal(normalizeClientToolSlug('claude'), 'claude-code');
      assert.equal(normalizeClientToolSlug('Visual Studio Code'), 'vscode');
      assert.equal(normalizeClientToolSlug('vscode'), 'vscode');
      assert.equal(normalizeClientToolSlug('VS Code'), 'vscode');
      assert.equal(normalizeClientToolSlug('copilot'), 'vscode');
      assert.equal(normalizeClientToolSlug('Windsurf'), 'windsurf');
      assert.equal(normalizeClientToolSlug('Codeium Windsurf'), 'windsurf');
      assert.equal(normalizeClientToolSlug('Zed'), 'zed');
      assert.equal(normalizeClientToolSlug('Codex'), 'codex');
      assert.equal(normalizeClientToolSlug('codex-cli'), 'codex');
    });

    it('returns empty string for unrecognized or invalid input', () => {
      assert.equal(normalizeClientToolSlug(''), '');
      assert.equal(normalizeClientToolSlug(null), '');
      assert.equal(normalizeClientToolSlug(undefined), '');
      assert.equal(normalizeClientToolSlug(123), '');
      assert.equal(normalizeClientToolSlug('custom-unknown-client'), '');
    });
  });

  describe('sanitizeClientName', () => {
    it('strips invalid characters, collapses spaces, and slices to 80 chars', () => {
      assert.equal(sanitizeClientName('OpenCode v1.0.0'), 'OpenCode v1.0.0');
      assert.equal(sanitizeClientName('  My   Cool   Client  +Test-1.0 '), 'My Cool Client +Test-1.0');
      assert.equal(sanitizeClientName('Cursor<script>alert(1)</script>'), 'Cursorscriptalert1script');
      assert.equal(sanitizeClientName('A'.repeat(120)).length, 80);
      assert.equal(sanitizeClientName(null), '');
      assert.equal(sanitizeClientName(undefined), '');
    });
  });

  describe('sanitizeWorkspaceMetadata', () => {
    it('returns undefined for null, undefined, non-string primitives, and empty/secret strings', () => {
      assert.equal(sanitizeWorkspaceMetadata(null), undefined);
      assert.equal(sanitizeWorkspaceMetadata(undefined), undefined);
      assert.equal(sanitizeWorkspaceMetadata(123), undefined);
      assert.equal(sanitizeWorkspaceMetadata(true), undefined);
      assert.equal(sanitizeWorkspaceMetadata(''), undefined);
      assert.equal(sanitizeWorkspaceMetadata('   '), undefined);
      assert.equal(sanitizeWorkspaceMetadata('mem_dev_secret123'), undefined);
      assert.equal(sanitizeWorkspaceMetadata('sk-1234567890'), undefined);
      assert.equal(sanitizeWorkspaceMetadata('Bearer token12345'), undefined);
    });

    it('supports string workspace slug while trimming whitespace and redacting secret patterns', () => {
      assert.equal(sanitizeWorkspaceMetadata('acme'), 'acme');
      assert.equal(sanitizeWorkspaceMetadata('  acme  '), 'acme');
      assert.equal(sanitizeWorkspaceMetadata(''), undefined);
      assert.equal(sanitizeWorkspaceMetadata('mem_dev_secret123'), undefined);
      assert.equal(sanitizeWorkspaceMetadata('sk-12345678'), undefined);
      assert.equal(sanitizeWorkspaceMetadata('Bearer secret'), undefined);
    });

    it('recursively strips secret properties and raw api_key string patterns', () => {
      const input = {
        id: 'ws_123',
        name: 'Engineering Team',
        tier: 'team',
        api_key: 'mem_dev_secret_key_123',
        apiKey: 'mem_live_another_secret',
        secret: 'super-secret-value',
        token: 'bearer-token-xyz',
        access_token: 'access-token-123',
        authorization: 'Bearer mem_live_test',
        nested: {
          allowed: 'visible-value',
          raw_key: 'raw-secret',
          customProperty: 'mem_dev_embedded_key_val',
        },
        items: [
          'regular-item',
          'mem_live_filtered_secret_item',
          {
            key: 'item-key',
            token: 'item-token',
            childVal: 'mem_start_filtered_child',
          },
        ],
      };

      const sanitized = sanitizeWorkspaceMetadata(input);

      assert.equal(sanitized.id, 'ws_123');
      assert.equal(sanitized.name, 'Engineering Team');
      assert.equal(sanitized.tier, 'team');
      assert.equal(sanitized.api_key, undefined);
      assert.equal(sanitized.apiKey, undefined);
      assert.equal(sanitized.secret, undefined);
      assert.equal(sanitized.token, undefined);
      assert.equal(sanitized.access_token, undefined);
      assert.equal(sanitized.authorization, undefined);

      assert.equal(sanitized.nested.allowed, 'visible-value');
      assert.equal(sanitized.nested.raw_key, undefined);
      assert.equal(sanitized.nested.customProperty, undefined);

      assert.equal(sanitized.items.length, 2);
      assert.equal(sanitized.items[0], 'regular-item');
      assert.equal(sanitized.items[1].key, 'item-key');
      assert.equal(sanitized.items[1].token, undefined);
      assert.equal(sanitized.items[1].childVal, undefined);

      // Verify no key matches secret regex and no value matches mem_* key prefix in the serialized json
      const json = JSON.stringify(sanitized);
      assert.equal(/mem_(dev|live|start|biz|prod|test)_/i.test(json), false);
      assert.equal(/(api_?key|raw_?key|secret|token|access_?token|authorization)/i.test(json), false);
    });
  });

  describe('openUrlInBrowser', () => {
    it('returns false when MEMOREAL_NO_BROWSER is "1"', () => {
      let spawned = false;
      const res = openUrlInBrowser('https://memoreal.kolivri.com/connect?code=ABCD-1234', {
        env: { MEMOREAL_NO_BROWSER: '1' },
        spawnImpl: () => {
          spawned = true;
          return { on: () => {}, unref: () => {} };
        },
      });
      assert.equal(res, false);
      assert.equal(spawned, false);
    });

    it('returns false for invalid or dangerous URLs', () => {
      let spawned = false;
      const invalidUrls = [
        '',
        '   ',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'ftp://example.com',
        'https://example.com/foo"bar',
        'https://example.com/<script>',
      ];
      for (const url of invalidUrls) {
        const res = openUrlInBrowser(url, {
          env: {},
          spawnImpl: () => {
            spawned = true;
            return { on: () => {}, unref: () => {} };
          },
        });
        assert.equal(res, false);
      }
      assert.equal(spawned, false);
    });

    it('spawns "open" on darwin, "cmd" on win32, and "xdg-open" on linux', () => {
      const calls = [];
      const mockSpawn = (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return {
          on: () => {},
          unref: () => {},
        };
      };

      const testUrl = 'https://memoreal.kolivri.com/connect?code=TEST-1234';

      // Darwin
      const resDarwin = openUrlInBrowser(testUrl, {
        platform: 'darwin',
        env: {},
        spawnImpl: mockSpawn,
      });
      assert.equal(resDarwin, true);
      assert.deepEqual(calls[0], {
        cmd: 'open',
        args: [testUrl],
        opts: { detached: true, stdio: 'ignore' },
      });

      // Win32
      const resWin32 = openUrlInBrowser(testUrl, {
        platform: 'win32',
        env: {},
        spawnImpl: mockSpawn,
      });
      assert.equal(resWin32, true);
      assert.deepEqual(calls[1], {
        cmd: 'cmd',
        args: ['/c', 'start', '', testUrl],
        opts: { detached: true, stdio: 'ignore' },
      });

      // Linux
      const resLinux = openUrlInBrowser(testUrl, {
        platform: 'linux',
        env: {},
        spawnImpl: mockSpawn,
      });
      assert.equal(resLinux, true);
      assert.deepEqual(calls[2], {
        cmd: 'xdg-open',
        args: [testUrl],
        opts: { detached: true, stdio: 'ignore' },
      });
    });

    it('handles spawn errors gracefully and returns false without throwing', () => {
      const res = openUrlInBrowser('https://example.com', {
        env: {},
        spawnImpl: () => {
          throw new Error('spawn ENOENT');
        },
      });
      assert.equal(res, false);
    });
  });

  describe('createConnectWizardController', () => {
    it('returns already_connected when action is omitted and health check succeeds', async () => {
      let healthChecked = false;
      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/health')) {
          healthChecked = true;
          assert.equal(opts.headers.Authorization, 'Bearer mem_dev_existing_key');
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'healthy' }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => 'mem_dev_existing_key',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
      });

      const res = await controller.handleConnectAccount({});
      assert.equal(res.status, 'already_connected');
      assert.equal(res.api_url, 'https://mock.memoria.kolivri.com');
      assert.match(res.message, /already connected/i);
      assert.equal(healthChecked, true);

      controller.close();
    });

    it('handles action: "status" when not started with or without existing key', async () => {
      // 1. Without existing key
      const controller1 = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        fetchImpl: async () => assert.fail('should not fetch'),
        homeDir: tmpHome,
      });

      const res1 = await controller1.handleConnectAccount({ action: 'status' });
      assert.equal(res1.status, 'not_started');
      assert.match(res1.message, /Step 1/);
      controller1.close();

      // 2. With existing key and healthy status
      const controller2 = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => 'mem_dev_valid_key',
        fetchImpl: async (url) => {
          if (url.endsWith('/v1/health')) {
            return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
          }
          throw new Error(`Unexpected fetch ${url}`);
        },
        homeDir: tmpHome,
      });

      const res2 = await controller2.handleConnectAccount({ action: 'status' });
      assert.equal(res2.status, 'connected');
      assert.match(res2.message, /Step 3/);
      controller2.close();
    });

    it('does not read config.env behind callback when getExistingApiKey returns empty string', async () => {
      const configDir = path.join(tmpHome, '.memoreal');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.env'),
        'MEMOREAL_API_KEY="mem_dev_from_saved_file"\n'
      );

      let healthFetched = false;
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/health')) {
          healthFetched = true;
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
      });

      const statusRes = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(statusRes.status, 'not_started');
      assert.equal(healthFetched, false, 'Should not read config.env or call /v1/health');

      controller.close();
    });

    it('completes device flow: action: "start" -> background poll -> approval -> connected status', async () => {
      let pollCount = 0;
      let approvedCallbackCalled = false;
      let browserLaunched = false;

      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/auth/device/start')) {
          const body = JSON.parse(opts.body);
          assert.equal(body.client_name, 'OpenCode Test');
          assert.equal(body.tool, 'opencode');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'dev_code_123',
              user_code: 'ABCD-9999',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              verification_uri_complete: 'https://memoreal.kolivri.com/connect?code=ABCD-9999',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }

        if (url.endsWith('/v1/auth/device/poll')) {
          pollCount++;
          const body = JSON.parse(opts.body);
          assert.equal(body.device_code, 'dev_code_123');

          if (pollCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ status: 'pending' }),
            };
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'approved',
              api_key: 'mem_dev_newly_paired_key_456',
              workspace: {
                id: 'ws_789',
                name: 'Test Org',
                api_key: 'mem_dev_newly_paired_key_456',
              },
            }),
          };
        }

        throw new Error(`Unexpected fetch ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        getConnectedClientName: () => 'OpenCode Test',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        spawnImpl: (cmd, args) => {
          browserLaunched = true;
          return { on: () => {}, unref: () => {} };
        },
        onApproved: ({ apiKey, apiUrl, workspace }) => {
          approvedCallbackCalled = true;
          assert.equal(apiKey, 'mem_dev_newly_paired_key_456');
          assert.equal(apiUrl, 'https://mock.memoria.kolivri.com');
          assert.equal(workspace.id, 'ws_789');
          assert.equal(workspace.api_key, undefined);
        },
      });

      // 1. Initiate start
      const startRes = await controller.handleConnectAccount({
        action: 'start',
        client_name: 'OpenCode Test',
      });

      assert.equal(startRes.status, 'waiting_for_browser');
      assert.equal(startRes.user_code, 'ABCD-9999');
      assert.equal(startRes.verification_uri_complete, 'https://memoreal.kolivri.com/connect?code=ABCD-9999');
      assert.equal(startRes.browser_opened, true);
      assert.equal(browserLaunched, true);
      assert.match(startRes.message, /Step 2/);

      // Verify immediate status check before polling completes
      const status1 = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(status1.status, 'waiting_for_browser');

      // 2. Wait for background polling to finish (2 polls * 50ms = ~100-150ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(approvedCallbackCalled, true);
      assert.ok(pollCount >= 2, `Expected at least 2 polls, got ${pollCount}`);

      // 3. Status check after approval
      const status2 = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(status2.status, 'connected');
      assert.match(status2.message, /Step 3/);
      assert.equal(status2.workspace.id, 'ws_789');
      assert.equal(status2.workspace.api_key, undefined);
      // Ensure raw api_key is NEVER returned on status response
      assert.equal('api_key' in status2, false);

      // Verify 0600 config file was persisted
      const savedConfigFile = path.join(tmpHome, '.memoreal', 'config.env');
      assert.ok(fs.existsSync(savedConfigFile), 'Config file must exist');
      const savedContent = fs.readFileSync(savedConfigFile, 'utf8');
      assert.match(savedContent, /MEMOREAL_API_KEY="mem_dev_newly_paired_key_456"/);

      controller.close();
    });

    it('handles device flow with string workspace (e.g. "acme") from /v1/auth/device/poll', async () => {
      let pollCount = 0;
      let approvedCallbackCalled = false;
      let approvedWorkspace = null;

      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/auth/device/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'dev_code_str_ws',
              user_code: 'ACME-1234',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              verification_uri_complete: 'https://memoreal.kolivri.com/connect?code=ACME-1234',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }

        if (url.endsWith('/v1/auth/device/poll')) {
          pollCount++;
          if (pollCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ status: 'pending' }),
            };
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'approved',
              api_key: 'mem_dev_acme_paired_key',
              workspace: 'acme',
            }),
          };
        }

        throw new Error(`Unexpected fetch ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        getConnectedClientName: () => 'OpenCode Acme Test',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        spawnImpl: () => ({ on: () => {}, unref: () => {} }),
        onApproved: ({ apiKey, apiUrl, workspace }) => {
          approvedCallbackCalled = true;
          approvedWorkspace = workspace;
          assert.equal(apiKey, 'mem_dev_acme_paired_key');
          assert.equal(apiUrl, 'https://mock.memoria.kolivri.com');
          assert.equal(workspace, 'acme');
        },
      });

      const startRes = await controller.handleConnectAccount({
        action: 'start',
        client_name: 'OpenCode Acme Test',
      });
      assert.equal(startRes.status, 'waiting_for_browser');

      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(approvedCallbackCalled, true);
      assert.equal(approvedWorkspace, 'acme');

      const status = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(status.status, 'connected');
      assert.equal(status.workspace, 'acme');
      assert.equal('api_key' in status, false);

      controller.close();
    });

    it('handles denied and expired polling transitions', async () => {
      // Test Denied
      let pollCount = 0;
      const controllerDenied = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        fetchImpl: async (url) => {
          if (url.endsWith('/v1/auth/device/start')) {
            return {
              ok: true,
              json: async () => ({
                device_code: 'dev_code_denied',
                user_code: 'DENY-0001',
                verification_uri: 'https://memoreal.kolivri.com/connect',
                expires_in: 300,
                interval: 0.05,
              }),
            };
          }
          if (url.endsWith('/v1/auth/device/poll')) {
            return {
              ok: true,
              json: async () => ({ status: 'denied' }),
            };
          }
        },
        homeDir: tmpHome,
        env: { MEMOREAL_NO_BROWSER: '1' },
      });

      await controllerDenied.handleConnectAccount({ action: 'start' });
      await new Promise((r) => setTimeout(r, 120));
      const statusDenied = await controllerDenied.handleConnectAccount({ action: 'status' });
      assert.equal(statusDenied.status, 'denied');
      assert.match(statusDenied.message, /denied/i);
      controllerDenied.close();

      // Test Expired
      const controllerExpired = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        fetchImpl: async (url) => {
          if (url.endsWith('/v1/auth/device/start')) {
            return {
              ok: true,
              json: async () => ({
                device_code: 'dev_code_expired',
                user_code: 'EXPR-0001',
                verification_uri: 'https://memoreal.kolivri.com/connect',
                expires_in: 300,
                interval: 0.05,
              }),
            };
          }
          if (url.endsWith('/v1/auth/device/poll')) {
            return {
              ok: true,
              json: async () => ({ status: 'expired' }),
            };
          }
        },
        homeDir: tmpHome,
        env: { MEMOREAL_NO_BROWSER: '1' },
      });

      await controllerExpired.handleConnectAccount({ action: 'start' });
      await new Promise((r) => setTimeout(r, 120));
      const statusExpired = await controllerExpired.handleConnectAccount({ action: 'status' });
      assert.equal(statusExpired.status, 'expired');
      assert.match(statusExpired.message, /expired/i);
      controllerExpired.close();
    });

    it('action omitted: does NOT return already_connected when POST /v1/mcp returns 401 even if /v1/health returns 200', async () => {
      let startCalled = false;
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/mcp')) {
          return { ok: false, status: 401, json: async () => ({ error: 'Revoked' }) };
        }
        if (url.endsWith('/v1/health')) {
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        if (url.endsWith('/v1/auth/device/start')) {
          startCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'dev_code_fallback',
              user_code: 'FALL-1234',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => 'mem_dev_revoked_key',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
        env: { MEMOREAL_NO_BROWSER: '1' },
      });

      const res = await controller.handleConnectAccount({});
      assert.notEqual(res.status, 'already_connected');
      assert.equal(res.status, 'waiting_for_browser');
      assert.equal(startCalled, true);
      controller.close();
    });

    it('action: "status" when not_started does NOT return connected when POST /v1/mcp returns 401', async () => {
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/mcp')) {
          return { ok: false, status: 401, json: async () => ({ error: 'Revoked' }) };
        }
        if (url.endsWith('/v1/health')) {
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => 'mem_dev_revoked_key',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
      });

      const res = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(res.status, 'not_started');
      assert.match(res.message, /Step 1/);
      controller.close();
    });

    it('safeguards against superseded deviceCode: poll response from older start call is ignored', async () => {
      let firstPollResolve = null;
      const firstPollPromise = new Promise((resolve) => {
        firstPollResolve = resolve;
      });

      const approvedCalls = [];

      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/auth/device/start')) {
          const body = JSON.parse(opts.body);
          if (body.client_name === 'Client First') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                device_code: 'first_device_code',
                user_code: 'FIRST-01',
                verification_uri: 'https://memoreal.kolivri.com/connect',
                expires_in: 300,
                interval: 0.05,
              }),
            };
          } else {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                device_code: 'second_device_code',
                user_code: 'SECOND-02',
                verification_uri: 'https://memoreal.kolivri.com/connect',
                expires_in: 300,
                interval: 0.05,
              }),
            };
          }
        }

        if (url.endsWith('/v1/auth/device/poll')) {
          const body = JSON.parse(opts.body);
          if (body.device_code === 'first_device_code') {
            await firstPollPromise;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                status: 'approved',
                api_key: 'mem_dev_stale_old_key',
                workspace: 'stale_org',
              }),
            };
          }
          if (body.device_code === 'second_device_code') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                status: 'approved',
                api_key: 'mem_dev_fresh_second_key',
                workspace: 'fresh_org',
              }),
            };
          }
        }

        throw new Error(`Unexpected URL: ${url}`);
      };

      const controller = createConnectWizardController({
        getApiUrl: () => 'https://mock.memoria.kolivri.com',
        getExistingApiKey: () => '',
        fetchImpl: mockFetch,
        homeDir: tmpHome,
        env: { MEMOREAL_NO_BROWSER: '1', MEMOREAL_HOME: tmpHome },
        onApproved: (data) => {
          approvedCalls.push(data);
        },
      });

      const res1 = await controller.handleConnectAccount({ action: 'start', client_name: 'Client First' });
      assert.equal(res1.user_code, 'FIRST-01');

      const res2 = await controller.handleConnectAccount({ action: 'start', client_name: 'Client Second' });
      assert.equal(res2.user_code, 'SECOND-02');

      firstPollResolve();

      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(approvedCalls.length, 1);
      assert.equal(approvedCalls[0].apiKey, 'mem_dev_fresh_second_key');
      assert.equal(approvedCalls[0].workspace, 'fresh_org');

      const status = await controller.handleConnectAccount({ action: 'status' });
      assert.equal(status.status, 'connected');
      assert.equal(status.workspace, 'fresh_org');

      controller.close();
    });
  });

  describe('runCliSetupWizard', () => {
    it('--help prints usage and exits cleanly', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      const res = await runCliSetupWizard({
        argv: ['--help'],
        output: mockOutput,
      });

      assert.equal(res.ok, true);
      assert.equal(res.help, true);
      assert.match(outputText, /Usage: memoreal-mcp setup/);
      assert.match(outputText, /--browser/);
      assert.match(outputText, /--key/);
    });

    it('--key flow: saves 0600 config, updates IDEs, and verifies health without printing secret', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      let healthRequested = false;
      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/health')) {
          healthRequested = true;
          assert.equal(opts.headers.Authorization, 'Bearer mem_dev_cli_key_123');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'healthy',
              workspace: {
                id: 'ws_cli_1',
                name: 'CLI Workspace',
                api_key: 'mem_dev_cli_key_123',
              },
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await runCliSetupWizard({
        argv: ['setup', '--key', 'mem_dev_cli_key_123', '--tool', 'cursor', '--api-url', 'https://mock.memoria.kolivri.com'],
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        fetchImpl: mockFetch,
      });

      assert.equal(res.ok, true);
      assert.equal(res.apiUrl, 'https://mock.memoria.kolivri.com');
      assert.ok(fs.existsSync(res.configPath));
      assert.equal(healthRequested, true);
      assert.equal(res.workspace.id, 'ws_cli_1');
      assert.equal(res.workspace.api_key, undefined);

      // Verify mode 0600
      const stat = fs.statSync(res.configPath);
      assert.equal(stat.mode & 0o777, 0o600);

      // CRITICAL: Raw API key must NEVER be printed to terminal output!
      assert.equal(outputText.includes('mem_dev_cli_key_123'), false);
      assert.match(outputText, /Memoreal Connected Successfully!/);
      assert.match(outputText, /API URL:/);
      assert.match(outputText, /Config File:/);
    });

    it('--browser flow: performs OAuth device pairing, saves config, and prints secret-free summary', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      let pollCount = 0;
      let browserLaunched = false;

      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/auth/device/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'cli_dev_code_abc',
              user_code: 'WIZD-5678',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              verification_uri_complete: 'https://memoreal.kolivri.com/connect?code=WIZD-5678',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }

        if (url.endsWith('/v1/auth/device/poll')) {
          pollCount++;
          if (pollCount === 1) {
            return {
              ok: true,
              json: async () => ({ status: 'pending' }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              status: 'approved',
              api_key: 'mem_dev_paired_cli_key_999',
              workspace: {
                name: 'Browser Paired Org',
                secret: 'should-be-stripped',
              },
            }),
          };
        }

        if (url.endsWith('/v1/health')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'healthy' }),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await runCliSetupWizard({
        argv: ['--browser', '--tool', 'opencode'],
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        fetchImpl: mockFetch,
        spawnImpl: () => {
          browserLaunched = true;
          return { on: () => {}, unref: () => {} };
        },
      });

      assert.equal(res.ok, true);
      assert.equal(browserLaunched, true);
      assert.ok(pollCount >= 2);
      assert.equal(res.workspace.name, 'Browser Paired Org');
      assert.equal(res.workspace.secret, undefined);

      // Secret check
      assert.equal(outputText.includes('mem_dev_paired_cli_key_999'), false);
      assert.match(outputText, /Device pairing initialized/);
      assert.match(outputText, /User Code:\s+WIZD-5678/);
      assert.match(outputText, /Memoreal Connected Successfully!/);
    });

    it('--browser flow: handles string workspace (e.g. "acme") from /v1/auth/device/poll', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      let pollCount = 0;

      const mockFetch = async (url) => {
        if (url.endsWith('/v1/auth/device/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'cli_dev_code_str_ws',
              user_code: 'ACME-5678',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              verification_uri_complete: 'https://memoreal.kolivri.com/connect?code=ACME-5678',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }

        if (url.endsWith('/v1/auth/device/poll')) {
          pollCount++;
          if (pollCount === 1) {
            return {
              ok: true,
              json: async () => ({ status: 'pending' }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              status: 'approved',
              api_key: 'mem_dev_paired_cli_key_acme',
              workspace: 'acme',
            }),
          };
        }

        if (url.endsWith('/v1/health')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'healthy', workspace: 'acme' }),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await runCliSetupWizard({
        argv: ['--browser', '--tool', 'opencode'],
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        fetchImpl: mockFetch,
        spawnImpl: () => ({ on: () => {}, unref: () => {} }),
      });

      assert.equal(res.ok, true);
      assert.ok(pollCount >= 2);
      assert.equal(res.workspace, 'acme');
      assert.equal(outputText.includes('mem_dev_paired_cli_key_acme'), false);
      assert.match(outputText, /Memoreal Connected Successfully!/);
    });

    it('interactive flow: choice [2] allows entering API key via non-TTY stream input', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      // User selects '2' (Enter key), then enters key 'mem_dev_interactive_key_555\n'
      const mockInput = Readable.from(['2\n', 'mem_dev_interactive_key_555\n']);

      const mockFetch = async (url) => {
        if (url.endsWith('/v1/health')) {
          return {
            ok: true,
            json: async () => ({ status: 'healthy' }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await runCliSetupWizard({
        argv: [],
        input: mockInput,
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        fetchImpl: mockFetch,
      });

      assert.equal(res.ok, true);
      assert.ok(fs.existsSync(res.configPath));
      assert.equal(outputText.includes('mem_dev_interactive_key_555'), false);
      assert.match(outputText, /Choose sign-in method:/);
    });

    it('interactive flow: choice [1] (or empty Enter) launches browser flow', async () => {
      let outputText = '';
      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          outputText += chunk.toString();
          cb();
        },
      });

      const mockInput = Readable.from(['1\n']);

      const mockFetch = async (url) => {
        if (url.endsWith('/v1/auth/device/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              device_code: 'code_choice_1',
              user_code: 'INT1-1234',
              verification_uri: 'https://memoreal.kolivri.com/connect',
              expires_in: 300,
              interval: 0.05,
            }),
          };
        }
        if (url.endsWith('/v1/auth/device/poll')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'approved',
              api_key: 'mem_dev_choice_1_key',
              workspace: { name: 'Interactive Org 1' },
            }),
          };
        }
        if (url.endsWith('/v1/health')) {
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        throw new Error(`Unexpected fetch ${url}`);
      };

      const res = await runCliSetupWizard({
        argv: [],
        input: mockInput,
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome, MEMOREAL_NO_BROWSER: '1' },
        fetchImpl: mockFetch,
      });

      assert.equal(res.ok, true);
      assert.ok(fs.existsSync(res.configPath));
      assert.equal(outputText.includes('mem_dev_choice_1_key'), false);
      assert.match(outputText, /Authorization confirmed!/);
    });

    it('--key flow: rejects 401 from POST /v1/mcp even when /v1/health returns 200 and does not save config', async () => {
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/mcp')) {
          return { ok: false, status: 401, json: async () => ({ error: 'Invalid key' }) };
        }
        if (url.endsWith('/v1/health')) {
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const mockOutput = new Writable({ write(c, e, cb) { cb(); } });

      await assert.rejects(
        async () => {
          await runCliSetupWizard({
            argv: ['setup', '--key', 'mem_dev_bad_key'],
            output: mockOutput,
            homeDir: tmpHome,
            env: { MEMOREAL_HOME: tmpHome },
            fetchImpl: mockFetch,
          });
        },
        /Invalid or revoked Memoreal API key \(HTTP 401\)/
      );

      const savedConfigFile = path.join(tmpHome, '.memoreal', 'config.env');
      assert.equal(fs.existsSync(savedConfigFile), false, 'Should not persist bad API key to config.env');
    });

    it('--key flow: falls back to /v1/health when POST /v1/mcp returns 404', async () => {
      let mcpCalled = false;
      let healthCalled = false;
      const mockFetch = async (url, opts) => {
        if (url.endsWith('/v1/mcp')) {
          mcpCalled = true;
          return { ok: false, status: 404, json: async () => ({ error: 'Not Found' }) };
        }
        if (url.endsWith('/v1/health')) {
          healthCalled = true;
          assert.equal(opts.headers.Authorization, 'Bearer mem_dev_fallback_key');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'healthy',
              workspace: 'fallback-org',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const mockOutput = new Writable({ write(c, e, cb) { cb(); } });

      const res = await runCliSetupWizard({
        argv: ['setup', '--key', 'mem_dev_fallback_key'],
        output: mockOutput,
        homeDir: tmpHome,
        env: { MEMOREAL_HOME: tmpHome },
        fetchImpl: mockFetch,
      });

      assert.equal(res.ok, true);
      assert.equal(mcpCalled, true);
      assert.equal(healthCalled, true);
      assert.equal(res.workspace, 'fallback-org');
      assert.ok(fs.existsSync(res.configPath));
    });
  });

  describe('verifyApiKeyAuth', () => {
    it('rejects 401 from POST /v1/mcp without falling back to /v1/health', async () => {
      let healthCalled = false;
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/mcp')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized' }),
          };
        }
        if (url.endsWith('/v1/health')) {
          healthCalled = true;
          return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await verifyApiKeyAuth('https://mock.memoria.kolivri.com', 'mem_dev_revoked_key', { fetchImpl: mockFetch });
      assert.equal(res.ok, false);
      assert.equal(res.status, 401);
      assert.equal(healthCalled, false, 'Must NOT fall back to /v1/health on 401');
    });

    it('falls back to /v1/health when POST /v1/mcp returns 404', async () => {
      let mcpCalled = false;
      let healthCalled = false;
      const mockFetch = async (url) => {
        if (url.endsWith('/v1/mcp')) {
          mcpCalled = true;
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Not Found' }),
          };
        }
        if (url.endsWith('/v1/health')) {
          healthCalled = true;
          return { ok: true, status: 200, json: async () => ({ status: 'healthy', workspace: 'acme' }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const res = await verifyApiKeyAuth('https://mock.memoria.kolivri.com', 'mem_dev_valid_key', { fetchImpl: mockFetch });
      assert.equal(mcpCalled, true);
      assert.equal(healthCalled, true);
      assert.equal(res.ok, true);
      assert.equal(res.status, 200);
      assert.equal(res.data.workspace, 'acme');
    });
  });

  describe('promptHidden', () => {
    it('handles input.isTTY = true, strips ANSI escape sequences, and calls pause() on completion', async () => {
      let paused = false;
      let rawMode = null;
      let writtenOutput = '';

      const mockOutput = new Writable({
        write(chunk, enc, cb) {
          writtenOutput += chunk.toString();
          cb();
        },
      });

      const mockInput = new Readable({
        read() {},
      });
      mockInput.isTTY = true;
      mockInput.setRawMode = (mode) => {
        rawMode = mode;
      };
      mockInput.pause = () => {
        paused = true;
      };

      const promptPromise = promptHidden('Enter key: ', mockInput, mockOutput);

      mockInput.push(Buffer.from('\x1b[Amem_dev_tty_123\n'));

      const result = await promptPromise;
      assert.equal(result, 'mem_dev_tty_123');
      assert.equal(paused, true, 'input.pause() must be called to unref/pause PTY stdin');
      assert.equal(rawMode, false, 'rawMode must be restored to false');
      assert.match(writtenOutput, /Enter key: /);
      assert.match(writtenOutput, /\n/);
    });
  });
});
