import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const CORRECTION_PATTERNS = [
  "don't",
  "do not",
  "stop",
  "never",
  "wrong",
  "no,",
  "no ",
  "actually",
  "instead",
  "not like that",
  "that's wrong",
  "incorrect",
]

const SKIP_ENCODE_EXT = /\.(json|lock|sum|toml|yaml|yml|cfg|ini)$|\.env/i
const CODE_FILE_EXT =
  /\.(rs|py|ts|tsx|js|jsx|mjs|cjs|go|java|kt|kts|c|h|cc|cpp|hpp|cxx|cs|rb|php|swift|scala|sh|bash|zsh|sql|proto)$/i
const PLAN_PATH_REGEX = /(\.claude\/plans\/|\.opencode\/plans\/|docs\/.*plan|docs\/.*roadmap|design-log\/)/i
const SYSTEM_SKILL_PATH_REGEX =
  /(\/\.claude\/plugins\/|\/\.claude\/skills\/|\/\.agents\/skills\/|\/\.config\/opencode\/)/

export function deriveNamespace(cwd) {
  let p = cwd || process.cwd()
  p = p.replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.opencode\/worktrees\/.*$/, "")
  return p.replace(/\//g, "-")
}

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

export function resolveCloudConfig(homeDir = process.env.HOME || homedir()) {
  const fileVars = {}
  for (const dirName of [".memoreal", ".memoria"]) {
    try {
      const raw = readFileSync(join(homeDir, dirName, "config.env"), "utf8")
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const val = m[2].replace(/^["']|["']$/g, "")
        if (!(m[1] in fileVars)) {
          fileVars[m[1]] = val
        }
      }
    } catch {}
  }

  const rawUrl =
    process.env.MEMOREAL_API_URL ||
    process.env.MEMORIA_API_URL ||
    fileVars.MEMOREAL_API_URL ||
    fileVars.MEMORIA_API_URL ||
    process.env.MEMOREAL_URL ||
    process.env.MEMORIA_URL ||
    fileVars.MEMOREAL_URL ||
    fileVars.MEMORIA_URL ||
    "https://memoria.kolivri.com"
  const candidateUrl = rawUrl.replace(/\/v1\/mcp\/?$/, "").replace(/\/+$/, "")
  const isSafeUrl =
    /^https:\/\/[A-Za-z0-9._:-]+(\/[A-Za-z0-9._/-]*)?$/.test(candidateUrl) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?(\/[A-Za-z0-9._/-]*)?$/.test(candidateUrl)
  const apiUrl = isSafeUrl ? candidateUrl : "https://memoria.kolivri.com"

  const rawKey =
    process.env.MEMOREAL_API_KEY ||
    process.env.MEMORIA_API_KEY ||
    process.env.MEMOREAL_KEY ||
    process.env.MEMORIA_KEY ||
    fileVars.MEMOREAL_API_KEY ||
    fileVars.MEMORIA_API_KEY ||
    fileVars.MEMOREAL_KEY ||
    fileVars.MEMORIA_KEY ||
    ""
  const apiKey = /^[A-Za-z0-9_.-]+$/.test(rawKey) ? rawKey : ""

  return { apiUrl, apiKey }
}

async function fetchSessionStartContext(cwd) {
  const ns = deriveNamespace(cwd)
  const branch = gitOutput(cwd, ["branch", "--show-current"])
  const recent = gitOutput(cwd, ["log", "--oneline", "-3"]).replace(/\n+/g, "; ")
  const changed = gitOutput(cwd, ["diff", "--name-only", "HEAD"]).replace(/\n+/g, ", ")

  const gitParts = []
  if (branch) gitParts.push(`branch: ${branch}`)
  if (recent) gitParts.push(`recent commits: ${recent}`)
  if (changed) gitParts.push(`changed files: ${changed}`)

  let query = "previous tasks, plans, pending work, key decisions, progress, corrections, lessons learned"
  if (gitParts.length > 0) {
    query += `, context for ${gitParts.join(", ")}`
  }

  const { apiUrl, apiKey } = resolveCloudConfig()
  const authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

  try {
    const healthRes = await fetch(`${apiUrl}/v1/health`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(3000),
    })
    if (!healthRes.ok) {
      throw new Error(`health status ${healthRes.status}`)
    }
    const healthText = await healthRes.text()

    const ctxRes = await fetch(`${apiUrl}/v1/memories/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ namespace: ns, query, token_budget: 4096 }),
      signal: AbortSignal.timeout(5000),
    })
    if (!ctxRes.ok) {
      return `[memoreal-session-start] namespace=${ns}. Health: ${healthText}. Call build_context MCP tool with namespace "${ns}" and query "${query}" to load prior context.`
    }
    const ctxText = await ctxRes.text()
    return `[memoreal-session-start] namespace=${ns}\n${healthText}\n---\n${ctxText}`
  } catch {
    return `[memoreal-session-start] namespace=${ns}. Call build_context MCP tool with namespace "${ns}" and query "${query}" and token_budget 4096 to load prior session context.`
  }
}

export function buildReadSuffix(file, ns) {
  if (!file || SYSTEM_SKILL_PATH_REGEX.test(file)) return ""
  if (PLAN_PATH_REGEX.test(file) || /\.md$/i.test(file)) {
    return `\n\n[memoreal-recall-doc] Reading: ${file}\nRecall related memories from Memoreal (namespace: ${ns}) about this file: prior edits, progress updates, decisions, related plans, ideas, reflections, workflow patterns, consolidated patterns, and context from previous sessions. Show the user what Memoreal knows about this file before proceeding.`
  }
  return ""
}

export function buildWriteSuffix(file, ns) {
  if (!file || SKIP_ENCODE_EXT.test(file)) return ""
  if (PLAN_PATH_REGEX.test(file)) {
    return `\n\n[memoreal-encode-plan] Plan file written: ${file}
Encode this plan into Memoreal (namespace: ${ns}). Create MULTIPLE memories:
1. (type: semantic) Plan overview: title, goals, phase structure, and current status
2. (type: semantic) Key decisions and their rationale from this plan
3. (type: episodic) Progress snapshot: what phases are done, what is next, what is blocked
4. (type: semantic) Relationships: other files, systems, or plans referenced in this document
5. (type: semantic) Knowledge: patterns, techniques, or lessons relevant to executing this plan
6. (type: episodic) Ideas and open questions found in the plan
7. (type: semantic) Reflection: what is working well, what is not, what should change in approach
8. (type: semantic) Dream: replay and consolidate — what patterns emerge across related memories, what connections between ideas were missed, what should be strengthened or let go
9. (type: semantic) Workflow: how we are working on this plan — tools, processes, patterns that help or hinder
Include the file path in context metadata for every memory.`
  }
  if (/\.(md|markdown)$/i.test(file)) {
    return `\n\n[memoreal-encode-doc] Markdown document written: ${file}
Encode into Memoreal (namespace: ${ns}). Create memories for:
1. (type: semantic) Document purpose, structure, and key content
2. (type: semantic) Decisions, patterns, or knowledge worth remembering
3. (type: episodic) Relationships to other project work and plans
Include the file path in context metadata.`
  }
  if (CODE_FILE_EXT.test(file)) {
    return `\n\n[memoreal-encode-code] Code file written: ${file}. Re-encode this code into Memoreal (namespace: ${ns}) so search_code, explain_code, and find_references stay current: encode the key definitions (functions, types, classes) with their signatures, purpose, and notable logic as type semantic memories, salience 0.6, with the file path in context. Search before encoding so dedup can merge near-duplicates. For a full structural re-index of the project, run the memoreal-sync-code skill.`
  }
  return `\n\n[memoreal-encode-file] File written: ${file}. Apply write gate: only encode if this file contains a key definition, decision, or pattern worth remembering across sessions. Skip boilerplate. If encoding, use namespace ${ns}, type semantic, salience 0.5. Include file path in context.`
}

export function buildEditSuffix(file, ns) {
  if (!file || SKIP_ENCODE_EXT.test(file)) return ""
  if (PLAN_PATH_REGEX.test(file)) {
    return `\n\n[memoreal-encode-plan] Plan file updated: ${file}
Encode this change into Memoreal (namespace: ${ns}). Create memories for:
1. (type: episodic) What specifically changed in the plan and why
2. (type: episodic) Progress update: mark completed items, note new items or phase transitions
3. (type: semantic) Any new decisions, ideas, or insights from this edit
4. (type: semantic) New relationships or dependencies added
5. (type: semantic) Reflection: does this change reveal something about the approach — what is working, what needs rethinking
6. (type: semantic) Workflow ideas: better ways to work on this plan based on what just happened
Include the file path in context metadata.`
  }
  if (/\.(md|markdown)$/i.test(file)) {
    return `\n\n[memoreal-encode-doc] Markdown document edited: ${file}
Encode the change into Memoreal (namespace: ${ns}):
1. (type: episodic) What changed and why
2. (type: semantic) Any new knowledge, decisions, or patterns
Include the file path in context metadata.`
  }
  if (CODE_FILE_EXT.test(file)) {
    return `\n\n[memoreal-encode-code] Code file edited: ${file}. Re-encode the changed code into Memoreal (namespace: ${ns}): encode the updated definitions and logic (what changed and the new behavior) as type semantic, salience 0.6, with the file path in context, so search_code, explain_code, and find_references reflect the current code. Search before encoding to avoid duplicates. For a full structural re-index, run the memoreal-sync-code skill.`
  }
  return `\n\n[memoreal-encode-file] File edited: ${file}. Apply write gate: only encode if this edit represents a meaningful decision, pattern, or lesson. Skip routine changes. If encoding, use namespace ${ns}, type semantic, salience 0.5. Include file path and what changed.`
}

function buildTodoSuffix(sessionID, todos, previousTodosBySession, ns) {
  const prev = previousTodosBySession.get(sessionID) || new Map()
  const list = Array.isArray(todos) ? todos : []

  let hasNewTask = false
  let hasCompletedTask = false

  const nextMap = new Map()
  for (const t of list) {
    if (!t?.content) continue
    const oldStatus = prev.get(t.content)
    if (!oldStatus) {
      hasNewTask = true
    }
    if (t.status === "completed" && oldStatus !== "completed") {
      hasCompletedTask = true
    }
    nextMap.set(t.content, t.status)
  }
  previousTodosBySession.set(sessionID, nextMap)

  let out = ""
  if (hasNewTask) {
    out += `\n\n[memoreal-encode-task] A task was just created. Encode it into Memoreal via encode_memory with type "episodic" and namespace "${ns}". Include the task description, status, and which plan file it relates to (if any).`
  }
  if (hasCompletedTask) {
    out += `\n\n[memoreal-update-task] A task was just completed. Encode into Memoreal (namespace: ${ns}). Create memories for:
1. (type: episodic) What was accomplished and which plan file it relates to
2. (type: semantic) Lessons learned and knowledge gained from this task
3. (type: semantic) Reflection: what went well, what was harder than expected, what to do differently next time
4. (type: semantic) Workflow ideas: any process improvements or tool usage patterns discovered while doing this task`
  }
  return out
}

export const MemorealHooksPlugin = async ({ directory } = {}) => {
  const sessionStartContextCache = new Map()
  const pendingCorrectionBySession = new Map()
  const previousTodosBySession = new Map()

  return {
    "chat.message": async (input, output) => {
      const sessionID = input?.sessionID
      if (!sessionID) return

      const msg = (output?.parts || [])
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join(" ")
        .toLowerCase()

      const isCorrection = Boolean(msg && CORRECTION_PATTERNS.some((pat) => msg.includes(pat)))
      pendingCorrectionBySession.set(sessionID, isCorrection)
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input?.sessionID || "default"
      const ns = deriveNamespace(directory)

      if (!sessionStartContextCache.has(sessionID)) {
        const ctx = await fetchSessionStartContext(directory)
        sessionStartContextCache.set(sessionID, ctx)
      }
      const startCtx = sessionStartContextCache.get(sessionID)
      if (startCtx && Array.isArray(output?.system)) {
        output.system.push(startCtx)
      }

      if (pendingCorrectionBySession.get(sessionID) && Array.isArray(output?.system)) {
        output.system.push(
          `[memoreal-correction] The user appears to be correcting your approach. After addressing the correction, encode the lesson into Memoreal (namespace: ${ns}, type: semantic, salience: 0.9) as a rule: what was wrong, what the correct approach is, and why. This ensures the mistake is never repeated in future sessions.`
        )
      }
    },

    "tool.execute.after": async (input, output) => {
      const tool = input?.tool
      const args = input?.args || {}
      const ns = deriveNamespace(directory)
      if (typeof output?.output !== "string") return

      if (tool === "read") {
        const file = args.filePath || args.file_path || args.path || ""
        output.output += buildReadSuffix(file, ns)
        return
      }

      if (tool === "write") {
        const file = args.filePath || args.file_path || args.path || ""
        output.output += buildWriteSuffix(file, ns)
        return
      }

      if (tool === "edit" || tool === "patch") {
        const file = args.filePath || args.file_path || args.path || ""
        output.output += buildEditSuffix(file, ns)
        return
      }

      if (tool === "todowrite") {
        const sessionID = input?.sessionID || "default"
        output.output += buildTodoSuffix(sessionID, args.todos, previousTodosBySession, ns)
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      const ns = deriveNamespace(directory)
      output.context.push(
        `[memoreal-pre-compact] Context is about to be compressed. Ensure the following are encoded into Memoreal (namespace: ${ns}) so nothing is lost:
1. (type: episodic) Current task state: what you were working on, what is done, what remains
2. (type: episodic) Key findings so far: bugs found, root causes identified, decisions made
3. (type: episodic) Open questions and blockers
4. (type: semantic) Any code patterns, architecture insights, or facts learned this session
[memoreal-post-compact] After compression, call build_context with namespace "${ns}" and query "current task, recent progress, findings, decisions, open questions, what was I working on" and token_budget 2048 to restore critical context.`
      )
    },

    event: async ({ event }) => {
      if (event?.type === "session.idle") {
        const sessionID =
          event?.properties?.sessionID ||
          event?.properties?.info?.id ||
          event?.sessionID ||
          "default"
        const ns = deriveNamespace(directory)
        sessionStartContextCache.set(
          `${sessionID}:stop`,
          `[memoreal-session-end] Session is ending. Encode a session summary into Memoreal (namespace: ${ns}) with the following write gate — ONLY encode if the item would change future behavior, represents a commitment, or is a decision worth preserving. Skip transient details.
1. (type: episodic, salience: 0.7) Session summary: what was the goal, what was accomplished, what remains unfinished
2. (type: semantic, salience: 0.8) Key decisions made and their rationale — only decisions that affect future work
3. (type: semantic, salience: 0.8) Lessons learned: mistakes made, corrections received, patterns discovered
4. (type: semantic, salience: 0.6) Code patterns or architecture insights worth remembering
5. (type: episodic, salience: 0.5) Open questions and next steps for the next session
Include [["source", "session-end"]] in context metadata for each. Then run consolidate on namespace "${ns}".`
        )
      }
    },
  }
}

function appendResultText(result, suffix) {
  if (!result || !suffix) return
  if (typeof result.content === "string") {
    result.content += suffix
  } else if (Array.isArray(result.content)) {
    result.content = [...result.content, { type: "text", text: suffix.replace(/^\n+/, "") }]
  }
}

export const setup = async (ctx) => {
  const directory = ctx?.location?.directory || process.cwd()
  const sessionStartContextCache = new Map()
  const pendingCorrectionBySession = new Map()
  const previousTodosBySession = new Map()

  await ctx.session.hook("prompt", (event) => {
    const sessionID = event?.sessionID
    if (!sessionID) return
    const msg = (event?.prompt?.text || "").toLowerCase()
    const isCorrection = Boolean(msg && CORRECTION_PATTERNS.some((pat) => msg.includes(pat)))
    pendingCorrectionBySession.set(sessionID, isCorrection)
  })

  await ctx.session.hook("context", async (event) => {
    const sessionID = event?.sessionID || "default"
    const ns = deriveNamespace(directory)

    if (!sessionStartContextCache.has(sessionID)) {
      const startText = await fetchSessionStartContext(directory)
      sessionStartContextCache.set(sessionID, startText)
    }
    const startCtx = sessionStartContextCache.get(sessionID)
    if (startCtx && Array.isArray(event?.system)) {
      event.system.push({ type: "text", text: startCtx })
    }

    const stopKey = `${sessionID}:stop`
    const stopCtx = sessionStartContextCache.get(stopKey)
    if (stopCtx && Array.isArray(event?.system)) {
      event.system.push({ type: "text", text: stopCtx })
      sessionStartContextCache.delete(stopKey)
    }

    if (pendingCorrectionBySession.get(sessionID) && Array.isArray(event?.system)) {
      event.system.push({
        type: "text",
        text: `[memoreal-correction] The user appears to be correcting your approach. After addressing the correction, encode the lesson into Memoreal (namespace: ${ns}, type: semantic, salience: 0.9) as a rule: what was wrong, what the correct approach is, and why. This ensures the mistake is never repeated in future sessions.`,
      })
    }
  })

  await ctx.tool.hook("execute.after", (event) => {
    if (event.status !== "completed" || !event.result) return
    const tool = event.tool
    const args = event.input || {}
    const ns = deriveNamespace(directory)

    if (tool === "read") {
      const file = args.path || args.filePath || args.file_path || ""
      appendResultText(event.result, buildReadSuffix(file, ns))
      return
    }

    if (tool === "write") {
      const file = args.path || args.filePath || args.file_path || ""
      appendResultText(event.result, buildWriteSuffix(file, ns))
      return
    }

    if (tool === "edit" || tool === "patch") {
      const file = args.path || args.filePath || args.file_path || ""
      appendResultText(event.result, buildEditSuffix(file, ns))
      return
    }

    if (tool === "todowrite") {
      const sessionID = event?.sessionID || "default"
      appendResultText(event.result, buildTodoSuffix(sessionID, args.todos, previousTodosBySession, ns))
    }
  })

  await ctx.session.hook("compaction", (event) => {
    const ns = deriveNamespace(directory)
    if (Array.isArray(event?.system)) {
      event.system.push({
        type: "text",
        text: `[memoreal-pre-compact] Context is about to be compressed. Ensure the following are encoded into Memoreal (namespace: ${ns}) so nothing is lost:
1. (type: episodic) Current task state: what you were working on, what is done, what remains
2. (type: episodic) Key findings so far: bugs found, root causes identified, decisions made
3. (type: episodic) Open questions and blockers
4. (type: semantic) Any code patterns, architecture insights, or facts learned this session
[memoreal-post-compact] After compression, call build_context with namespace "${ns}" and query "current task, recent progress, findings, decisions, open questions, what was I working on" and token_budget 2048 to restore critical context.`,
      })
    }
  })

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: ["session.execution.succeeded"],
        signal: controller.signal,
      })) {
        if (event?.type === "session.execution.succeeded") {
          const sessionID = event?.data?.sessionID || "default"
          const ns = deriveNamespace(directory)
          sessionStartContextCache.set(
            `${sessionID}:stop`,
            `[memoreal-session-end] Session is ending. Encode a session summary into Memoreal (namespace: ${ns}) with the following write gate — ONLY encode if the item would change future behavior, represents a commitment, or is a decision worth preserving. Skip transient details.
1. (type: episodic, salience: 0.7) Session summary: what was the goal, what was accomplished, what remains unfinished
2. (type: semantic, salience: 0.8) Key decisions made and their rationale — only decisions that affect future work
3. (type: semantic, salience: 0.8) Lessons learned: mistakes made, corrections received, patterns discovered
4. (type: semantic, salience: 0.6) Code patterns or architecture insights worth remembering
5. (type: episodic, salience: 0.5) Open questions and next steps for the next session
Include [["source", "session-end"]] in context metadata for each. Then run consolidate on namespace "${ns}".`
          )
        }
      }
    } catch {}
  })()

  return () => controller.abort()
}

export default {
  id: "memoreal-hooks",
  server: MemorealHooksPlugin,
  setup,
}
