import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import cp from "node:child_process"

import {
  isPlaceholderApiKey as isPlaceholderDirect,
  ONBOARDING_WIZARD_PROMPT as ONBOARDING_PROMPT_DIRECT,
  resolveCloudConfig,
  fetchSessionStartContext,
  buildReadSuffix,
  buildWriteSuffix,
  buildEditSuffix,
  deriveNamespace,
  isChildSession as isChildSessionDirect,
  isChildSubagentSession as isChildSubagentSessionDirect,
  MemorealHooksPlugin,
  setup,
} from "../opencode/memoreal-hooks.js"
import memorealDefault from "../opencode/memoreal-hooks.js"

import {
  isPlaceholderApiKey as isPlaceholderReexported,
  ONBOARDING_WIZARD_PROMPT as ONBOARDING_PROMPT_REEXPORTED,
  deriveNamespace as deriveNamespaceReexported,
  isChildSession as isChildSessionReexported,
  isChildSubagentSession as isChildSubagentSessionReexported,
  MemorealHooksPlugin as PluginReexported,
  MemoriaHooksPlugin,
  setup as setupReexported,
} from "../opencode/memoria-hooks.js"
import memoriaDefault from "../opencode/memoria-hooks.js"

describe("WS-3: Silent-When-Unregistered Hooks, Doctor Sync & Onboarding Wizard", () => {
  let tempHome
  let originalEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "memoreal-hooks-test-"))
    delete process.env.MEMOREAL_API_KEY
    delete process.env.MEMORIA_API_KEY
    delete process.env.MEMOREAL_KEY
    delete process.env.MEMORIA_KEY
    delete process.env.MEMOREAL_API_URL
    delete process.env.MEMORIA_API_URL
    delete process.env.MEMOREAL_URL
    delete process.env.MEMORIA_URL
    delete process.env.PRD_FLASH_LEAF_WORKER
    process.env.MEMOREAL_HOME = tempHome
  })

  afterEach(() => {
    process.env = originalEnv
    try {
      fs.rmSync(tempHome, { recursive: true, force: true })
    } catch {}
  })

  describe("Atomic Change 3: Re-exports in opencode/memoria-hooks.js", () => {
    test("exports isPlaceholderApiKey and ONBOARDING_WIZARD_PROMPT identically", () => {
      assert.equal(typeof isPlaceholderDirect, "function")
      assert.equal(isPlaceholderDirect, isPlaceholderReexported)
      assert.equal(typeof ONBOARDING_PROMPT_DIRECT, "string")
      assert.equal(ONBOARDING_PROMPT_DIRECT, ONBOARDING_PROMPT_REEXPORTED)
      assert.equal(typeof isChildSessionDirect, "function")
      assert.equal(isChildSessionDirect, isChildSessionReexported)
      assert.equal(isChildSubagentSessionDirect, isChildSubagentSessionReexported)
      assert.equal(isChildSessionDirect, isChildSubagentSessionDirect)
      assert.equal(memorealDefault.isChildSession, isChildSessionDirect)
      assert.equal(memorealDefault.isChildSubagentSession, isChildSubagentSessionDirect)
      assert.equal(memoriaDefault.isChildSession, isChildSessionDirect)
      assert.equal(memoriaDefault.isChildSubagentSession, isChildSubagentSessionDirect)
      assert.equal(PluginReexported, MemorealHooksPlugin)
      assert.equal(MemoriaHooksPlugin, MemorealHooksPlugin)
      assert.equal(setupReexported, setup)
    })

    test("ONBOARDING_WIZARD_PROMPT contains 3-Click Wizard instructions across all steps and includes ?tool=opencode", () => {
      assert.match(ONBOARDING_PROMPT_DIRECT, /3-Click Interactive In-Chat Wizard/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /AskUserQuestion \(Claude Code\) or question \(OpenCode & Cursor\)/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 1: Present choice card "Connect in 1 Click via Google \/ Browser \(Recommended\)" vs "Skip for this session"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 2: Call connect_account\(\{ action: "start" \}\)/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /https:\/\/memoreal\.kolivri\.com\/connect\?code=XXXX-YYYY/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /"I clicked Authorize — Verify"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 3: Once connected, present choice card "Yes — Index repo now \(Recommended\)" vs "Later"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Never ask the user to paste their raw API key into chat/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /https:\/\/memoreal\.kolivri\.com\/connect\?tool=opencode/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /tool: "opencode"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /client_name: "OpenCode"/)
    })
  })

  describe("Atomic Change 2: Placeholder Filtering & resolveCloudConfig in opencode/memoreal-hooks.js", () => {
    test("isPlaceholderApiKey identifies common placeholder patterns", () => {
      assert.equal(isPlaceholderDirect("mem_dev_your_key_here"), true)
      assert.equal(isPlaceholderDirect("YOUR_API_KEY"), true)
      assert.equal(isPlaceholderDirect("your_api_key"), true)
      assert.equal(isPlaceholderDirect("your-memoreal-api-key"), true)
      assert.equal(isPlaceholderDirect("mem_dev_..."), true)
      assert.equal(isPlaceholderDirect("<MEMOREAL_API_KEY>"), true)
      assert.equal(isPlaceholderDirect("${MEMOREAL_API_KEY}"), true)
      assert.equal(isPlaceholderDirect('"YOUR_API_KEY"'), true)
      assert.equal(isPlaceholderDirect(""), true)
      assert.equal(isPlaceholderDirect(null), true)
      assert.equal(isPlaceholderDirect(undefined), true)

      // Valid keys should not be treated as placeholders
      assert.equal(isPlaceholderDirect("mem_dev_live_1234567890abcdef"), false)
      assert.equal(isPlaceholderDirect("sk_real_token_value"), false)
    })

    test("resolveCloudConfig returns empty apiKey for empty directory or placeholder keys", () => {
      // 1. Unregistered empty dir
      const unreg = resolveCloudConfig(tempHome)
      assert.equal(unreg.apiKey, "")

      // 2. Env placeholder
      process.env.MEMOREAL_API_KEY = "mem_dev_your_key_here"
      const envPlaceholder = resolveCloudConfig(tempHome)
      assert.equal(envPlaceholder.apiKey, "")

      // 3. Config file placeholder
      delete process.env.MEMOREAL_API_KEY
      const configDir = path.join(tempHome, ".memoreal")
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, "config.env"), 'MEMOREAL_API_KEY="YOUR_API_KEY"\n')
      const filePlaceholder = resolveCloudConfig(tempHome)
      assert.equal(filePlaceholder.apiKey, "")

      // 4. Valid key
      fs.writeFileSync(path.join(configDir, "config.env"), 'MEMOREAL_API_KEY="mem_dev_valid_token_xyz"\n')
      const valid = resolveCloudConfig(tempHome)
      assert.equal(valid.apiKey, "mem_dev_valid_token_xyz")
    })

    test("resolveCloudConfig falls through from placeholder MEMOREAL_API_KEY to valid MEMORIA_API_KEY or config.env", () => {
      // 1. Env fall-through from placeholder MEMOREAL_API_KEY to valid MEMORIA_API_KEY
      process.env.MEMOREAL_API_KEY = "mem_dev_your_key_here"
      process.env.MEMORIA_API_KEY = "mem_dev_valid_env_key"
      const res1 = resolveCloudConfig(tempHome)
      assert.equal(res1.apiKey, "mem_dev_valid_env_key")

      // 2. File fall-through when all env candidates are placeholders
      delete process.env.MEMORIA_API_KEY
      const configDir = path.join(tempHome, ".memoreal")
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, "config.env"), 'MEMOREAL_API_KEY="mem_dev_valid_file_key"\n')
      const res2 = resolveCloudConfig(tempHome)
      assert.equal(res2.apiKey, "mem_dev_valid_file_key")
    })

    test("resolveCloudConfig honors explicit empty MEMOREAL_API_KEY with unset MEMOREAL_HOME", () => {
      delete process.env.MEMOREAL_HOME
      process.env.MEMOREAL_API_KEY = ""
      const cfg = resolveCloudConfig()
      assert.equal(cfg.apiKey, "")
    })

    test("fetchSessionStartContext returns ONBOARDING_WIZARD_PROMPT without calling health when unconfigured", async () => {
      const res = await fetchSessionStartContext(process.cwd(), tempHome)
      assert.equal(res, ONBOARDING_PROMPT_DIRECT)
    })

    test("buildReadSuffix, buildWriteSuffix, buildEditSuffix return empty string when unregistered", () => {
      assert.equal(buildReadSuffix("README.md", "my-ns", tempHome), "")
      assert.equal(buildWriteSuffix("src/main.ts", "my-ns", tempHome), "")
      assert.equal(buildEditSuffix("src/main.ts", "my-ns", tempHome), "")
    })

    test("deriveNamespace strips /.worktrees/.*, /.claude/worktrees/.*, and /.opencode/worktrees/.*", () => {
      assert.equal(
        deriveNamespace("/Users/alice/projects/repo/.worktrees/feat-branch"),
        "-Users-alice-projects-repo"
      )
      assert.equal(
        deriveNamespace("/Users/alice/projects/repo/.claude/worktrees/feat-branch"),
        "-Users-alice-projects-repo"
      )
      assert.equal(
        deriveNamespace("/Users/alice/projects/repo/.opencode/worktrees/feat-branch"),
        "-Users-alice-projects-repo"
      )
    })

    test("isChildSession identifies child sessions via parentID, agent: flash-worker, cache, and PRD_FLASH_LEAF_WORKER", async () => {
      const cache = new Map()
      const mockCtx = {
        session: {
          get: async ({ sessionID }) => {
            if (sessionID === "child-p") return { id: "child-p", parentID: "root-1" }
            if (sessionID === "child-a") return { id: "child-a", agent: "flash-worker" }
            if (sessionID === "root-1") return { id: "root-1" }
            throw new Error("unknown session")
          },
        },
      }

      // Root session
      assert.equal(await isChildSessionDirect(mockCtx, "root-1", cache), false)
      assert.equal(cache.get("root-1"), false)
      // Hits cache
      assert.equal(await isChildSessionDirect(mockCtx, "root-1", cache), false)

      // Child with parentID
      assert.equal(await isChildSessionDirect(mockCtx, "child-p", cache), true)
      assert.equal(cache.get("child-p"), true)

      // Child with agent: flash-worker
      assert.equal(await isChildSessionDirect(mockCtx, "child-a", cache), true)

      // Fallback to PRD_FLASH_LEAF_WORKER when ctx has no session.get
      assert.equal(await isChildSessionDirect({}, "any"), false)
      process.env.PRD_FLASH_LEAF_WORKER = "1"
      assert.equal(await isChildSessionDirect({}, "any"), true)
      delete process.env.PRD_FLASH_LEAF_WORKER
    })
  })

  describe("Atomic Change 2: OpenCode Plugin Hook Suppression when Unregistered", () => {
    test("MemorealHooksPlugin stays silent on tool execution, compaction, and stop when unregistered", async () => {
      const plugin = await MemorealHooksPlugin({ directory: process.cwd() })

      // tool.execute.after stays silent
      const readOutput = { output: "file contents" }
      await plugin["tool.execute.after"]({ tool: "read", args: { path: "README.md" } }, readOutput)
      assert.equal(readOutput.output, "file contents")

      const writeOutput = { output: "ok" }
      await plugin["tool.execute.after"]({ tool: "write", args: { path: "main.ts" } }, writeOutput)
      assert.equal(writeOutput.output, "ok")

      const editOutput = { output: "ok" }
      await plugin["tool.execute.after"]({ tool: "edit", args: { path: "main.ts" } }, editOutput)
      assert.equal(editOutput.output, "ok")

      const todoOutput = { output: "todos" }
      await plugin["tool.execute.after"]({ tool: "todowrite", args: { todos: [{ content: "task1" }] } }, todoOutput)
      assert.equal(todoOutput.output, "todos")

      // compaction stays silent
      const compactOutput = { context: [] }
      await plugin["experimental.session.compacting"]({}, compactOutput)
      assert.deepEqual(compactOutput.context, [])

      // session.idle stays silent
      await plugin.event({ event: { type: "session.idle", sessionID: "s1" } })

      // chat.message with correction does not produce correction output when unregistered
      await plugin["chat.message"]({ sessionID: "s1" }, { parts: [{ type: "text", text: "no, that is wrong" }] })
      const systemOutput = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID: "s1" }, systemOutput)
      // Only the one-time onboarding wizard prompt is injected, NO correction message!
      assert.equal(systemOutput.system.length, 1)
      assert.equal(systemOutput.system[0], ONBOARDING_PROMPT_DIRECT)
    })

    test("setup (V2) stays silent on tool execution, compaction, and stop when unregistered", async () => {
      const hooksRegistered = new Map()
      const mockCtx = {
        location: { directory: process.cwd() },
        session: {
          hook: async (name, handler) => {
            hooksRegistered.set(`session.${name}`, handler)
          },
        },
        tool: {
          hook: async (name, handler) => {
            hooksRegistered.set(`tool.${name}`, handler)
          },
        },
        event: {
          subscribe: async function* () {
            // empty async iterator
          },
        },
      }

      await setup(mockCtx)

      // tool.execute.after stays silent
      const toolHook = hooksRegistered.get("tool.execute.after")
      const resultObj = { content: "initial content" }
      await toolHook({ status: "completed", tool: "read", input: { path: "README.md" }, result: resultObj })
      assert.equal(resultObj.content, "initial content")

      // compaction stays silent
      const compactionHook = hooksRegistered.get("session.compaction")
      const compactionEvent = { system: [] }
      await compactionHook(compactionEvent)
      assert.deepEqual(compactionEvent.system, [])

      // context hook produces only the wizard prompt
      const contextHook = hooksRegistered.get("session.context")
      const contextEvent = { sessionID: "s2", system: [] }
      await contextHook(contextEvent)
      assert.equal(contextEvent.system.length, 1)
      assert.equal(contextEvent.system[0].text, ONBOARDING_PROMPT_DIRECT)
    })

    test("MemorealHooksPlugin emits ONBOARDING_WIZARD_PROMPT only once per session across multiple turns", async () => {
      const plugin = await MemorealHooksPlugin({ directory: process.cwd() })
      const sessionID = "session-multiturn-test"

      // Turn 1
      const turn1Output = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID }, turn1Output)
      assert.equal(turn1Output.system.length, 1)
      assert.equal(turn1Output.system[0], ONBOARDING_PROMPT_DIRECT)

      // Turn 2 in same session
      const turn2Output = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID }, turn2Output)
      assert.equal(turn2Output.system.length, 0, "Turn 2 must not re-emit ONBOARDING_WIZARD_PROMPT")

      // Turn 3 in same session
      const turn3Output = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID }, turn3Output)
      assert.equal(turn3Output.system.length, 0, "Turn 3 must not re-emit ONBOARDING_WIZARD_PROMPT")

      // Different session starts fresh
      const otherSessionOutput = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID: "different-session" }, otherSessionOutput)
      assert.equal(otherSessionOutput.system.length, 1)
      assert.equal(otherSessionOutput.system[0], ONBOARDING_PROMPT_DIRECT)
    })

    test("setup (V2) emits ONBOARDING_WIZARD_PROMPT only once per session across multiple turns", async () => {
      const hooksRegistered = new Map()
      const mockCtx = {
        location: { directory: process.cwd() },
        session: {
          hook: async (name, handler) => {
            hooksRegistered.set(`session.${name}`, handler)
          },
        },
        tool: {
          hook: async (name, handler) => {
            hooksRegistered.set(`tool.${name}`, handler)
          },
        },
        event: {
          subscribe: async function* () {},
        },
      }

      await setup(mockCtx)
      const contextHook = hooksRegistered.get("session.context")
      const sessionID = "setup-multiturn-test"

      // Turn 1
      const event1 = { sessionID, system: [] }
      await contextHook(event1)
      assert.equal(event1.system.length, 1)
      assert.equal(event1.system[0].text, ONBOARDING_PROMPT_DIRECT)

      // Turn 2
      const event2 = { sessionID, system: [] }
      await contextHook(event2)
      assert.equal(event2.system.length, 0, "Turn 2 must not re-emit ONBOARDING_WIZARD_PROMPT")

      // Turn 3
      const event3 = { sessionID, system: [] }
      await contextHook(event3)
      assert.equal(event3.system.length, 0, "Turn 3 must not re-emit ONBOARDING_WIZARD_PROMPT")
    })
  })

  describe("Atomic Change 1: hooks/hooks.json Shell Execution", () => {
    const hooksJsonPath = path.resolve("hooks/hooks.json")
    const hooksData = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"))

    test("hooks/hooks.json is valid and contains all expected hook types", () => {
      assert.ok(hooksData.hooks.SessionStart)
      assert.ok(hooksData.hooks.PreCompact)
      assert.ok(hooksData.hooks.PostCompact)
      assert.ok(hooksData.hooks.UserPromptSubmit)
      assert.ok(hooksData.hooks.PostToolUse)
      assert.ok(hooksData.hooks.TaskCompleted)
      assert.ok(hooksData.hooks.Stop)
    })

    test("SessionStart hook emits the 3-Click Wizard prompt and exits 0 when unregistered", () => {
      const cmd = hooksData.hooks.SessionStart[0].hooks[0].command
      const res = cp.spawnSync("sh", ["-c", cmd], {
        env: {
          ...process.env,
          MEMOREAL_HOME: tempHome,
          MEMOREAL_API_KEY: "",
          MEMORIA_API_KEY: "",
          MEMOREAL_KEY: "",
          MEMORIA_KEY: "",
        },
        encoding: "utf8",
      })

      assert.equal(res.status, 0)
      assert.equal(res.stderr, "", `SessionStart produced stderr when unregistered: ${res.stderr}`)
      assert.match(res.stdout, /\[memoreal-session-start\] Memoreal Cloud is not yet connected\./)
      assert.match(res.stdout, /Drive the 3-Click Interactive In-Chat Wizard/)
      assert.match(res.stdout, /Step 1: Present choice card "Connect in 1 Click via Google \/ Browser \(Recommended\)"/)
      assert.match(res.stdout, /Step 2: Call connect_account\(\{ action: "start" \}\)/)
      assert.match(res.stdout, /Step 3: Once connected, present choice card "Yes — Index repo now \(Recommended\)"/)
      assert.match(res.stdout, /Never ask the user to paste a raw API key into chat\./)
      assert.doesNotMatch(res.stdout, /build_context/)
    })

    test("SessionStart hook emits the 3-Click Wizard prompt when placeholder key is used", () => {
      const cmd = hooksData.hooks.SessionStart[0].hooks[0].command
      const res = cp.spawnSync("sh", ["-c", cmd], {
        env: {
          ...process.env,
          MEMOREAL_HOME: tempHome,
          MEMOREAL_API_KEY: "mem_dev_your_key_here",
        },
        encoding: "utf8",
      })

      assert.equal(res.status, 0)
      assert.equal(res.stderr, "", `SessionStart with placeholder produced stderr: ${res.stderr}`)
      assert.match(res.stdout, /\[memoreal-session-start\] Memoreal Cloud is not yet connected\./)
      assert.match(res.stdout, /Drive the 3-Click Interactive In-Chat Wizard/)
    })

    test("Non-SessionStart hooks stay 100% silent (exit 0, stdout empty) when unregistered", () => {
      const silentHooks = [
        { name: "PreCompact", cmd: hooksData.hooks.PreCompact[0].hooks[0].command },
        { name: "PostCompact", cmd: hooksData.hooks.PostCompact[0].hooks[0].command },
        {
          name: "UserPromptSubmit",
          cmd: hooksData.hooks.UserPromptSubmit[0].hooks[0].command,
          stdin: JSON.stringify({ prompt: "no, that is wrong, stop" }),
        },
        {
          name: "PostToolUse (TaskCreate)",
          cmd: hooksData.hooks.PostToolUse.find((h) => h.matcher === "TaskCreate").hooks[0].command,
        },
        {
          name: "PostToolUse (Write)",
          cmd: hooksData.hooks.PostToolUse.find((h) => h.matcher === "Write").hooks[0].command,
          stdin: JSON.stringify({ tool_input: { file_path: "src/main.ts" } }),
        },
        {
          name: "PostToolUse (Edit)",
          cmd: hooksData.hooks.PostToolUse.find((h) => h.matcher === "Edit").hooks[0].command,
          stdin: JSON.stringify({ tool_input: { file_path: "src/main.ts" } }),
        },
        {
          name: "PostToolUse (Read)",
          cmd: hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command,
          stdin: JSON.stringify({ tool_input: { file_path: "README.md" } }),
        },
        { name: "TaskCompleted", cmd: hooksData.hooks.TaskCompleted[0].hooks[0].command },
        { name: "Stop", cmd: hooksData.hooks.Stop[0].hooks[0].command },
      ]

      for (const { name, cmd, stdin } of silentHooks) {
        const res = cp.spawnSync("sh", ["-c", cmd], {
          input: stdin || "",
          env: {
            ...process.env,
            MEMOREAL_HOME: tempHome,
            MEMOREAL_API_KEY: "",
            MEMORIA_API_KEY: "",
            MEMOREAL_KEY: "",
            MEMORIA_KEY: "",
          },
          encoding: "utf8",
        })

        assert.equal(res.status, 0, `Hook ${name} failed with status ${res.status}: ${res.stderr}`)
        assert.equal(res.stderr, "", `Hook ${name} produced stderr when unregistered: ${res.stderr}`)
        assert.equal(res.stdout, "", `Hook ${name} produced unexpected stdout when unregistered: ${res.stdout}`)
      }
    })

    test("Non-SessionStart hooks stay 100% silent when placeholder key is in environment or config.env", () => {
      const readCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command
      const writeCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Write").hooks[0].command
      const editCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Edit").hooks[0].command

      const placeholderKeys = [
        "mem_dev_your_key_here",
        "YOUR_API_KEY",
        "your-memoreal-api-key",
        "mem_dev_...",
        "<MEMOREAL_API_KEY>",
        "${MEMOREAL_API_KEY}",
      ]

      for (const placeholder of placeholderKeys) {
        // Test Read
        const readRes = cp.spawnSync("sh", ["-c", readCmd], {
          input: JSON.stringify({ tool_input: { file_path: "README.md" } }),
          env: { ...process.env, MEMOREAL_HOME: tempHome, MEMOREAL_API_KEY: placeholder },
          encoding: "utf8",
        })
        assert.equal(readRes.status, 0)
        assert.equal(readRes.stderr, "")
        assert.equal(readRes.stdout, "", `Read hook with placeholder ${placeholder} emitted stdout`)

        // Test Write
        const writeRes = cp.spawnSync("sh", ["-c", writeCmd], {
          input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
          env: { ...process.env, MEMOREAL_HOME: tempHome, MEMOREAL_API_KEY: placeholder },
          encoding: "utf8",
        })
        assert.equal(writeRes.status, 0)
        assert.equal(writeRes.stderr, "")
        assert.equal(writeRes.stdout, "", `Write hook with placeholder ${placeholder} emitted stdout`)

        // Test Edit
        const editRes = cp.spawnSync("sh", ["-c", editCmd], {
          input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
          env: { ...process.env, MEMOREAL_HOME: tempHome, MEMOREAL_API_KEY: placeholder },
          encoding: "utf8",
        })
        assert.equal(editRes.status, 0)
        assert.equal(editRes.stderr, "")
        assert.equal(editRes.stdout, "", `Edit hook with placeholder ${placeholder} emitted stdout`)
      }
    })

    test("Hooks emit contextual memory prompts when valid API key is present", () => {
      let p = process.cwd()
      p = p.replace(/\/\.worktrees\/.*$/, "").replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.opencode\/worktrees\/.*$/, "")
      const expectedNs = p.replace(/\//g, "-")
      assert.ok(expectedNs.length > 0)

      const readCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command
      const writeCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Write").hooks[0].command
      const editCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Edit").hooks[0].command

      const validEnv = {
        ...process.env,
        MEMOREAL_HOME: tempHome,
        MEMOREAL_API_KEY: "mem_dev_valid_authenticated_key_123",
      }

      // Read on Markdown
      const readRes = cp.spawnSync("sh", ["-c", readCmd], {
        input: JSON.stringify({ tool_input: { file_path: "README.md" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(readRes.status, 0)
      assert.equal(readRes.stderr, "")
      assert.match(readRes.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)
      assert.match(readRes.stdout, new RegExp(`\\(namespace: ${expectedNs}\\)`))

      // Write on code file
      const writeRes = cp.spawnSync("sh", ["-c", writeCmd], {
        input: JSON.stringify({ tool_input: { file_path: "src/index.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(writeRes.status, 0)
      assert.equal(writeRes.stderr, "")
      assert.match(writeRes.stdout, /\[memoreal-encode-code\] Code file written: src\/index\.ts/)
      assert.match(writeRes.stdout, new RegExp(`\\(namespace: ${expectedNs}\\)`))

      // Edit on code file
      const editRes = cp.spawnSync("sh", ["-c", editCmd], {
        input: JSON.stringify({ tool_input: { file_path: "src/index.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(editRes.status, 0)
      assert.equal(editRes.stderr, "")
      assert.match(editRes.stdout, /\[memoreal-encode-code\] Code file edited: src\/index\.ts/)
      assert.match(editRes.stdout, new RegExp(`\\(namespace: ${expectedNs}\\)`))
    })

    test("ALL 10 hooks: fallback NS matches PWD (stripping worktrees) with zero stderr when registered without bin/memoreal-ns", () => {
      let p = process.cwd()
      p = p.replace(/\/\.worktrees\/.*$/, "").replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.opencode\/worktrees\/.*$/, "")
      const expectedNs = p.replace(/\//g, "-")
      assert.ok(expectedNs.length > 0)

      const validEnv = {
        ...process.env,
        MEMOREAL_HOME: tempHome,
        MEMOREAL_API_KEY: "mem_dev_valid_authenticated_key_123",
      }

      // 1. SessionStart
      const startRes = cp.spawnSync("sh", ["-c", hooksData.hooks.SessionStart[0].hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(startRes.status, 0)
      assert.equal(startRes.stderr, "")
      assert.match(startRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 2. PreCompact
      const preCompactRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PreCompact[0].hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(preCompactRes.status, 0)
      assert.equal(preCompactRes.stderr, "")
      assert.match(preCompactRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 3. PostCompact
      const postCompactRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PostCompact[0].hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(postCompactRes.status, 0)
      assert.equal(postCompactRes.stderr, "")
      assert.match(postCompactRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 4. UserPromptSubmit
      const promptRes = cp.spawnSync("sh", ["-c", hooksData.hooks.UserPromptSubmit[0].hooks[0].command], {
        input: JSON.stringify({ prompt: "no, that is wrong, please fix it" }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(promptRes.status, 0)
      assert.equal(promptRes.stderr, "")
      assert.match(promptRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 5. PostToolUse (TaskCreate)
      const taskCreateRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PostToolUse.find((h) => h.matcher === "TaskCreate").hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(taskCreateRes.status, 0)
      assert.equal(taskCreateRes.stderr, "")
      assert.match(taskCreateRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 6. PostToolUse (Write)
      const writeRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PostToolUse.find((h) => h.matcher === "Write").hooks[0].command], {
        input: JSON.stringify({ tool_input: { file_path: "src/file.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(writeRes.status, 0)
      assert.equal(writeRes.stderr, "")
      assert.match(writeRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 7. PostToolUse (Edit)
      const editRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PostToolUse.find((h) => h.matcher === "Edit").hooks[0].command], {
        input: JSON.stringify({ tool_input: { file_path: "src/file.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(editRes.status, 0)
      assert.equal(editRes.stderr, "")
      assert.match(editRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 8. PostToolUse (Read)
      const readRes = cp.spawnSync("sh", ["-c", hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command], {
        input: JSON.stringify({ tool_input: { file_path: "README.md" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(readRes.status, 0)
      assert.equal(readRes.stderr, "")
      assert.match(readRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 9. TaskCompleted
      const taskCompletedRes = cp.spawnSync("sh", ["-c", hooksData.hooks.TaskCompleted[0].hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(taskCompletedRes.status, 0)
      assert.equal(taskCompletedRes.stderr, "")
      assert.match(taskCompletedRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))

      // 10. Stop
      const stopRes = cp.spawnSync("sh", ["-c", hooksData.hooks.Stop[0].hooks[0].command], {
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(stopRes.status, 0)
      assert.equal(stopRes.stderr, "")
      assert.match(stopRes.stdout, new RegExp(`namespace[=:\\s"]+${expectedNs}`))
    })

    test("hooks.json: placeholder MEMOREAL_API_KEY in environment falls through to valid MEMORIA_API_KEY", () => {
      let p = process.cwd()
      p = p.replace(/\/\.worktrees\/.*$/, "").replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.opencode\/worktrees\/.*$/, "")
      const expectedNs = p.replace(/\//g, "-")

      const readCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command
      const res = cp.spawnSync("sh", ["-c", readCmd], {
        input: JSON.stringify({ tool_input: { file_path: "README.md" } }),
        env: {
          ...process.env,
          MEMOREAL_HOME: tempHome,
          MEMOREAL_API_KEY: "mem_dev_your_key_here",
          MEMORIA_API_KEY: "mem_dev_valid_authenticated_key_123",
        },
        encoding: "utf8",
      })
      assert.equal(res.status, 0)
      assert.equal(res.stderr, "")
      assert.match(res.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)
      assert.match(res.stdout, new RegExp(`\\(namespace: ${expectedNs}\\)`))
    })

    test("hooks.json: placeholder MEMOREAL_API_KEY in environment falls through to valid config.env key", () => {
      let p = process.cwd()
      p = p.replace(/\/\.worktrees\/.*$/, "").replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.opencode\/worktrees\/.*$/, "")
      const expectedNs = p.replace(/\//g, "-")

      const configDir = path.join(tempHome, ".memoreal")
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, "config.env"), 'MEMOREAL_API_KEY="mem_dev_valid_token_from_file"\n')

      const readCmd = hooksData.hooks.PostToolUse.find((h) => h.matcher === "Read").hooks[0].command
      const res = cp.spawnSync("sh", ["-c", readCmd], {
        input: JSON.stringify({ tool_input: { file_path: "README.md" } }),
        env: {
          ...process.env,
          MEMOREAL_HOME: tempHome,
          MEMOREAL_API_KEY: "mem_dev_your_key_here",
        },
        encoding: "utf8",
      })
      assert.equal(res.status, 0)
      assert.equal(res.stderr, "")
      assert.match(res.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)
      assert.match(res.stdout, new RegExp(`\\(namespace: ${expectedNs}\\)`))
    })
  })

  describe("Atomic Change 4: skills/memoreal-doctor/SKILL.md", () => {
    test("memoreal-doctor contains zero brain.kolivri.com references and guides to 3-Click Wizard", () => {
      const doctorPath = path.resolve("skills/memoreal-doctor/SKILL.md")
      const content = fs.readFileSync(doctorPath, "utf8")

      assert.equal(content.includes("brain.kolivri.com"), false, "Must not contain brain.kolivri.com")
      assert.match(content, /connect_account/, "Must mention connect_account tool")
      assert.match(content, /npx -y @kolivri\/memoreal-mcp setup/, "Must mention npx setup wizard")
      assert.match(content, /Placeholder key detection/i, "Must describe placeholder detection")
      assert.match(content, /NEVER ask the user to paste their raw API key into chat/i, "Must enforce no raw key pasting")
    })
  })

  describe("Atomic Change 5: OpenCode v2 setup & v1 MemorealHooksPlugin in Root vs Child Sessions (Registered)", () => {
    let origFetch

    beforeEach(() => {
      origFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => '{"status":"ok"}',
      })
    })

    afterEach(() => {
      globalThis.fetch = origFetch
    })

    test("v2 setup executes hooks in root session without ReferenceError and suppresses in child sessions", async () => {
      process.env.MEMOREAL_API_KEY = "mem_dev_valid123"
      const hooksRegistered = new Map()
      const eventQueue = []

      const mockCtx = {
        location: { directory: tempHome },
        session: {
          get: async ({ sessionID }) => {
            if (sessionID === "ses_root") {
              return { id: "ses_root", parentID: null, agent: "default" }
            }
            if (sessionID === "ses_child_parent") {
              return { id: "ses_child_parent", parentID: "ses_root", agent: "default" }
            }
            if (sessionID === "ses_child_agent") {
              return { id: "ses_child_agent", parentID: null, agent: "flash-worker" }
            }
            return null
          },
          hook: async (name, handler) => {
            hooksRegistered.set(`session.${name}`, handler)
          },
        },
        tool: {
          hook: async (name, handler) => {
            hooksRegistered.set(`tool.${name}`, handler)
          },
        },
        event: {
          subscribe: async function* ({ types, signal }) {
            while (!signal?.aborted) {
              if (eventQueue.length > 0) {
                yield eventQueue.shift()
              } else {
                await new Promise((r) => setTimeout(r, 10))
              }
            }
          },
        },
      }

      const cleanup = await setup(mockCtx)

      const toolHook = hooksRegistered.get("tool.execute.after")
      const compactionHook = hooksRegistered.get("session.compaction")
      const contextHook = hooksRegistered.get("session.context")
      const promptHook = hooksRegistered.get("session.prompt")

      // --- 1. ROOT SESSION (ses_root) ---
      // Read tool on markdown
      const rootReadResult = { content: "root read file" }
      await toolHook({
        status: "completed",
        tool: "read",
        input: { path: "README.md" },
        result: rootReadResult,
        sessionID: "ses_root",
      })
      assert.match(rootReadResult.content, /\[memoreal-recall-doc\]/)

      // Write tool on prd plan file
      const rootWriteResult = { content: "root write file" }
      await toolHook({
        status: "completed",
        tool: "write",
        input: { path: "prd/001.md" },
        result: rootWriteResult,
        sessionID: "ses_root",
      })
      assert.match(rootWriteResult.content, /\[memoreal-encode-plan\]/)

      // Edit tool on code file
      const rootEditResult = { content: "root edit file" }
      await toolHook({
        status: "completed",
        tool: "edit",
        input: { path: "src/main.ts" },
        result: rootEditResult,
        sessionID: "ses_root",
      })
      assert.match(rootEditResult.content, /\[memoreal-encode-code\]/)

      // Compaction hook
      const rootCompactionEvent = { sessionID: "ses_root", system: [] }
      await compactionHook(rootCompactionEvent)
      assert.equal(rootCompactionEvent.system.length, 1)
      assert.match(rootCompactionEvent.system[0].text, /\[memoreal-pre-compact\]/)

      // Session execution succeeded event
      eventQueue.push({
        type: "session.execution.succeeded",
        data: { sessionID: "ses_root" },
      })
      await new Promise((r) => setTimeout(r, 30))
      const rootContextEvent = { sessionID: "ses_root", system: [] }
      await contextHook(rootContextEvent)
      const stopText = rootContextEvent.system.find((s) => s.text?.includes("[memoreal-session-end]"))
      assert.ok(stopText, "session.execution.succeeded must cache stop summary for root session")

      // --- 2. CHILD SESSION via parentID (ses_child_parent) ---
      const childParentRead = { content: "child read" }
      await toolHook({
        status: "completed",
        tool: "read",
        input: { path: "README.md" },
        result: childParentRead,
        sessionID: "ses_child_parent",
      })
      assert.equal(childParentRead.content, "child read", "Must suppress read in child session (parentID)")

      const childParentWrite = { content: "child write" }
      await toolHook({
        status: "completed",
        tool: "write",
        input: { path: "prd/001.md" },
        result: childParentWrite,
        sessionID: "ses_child_parent",
      })
      assert.equal(childParentWrite.content, "child write", "Must suppress write in child session (parentID)")

      const childParentEdit = { content: "child edit" }
      await toolHook({
        status: "completed",
        tool: "edit",
        input: { path: "src/main.ts" },
        result: childParentEdit,
        sessionID: "ses_child_parent",
      })
      assert.equal(childParentEdit.content, "child edit", "Must suppress edit in child session (parentID)")

      const childParentCompaction = { sessionID: "ses_child_parent", system: [] }
      await compactionHook(childParentCompaction)
      assert.equal(childParentCompaction.system.length, 0, "Must suppress compaction in child session (parentID)")

      eventQueue.push({
        type: "session.execution.succeeded",
        data: { sessionID: "ses_child_parent" },
      })
      await new Promise((r) => setTimeout(r, 30))
      const childParentContext = { sessionID: "ses_child_parent", system: [] }
      await contextHook(childParentContext)
      const childStop = childParentContext.system.find((s) => s.text?.includes("[memoreal-session-end]"))
      assert.equal(childStop, undefined, "Must not cache stop summary for child session (parentID)")

      // --- 3. CHILD SESSION via agent: flash-worker (ses_child_agent) ---
      const childAgentRead = { content: "agent read" }
      await toolHook({
        status: "completed",
        tool: "read",
        input: { path: "README.md" },
        result: childAgentRead,
        sessionID: "ses_child_agent",
      })
      assert.equal(childAgentRead.content, "agent read", "Must suppress read in child session (agent: flash-worker)")

      const childAgentCompaction = { sessionID: "ses_child_agent", system: [] }
      await compactionHook(childAgentCompaction)
      assert.equal(childAgentCompaction.system.length, 0, "Must suppress compaction in child session (agent: flash-worker)")

      // --- 4. CHILD SESSION via PRD_FLASH_LEAF_WORKER="1" ---
      process.env.PRD_FLASH_LEAF_WORKER = "1"
      const envLeafRead = { content: "leaf read" }
      await toolHook({
        status: "completed",
        tool: "read",
        input: { path: "README.md" },
        result: envLeafRead,
      })
      assert.equal(envLeafRead.content, "leaf read", "Must suppress when PRD_FLASH_LEAF_WORKER=1")
      delete process.env.PRD_FLASH_LEAF_WORKER

      cleanup()
    })

    test("v1 MemorealHooksPlugin executes in root session without ReferenceError and suppresses in child sessions", async () => {
      process.env.MEMOREAL_API_KEY = "mem_dev_valid123"

      const client = {
        session: {
          get: async ({ sessionID }) => {
            if (sessionID === "ses_root") {
              return { id: "ses_root", parentID: null, agent: "default" }
            }
            if (sessionID === "ses_child_parent") {
              return { id: "ses_child_parent", parentID: "ses_root", agent: "default" }
            }
            if (sessionID === "ses_child_agent") {
              return { id: "ses_child_agent", parentID: null, agent: "flash-worker" }
            }
            return null
          },
        },
      }

      const plugin = await MemorealHooksPlugin({ directory: tempHome, client })

      // --- 1. ROOT SESSION ---
      const rootReadOutput = { output: "root output" }
      await plugin["tool.execute.after"](
        { tool: "read", args: { path: "README.md" }, sessionID: "ses_root" },
        rootReadOutput
      )
      assert.match(rootReadOutput.output, /\[memoreal-recall-doc\]/)

      const rootWriteOutput = { output: "root write" }
      await plugin["tool.execute.after"](
        { tool: "write", args: { path: "prd/001.md" }, sessionID: "ses_root" },
        rootWriteOutput
      )
      assert.match(rootWriteOutput.output, /\[memoreal-encode-plan\]/)

      const rootEditOutput = { output: "root edit" }
      await plugin["tool.execute.after"](
        { tool: "edit", args: { path: "src/main.ts" }, sessionID: "ses_root" },
        rootEditOutput
      )
      assert.match(rootEditOutput.output, /\[memoreal-encode-code\]/)

      const rootCompact = { context: [] }
      await plugin["experimental.session.compacting"]({ sessionID: "ses_root" }, rootCompact)
      assert.equal(rootCompact.context.length, 1)
      assert.match(rootCompact.context[0], /\[memoreal-pre-compact\]/)

      await plugin.event({ event: { type: "session.idle", sessionID: "ses_root" } })
      const rootTransform = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID: "ses_root" }, rootTransform)
      assert.ok(rootTransform.system.some((s) => typeof s === "string" && s.includes("[memoreal-session-end]")))

      // --- 2. CHILD SESSION (parentID) ---
      const childReadOutput = { output: "child output" }
      await plugin["tool.execute.after"](
        { tool: "read", args: { path: "README.md" }, sessionID: "ses_child_parent" },
        childReadOutput
      )
      assert.equal(childReadOutput.output, "child output")

      const childWriteOutput = { output: "child write" }
      await plugin["tool.execute.after"](
        { tool: "write", args: { path: "prd/001.md" }, sessionID: "ses_child_parent" },
        childWriteOutput
      )
      assert.equal(childWriteOutput.output, "child write")

      const childEditOutput = { output: "child edit" }
      await plugin["tool.execute.after"](
        { tool: "edit", args: { path: "src/main.ts" }, sessionID: "ses_child_parent" },
        childEditOutput
      )
      assert.equal(childEditOutput.output, "child edit")

      const childCompact = { context: [] }
      await plugin["experimental.session.compacting"]({ sessionID: "ses_child_parent" }, childCompact)
      assert.equal(childCompact.context.length, 0)

      await plugin.event({ event: { type: "session.idle", sessionID: "ses_child_parent" } })
      const childTransform = { system: [] }
      await plugin["experimental.chat.system.transform"]({ sessionID: "ses_child_parent" }, childTransform)
      assert.equal(childTransform.system.length, 0)

      // --- 3. CHILD SESSION (agent: flash-worker) ---
      const agentReadOutput = { output: "agent output" }
      await plugin["tool.execute.after"](
        { tool: "read", args: { path: "README.md" }, sessionID: "ses_child_agent" },
        agentReadOutput
      )
      assert.equal(agentReadOutput.output, "agent output")

      // --- 4. CHILD SESSION (PRD_FLASH_LEAF_WORKER="1") ---
      process.env.PRD_FLASH_LEAF_WORKER = "1"
      const leafReadOutput = { output: "leaf output" }
      await plugin["tool.execute.after"](
        { tool: "read", args: { path: "README.md" } },
        leafReadOutput
      )
      assert.equal(leafReadOutput.output, "leaf output")
      delete process.env.PRD_FLASH_LEAF_WORKER
    })
  })
})
