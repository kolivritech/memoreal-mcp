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
  MemorealHooksPlugin,
  setup,
} from "../opencode/memoreal-hooks.js"

import {
  isPlaceholderApiKey as isPlaceholderReexported,
  ONBOARDING_WIZARD_PROMPT as ONBOARDING_PROMPT_REEXPORTED,
  MemorealHooksPlugin as PluginReexported,
  MemoriaHooksPlugin,
  setup as setupReexported,
} from "../opencode/memoria-hooks.js"

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
      assert.equal(PluginReexported, MemorealHooksPlugin)
      assert.equal(MemoriaHooksPlugin, MemorealHooksPlugin)
      assert.equal(setupReexported, setup)
    })

    test("ONBOARDING_WIZARD_PROMPT contains 3-Click Wizard instructions across all steps", () => {
      assert.match(ONBOARDING_PROMPT_DIRECT, /3-Click Interactive In-Chat Wizard/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /AskUserQuestion \(Claude Code\) or question \(OpenCode & Cursor\)/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 1: Present choice card "Connect in 1 Click via Google \/ Browser \(Recommended\)" vs "Skip for this session"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 2: Call connect_account\(\{ action: "start" \}\)/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /https:\/\/memoreal\.kolivri\.com\/connect\?code=XXXX-YYYY/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /"I clicked Authorize — Verify"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Step 3: Once connected, present choice card "Yes — Index repo now \(Recommended\)" vs "Later"/)
      assert.match(ONBOARDING_PROMPT_DIRECT, /Never ask the user to paste their raw API key into chat/)
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
      toolHook({ status: "completed", tool: "read", input: { path: "README.md" }, result: resultObj })
      assert.equal(resultObj.content, "initial content")

      // compaction stays silent
      const compactionHook = hooksRegistered.get("session.compaction")
      const compactionEvent = { system: [] }
      compactionHook(compactionEvent)
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
        assert.equal(readRes.stdout, "", `Read hook with placeholder ${placeholder} emitted stdout`)

        // Test Write
        const writeRes = cp.spawnSync("sh", ["-c", writeCmd], {
          input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
          env: { ...process.env, MEMOREAL_HOME: tempHome, MEMOREAL_API_KEY: placeholder },
          encoding: "utf8",
        })
        assert.equal(writeRes.status, 0)
        assert.equal(writeRes.stdout, "", `Write hook with placeholder ${placeholder} emitted stdout`)

        // Test Edit
        const editRes = cp.spawnSync("sh", ["-c", editCmd], {
          input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
          env: { ...process.env, MEMOREAL_HOME: tempHome, MEMOREAL_API_KEY: placeholder },
          encoding: "utf8",
        })
        assert.equal(editRes.status, 0)
        assert.equal(editRes.stdout, "", `Edit hook with placeholder ${placeholder} emitted stdout`)
      }
    })

    test("Hooks emit contextual memory prompts when valid API key is present", () => {
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
      assert.match(readRes.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)

      // Write on code file
      const writeRes = cp.spawnSync("sh", ["-c", writeCmd], {
        input: JSON.stringify({ tool_input: { file_path: "src/index.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(writeRes.status, 0)
      assert.match(writeRes.stdout, /\[memoreal-encode-code\] Code file written: src\/index\.ts/)

      // Edit on code file
      const editRes = cp.spawnSync("sh", ["-c", editCmd], {
        input: JSON.stringify({ tool_input: { file_path: "src/index.ts" } }),
        env: validEnv,
        encoding: "utf8",
      })
      assert.equal(editRes.status, 0)
      assert.match(editRes.stdout, /\[memoreal-encode-code\] Code file edited: src\/index\.ts/)
    })

    test("hooks.json: placeholder MEMOREAL_API_KEY in environment falls through to valid MEMORIA_API_KEY", () => {
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
      assert.match(res.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)
    })

    test("hooks.json: placeholder MEMOREAL_API_KEY in environment falls through to valid config.env key", () => {
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
      assert.match(res.stdout, /\[memoreal-recall-doc\] Reading: README\.md/)
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
})
