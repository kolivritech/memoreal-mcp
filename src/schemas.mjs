export const MEMORY_TYPES = Object.freeze(['episodic', 'semantic', 'buffer', 'core']);
export const CONTEXT_MODES = Object.freeze([
  'organizational',
  'research',
  'operational',
  'sales',
  'support',
  'personal',
]);
export const AGENT_WINGS = Object.freeze([
  {
    id: 'architect',
    name: 'Architect Wing',
    focus: 'System boundaries, module contracts, design logs, and long-term invariants.',
  },
  {
    id: 'reviewer',
    name: 'Reviewer Wing',
    focus: 'Blast radius, caller/callee verification, regression detection, and code hygiene.',
  },
  {
    id: 'qa',
    name: 'QA & Verification Wing',
    focus: 'End-to-end integration tests, edge cases, reproduction proofs, and test gaps.',
  },
  {
    id: 'security',
    name: 'Security Wing',
    focus: 'Auth boundaries, secret hygiene, injection guards, and input validation.',
  },
  {
    id: 'ops',
    name: 'Operations & Release Wing',
    focus: 'Deployments, Docker/runtime health, migrations, and observability.',
  },
]);

export const MCP_SERVER_INSTRUCTIONS =
  'Memoreal Cloud provides deterministic long-term memory and code intelligence across sessions. If unauthenticated or MEMOREAL_API_KEY is missing, run the 3-Click Interactive In-Chat Wizard via AskUserQuestion (in Claude Code) or question (in OpenCode & Cursor) and never ask users to paste raw API keys into chat: Step 1 ("Connect in 1 Click via Google / Browser (Recommended)" vs "Skip for this session"), Step 2 (call connect_account with action: "start", present the verification link /connect?code=XXXX-YYYY, and offer the "I clicked Authorize — Verify" card calling connect_account with action: "status"), and Step 3 ("Yes — Index repo now (Recommended)" vs "Later"). At session start, call build_context with the workspace namespace and a task query (plus health in parallel). Before re-reading files or assuming missing context, call recall_memories, search_code, or explain_code. Persist durable architectural decisions, root causes, and user rules via encode_memory or batch_encode, rate recalled items with feedback, and run consolidate periodically to merge duplicates.';

export const MCP_TOOLS = Object.freeze([
  {
    name: 'encode_memory',
    title: 'Encode Memory',
    description:
      'Store a single memory record in Memoreal Cloud (requires MEMOREAL_API_KEY; consumes 1 Write API call; non-idempotent: encoding identical text twice creates separate IDs until consolidate is run) and return { id, namespace, salience }. Defaults type to "episodic", salience to 0.5 (items >=0.7 or semantic/core surface in memory://rules), and namespace to MEMOREAL_NAMESPACE or "default" while rejecting reserved "org:" prefixes. Use when persisting one architectural decision, bug root cause, or user rule; use batch_encode instead for 2+ memories at once, or handoff_to_agent for cross-wing task handoffs.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Non-empty memory text to persist.' },
        type: {
          type: 'string',
          enum: MEMORY_TYPES,
          default: 'episodic',
          description: 'Memory tier classification (core and semantic receive 1.5x/1.25x recall boosts).',
        },
        namespace: {
          type: 'string',
          description: 'Logical project or workspace namespace (defaults to MEMOREAL_NAMESPACE or "default"; never prefix with "org:").',
        },
        salience: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.5,
          description: 'Importance weight from 0.0 to 1.0 (use >=0.7 for durable team rules).',
        },
        context: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Optional [key, value] string pairs (for example [["file", "src/auth.js"]]) targetable by delete_by_context.',
        },
      },
      required: ['content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Newly created memory UUID.' },
        namespace: { type: 'string', description: 'Resolved logical namespace.' },
        salience: { type: 'number', description: 'Stored salience weight (0.0-1.0).' },
      },
      required: ['id', 'namespace', 'salience'],
    },
  },
  {
    name: 'batch_encode',
    title: 'Batch Encode Memories',
    description:
      'Store multiple memories atomically in one request (requires MEMOREAL_API_KEY; consumes max(1, memories.length) Write API calls; non-idempotent) and return { ids, encoded }. Validates every item namespace before writing so any reserved "org:" prefix aborts the entire batch cleanly; items inherit top-level namespace (or MEMOREAL_NAMESPACE) and default to type="episodic" and salience=0.5. Use when checkpointing or importing 2+ memories together; use encode_memory instead for a single memory write.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Fallback logical namespace applied to batch items that omit namespace.' },
        memories: {
          type: 'array',
          description: 'Non-empty array of memory objects to persist atomically.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Memory text to persist.' },
              type: { type: 'string', enum: MEMORY_TYPES, default: 'episodic', description: 'Memory tier classification.' },
              namespace: { type: 'string', description: 'Optional per-item logical namespace override (never prefix with "org:").' },
              salience: { type: 'number', minimum: 0, maximum: 1, default: 0.5, description: 'Importance weight from 0.0 to 1.0.' },
              context: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Optional [key, value] metadata pairs.' },
            },
            required: ['content'],
          },
        },
      },
      required: ['memories'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Created memory UUIDs in input order.' },
        encoded: { type: 'integer', description: 'Total number of memories stored.' },
      },
      required: ['ids', 'encoded'],
    },
  },
  {
    name: 'recall_memories',
    title: 'Recall Memories',
    description:
      'Retrieve up to limit (default 20) deterministically ranked memory records for a query (read-only, idempotent; consumes 1 Read API call) and return { results, total_candidates } with per-item { memory, score }. Ranks up to 500 candidates in namespace by lexical/BM25 match, salience, tier boost (core=1.5x, semantic=1.25x), and 30-day freshness; mode biases domain relevance (organizational, research, operational, sales, support, personal) while limit caps item count independently of token_budget. Use when you need individual memory IDs, metadata, or scores (for inspection, feedback, or forget_memory); use build_context instead for a pre-formatted <memory_context> prompt block, or search_code for code symbols.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or natural-language question to match against stored memories.' },
        namespace: { type: 'string', description: 'Logical workspace namespace filter (defaults to MEMOREAL_NAMESPACE or "default"; never prefix with "org:").' },
        token_budget: {
          type: 'integer',
          default: 4096,
          description: 'Advisory token budget hint (~4 chars/token) for sizing downstream context.',
        },
        mode: {
          type: 'string',
          enum: CONTEXT_MODES,
          description: 'Optional domain retrieval profile override (organizational, research, operational, sales, support, or personal).',
        },
        limit: {
          type: 'integer',
          default: 20,
          description: 'Hard cap on returned { memory, score } items (default 20).',
        },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' }, description: 'Ranked { memory, score } matches.' },
        total_candidates: { type: 'integer', description: 'Total candidate memories evaluated in the namespace.' },
      },
      required: ['results', 'total_candidates'],
    },
  },
  {
    name: 'build_context',
    title: 'Build Session Context',
    description:
      'Assemble a token-budgeted <memory_context> XML/Markdown block from a namespace (read-only, idempotent; consumes 1 Read API call) and return { context, memories_used }. Ranks up to 500 namespace memories deterministically and packs lines greedily up to max(256, token_budget * 4) characters under "## Established Facts" (core/semantic) and "## Recent Context" (episodic/buffer). Use at session start or before planning a task to ground the model in one call; use recall_memories instead when you need raw memory objects and IDs.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Active task, feature, or session topic used to rank relevant facts and history.' },
        namespace: { type: 'string', description: 'Logical workspace namespace (defaults to MEMOREAL_NAMESPACE or "default"; never prefix with "org:").' },
        token_budget: {
          type: 'integer',
          default: 4096,
          description: 'Maximum token budget (~4 characters per token, default 4096) before truncating lower-ranked items.',
        },
        mode: {
          type: 'string',
          enum: CONTEXT_MODES,
          description: 'Optional domain retrieval profile override (organizational, research, operational, sales, support, or personal).',
        },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'Formatted <memory_context>...</memory_context> block.' },
        memories_used: { type: 'integer', description: 'Number of memories packed within token_budget.' },
      },
      required: ['context', 'memories_used'],
    },
  },
  {
    name: 'forget_memory',
    title: 'Forget Memory',
    description:
      'Permanently delete one memory and its incident graph edges by ID (destructive, idempotent; consumes 1 Write API call) and return { deleted }. Enforces organization ownership (rejects foreign IDs) and returns { deleted: false } when the ID is already absent. Use when removing a single known memory UUID; use delete_by_context instead to bulk-delete memories by [key, value] metadata tag, or feedback (useful=false) to lower salience without deleting.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact memory UUID returned by encode_memory or recall_memories.' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: { deleted: { type: 'boolean', description: 'True if an existing memory was removed, false if already absent.' } },
      required: ['deleted'],
    },
  },
  {
    name: 'delete_by_context',
    title: 'Delete Memories by Context',
    description:
      'Permanently bulk-delete all memories whose context array contains an exact [key, value] pair (destructive, idempotent; consumes 1 Write API call) and return { deleted_count }. Scopes deletion to namespace (defaulting to MEMOREAL_NAMESPACE when omitted locally) and rejects reserved "org:" prefixes. Use to purge memories tied to a deleted file, PR, or feature tag; use forget_memory instead when deleting a single memory by UUID.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Exact context tuple key to match (for example "file" or "pr").' },
        value: { type: 'string', description: 'Exact context tuple value to match (for example "src/legacy.js").' },
        namespace: { type: 'string', description: 'Optional logical namespace scope (never prefix with "org:").' },
      },
      required: ['key', 'value'],
    },
    outputSchema: {
      type: 'object',
      properties: { deleted_count: { type: 'integer', description: 'Number of matching memories deleted (0 if none matched).' } },
      required: ['deleted_count'],
    },
  },
  {
    name: 'feedback',
    title: 'Record Memory Feedback',
    description:
      'Adjust a memory salience weight based on recall utility (consumes 1 Write API call; non-idempotent because repeated calls compound the salience delta) and return { updated }. Enforces organization ownership on id; useful=true boosts salience toward 1.0 while useful=false dampens noisy or outdated entries without deleting them. Use after recall_memories to tune future ranking quality; use forget_memory instead for permanent removal, or consolidate to merge duplicate records.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target memory UUID from recall_memories.' },
        useful: { type: 'boolean', description: 'True to boost salience when helpful; false to dampen salience when stale or noisy.' },
      },
      required: ['id', 'useful'],
    },
    outputSchema: {
      type: 'object',
      properties: { updated: { type: 'boolean', description: 'True when the target memory existed and its salience was updated.' } },
      required: ['updated'],
    },
  },
  {
    name: 'consolidate',
    title: 'Consolidate Namespace Memories',
    description:
      'Run an idempotent maintenance pass on a workspace namespace to deduplicate redundant records, link superseded state, and promote recurring high-salience episodic memories to Semantic tier (consumes 1 Write API call; non-destructive to unique facts) and return { namespace, consolidated }. Requires Write permission and a logical namespace (never prefixed with "org:"). Use at session wrap-up after multiple encode_memory calls; use feedback instead to rate one memory, or delete_by_context to purge obsolete tags.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Logical workspace namespace to consolidate (for example "my-project").' },
      },
      required: ['namespace'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Consolidated logical namespace.' },
        consolidated: { type: 'boolean', description: 'True once consolidation completes.' },
      },
      required: ['namespace', 'consolidated'],
    },
  },
  {
    name: 'health',
    title: 'Check Memoreal Health',
    description:
      'Check Memoreal Cloud service status, total organization memory count across all namespaces, and rolling 30-day API quota usage (read-only, idempotent; consumes 1 Read API call) and return { status, memory_count, used_calls_30d, api_call_limit }. Takes no parameters; api_call_limit is null on Unlimited plans. Use to verify connectivity and overall organization quota headroom; use stats instead when you need memory counts scoped to one specific project namespace.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Engine status ("ok" when healthy).' },
        memory_count: { type: 'integer', description: 'Total memories across all organization namespaces.' },
        used_calls_30d: { type: 'integer', description: 'Rolling 30-day billable API calls consumed.' },
        api_call_limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Rolling 30-day quota cap, or null for unlimited.' },
      },
      required: ['status', 'memory_count'],
    },
  },
  {
    name: 'stats',
    title: 'Get Namespace Statistics',
    description:
      'Retrieve the stored memory count for a single logical namespace alongside rolling 30-day organization quota metrics (read-only, idempotent; consumes 1 Read API call) and return { namespace, memory_count, used_calls_30d, api_call_limit }. Rejects reserved "org:" prefixes on namespace. Use when inspecting how many memories exist inside one specific project or wing namespace; use health instead for an organization-wide connectivity and total-memory check, or list_agent_wings for per-wing counts.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Logical workspace namespace to inspect (for example "my-project" or "wing:qa").' },
      },
      required: ['namespace'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Inspected logical namespace.' },
        memory_count: { type: 'integer', description: 'Number of memories stored in this namespace.' },
        used_calls_30d: { type: 'integer', description: 'Rolling 30-day API calls used by the organization.' },
        api_call_limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Rolling 30-day API call quota, or null for unlimited.' },
      },
      required: ['namespace', 'memory_count'],
    },
  },
  {
    name: 'search_code',
    title: 'Search Indexed Code',
    description:
      'Search indexed code symbol definitions, file paths, and reference memories within a namespace (read-only, idempotent; consumes 1 Read API call) and return { results, total_candidates } capped at 20 ranked { memory, score } hits. Requires code memories in namespace (populated via /memoreal-sync-code or encode_memory) and rejects reserved "org:" prefixes. Use to discover where functions, classes, or routes live by keyword; use explain_code instead to inspect callers and invariants of a known symbol, or recall_memories for general prose rules.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Function, class, route, or file keyword to locate.' },
        namespace: { type: 'string', description: 'Logical repository or workspace namespace (defaults to MEMOREAL_NAMESPACE or "default").' },
        type: {
          type: 'string',
          default: 'any',
          description: 'Optional definition kind hint (function, class, const, file, or any).',
        },
        path: { type: 'string', description: 'Optional workspace directory hint.' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' }, description: 'Top ranked { memory, score } code hits (max 20).' },
        total_candidates: { type: 'integer', description: 'Total candidate entries scanned in the namespace.' },
      },
      required: ['results', 'total_candidates'],
    },
  },
  {
    name: 'explain_code',
    title: 'Explain Code Symbol',
    description:
      'Synthesize definitions, caller/callee references, related tests, and architectural notes for a specific code symbol in a namespace (read-only, idempotent; consumes 1 Read API call) and return { results, total_candidates } (up to 20 ranked matches). Pass a non-empty identifier via target or its equivalent alias symbol (throws if both are omitted). Use before editing a known function, class, or module to check its blast radius and invariants; use search_code instead when you only have keywords and need to find symbol names first.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Exact function, class, or module identifier to explain (provide target or symbol).' },
        symbol: { type: 'string', description: 'Equivalent alias for target identifier (provide target or symbol).' },
        namespace: { type: 'string', description: 'Logical repository or workspace namespace (defaults to MEMOREAL_NAMESPACE or "default").' },
        depth: {
          type: 'string',
          enum: ['shallow', 'standard', 'deep'],
          default: 'standard',
          description: 'Optional traversal depth hint (shallow, standard, or deep).',
        },
        path: { type: 'string', description: 'Optional workspace directory hint.' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' }, description: 'Ranked { memory, score } symbol definitions, callers, and architectural rules (max 20).' },
        total_candidates: { type: 'integer', description: 'Total namespace candidates evaluated.' },
      },
      required: ['results', 'total_candidates'],
    },
  },
  {
    name: 'list_agent_wings',
    title: 'List Specialist Agent Wings',
    description:
      'List all five built-in specialist multi-agent wings (architect, reviewer, qa, security, ops), their isolated wing:<id> namespaces, and active memory counts (read-only, idempotent; consumes 1 Read API call) and return { wings }. Always returns all five wings even when memory_count is 0. Use to inspect wing responsibilities and queued handoff volume before delegating work; use handoff_to_agent to record a new cross-wing handoff, or stats to inspect a custom project namespace.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Optional logical workspace namespace context (never prefix with "org:").' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        wings: { type: 'array', items: { type: 'object' }, description: 'Array of { id, label, description, namespace, memory_count } wing descriptors.' },
      },
      required: ['wings'],
    },
  },
  {
    name: 'handoff_to_agent',
    title: 'Hand Off Context to Specialist Wing',
    description:
      'Persist a high-salience (0.9) Semantic handoff memory into a target specialist wing namespace (wing:<target>) (consumes 1 Write API call; non-idempotent: repeated calls create distinct handoff records) and return { id, wing, namespace }. Accepts destination via wing or alias to_wing (defaults to "architect") and sender via from_agent or alias from_wing (defaults to "agent"), attaching files and memory_ids as searchable context tuples. Use when delegating findings and next steps between architect, reviewer, qa, security, or ops agents; use encode_memory instead for general project memories.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Destination specialist wing (preferred; defaults to "architect" if both wing and to_wing are omitted).',
        },
        to_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Alias for destination wing used when wing is omitted.',
        },
        from_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Originating specialist wing (used when from_agent is omitted).',
        },
        from_agent: {
          type: 'string',
          description: 'Originating agent or role identifier (preferred; defaults to "agent").',
        },
        summary: { type: 'string', description: 'Required concise summary of findings, architectural constraints, and current state.' },
        task: { type: 'string', description: 'Optional concrete follow-up action appended for the receiving wing.' },
        namespace: { type: 'string', description: 'Optional logical workspace namespace context.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional file paths attached as ["file", path] context tags.',
        },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional related memory UUIDs attached as ["memory_id", id] context tags.',
        },
      },
      required: ['summary'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Created handoff memory UUID.' },
        wing: { type: 'string', description: 'Resolved destination wing ID.' },
        namespace: { type: 'string', description: 'Target wing namespace (for example "wing:qa").' },
      },
      required: ['id', 'wing', 'namespace'],
    },
  },
  {
    name: 'connect_account',
    title: 'Connect Memoreal Account',
    description:
      'Connect or pair this workspace with Memoreal Cloud via the 3-Click browser OAuth device pairing wizard (does not require an existing API key; safe and non-destructive; persists 0600 config.env upon authorization). Action "start" generates a user code, launches the browser authorization URL, and starts background polling. Action "status" checks device authorization progress. Use when onboarding an unauthenticated user or reconnecting expired credentials without asking the user to copy-paste raw API keys into chat; use health instead when already authenticated to check connection status and API quota.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status'],
          default: 'start',
          description: 'Pairing action to perform: "start" to request a device code and open browser, or "status" to verify pairing progress.',
        },
        open_browser: {
          type: 'boolean',
          default: true,
          description: 'Whether to automatically launch the default system browser for authorization (defaults to true).',
        },
        client_name: {
          type: 'string',
          description: 'Optional host IDE or client name (for example "Claude Code", "OpenCode", or "Cursor").',
        },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['already_connected', 'waiting_for_browser', 'connected', 'not_started', 'denied', 'expired'],
          description: 'Current device authorization state.',
        },
        message: {
          type: 'string',
          description: 'Human-readable status summary or next-step guidance.',
        },
        api_url: {
          type: 'string',
          description: 'Resolved Memoreal Cloud API URL.',
        },
        user_code: {
          type: 'string',
          description: 'Short 8-character user code shown to the user on the device authorization screen.',
        },
        verification_uri: {
          type: 'string',
          description: 'Base browser URL where the user enters the code.',
        },
        verification_uri_complete: {
          type: 'string',
          description: 'Full browser URL pre-filled with the device code for 1-click authorization.',
        },
        expires_in: {
          type: 'integer',
          description: 'Device code lifetime in seconds remaining.',
        },
        browser_opened: {
          type: 'boolean',
          description: 'Whether the operating system browser was successfully launched.',
        },
        workspace: {
          type: 'object',
          description: 'Connected organization and workspace metadata (secret keys are stripped).',
        },
      },
      required: ['status', 'message'],
    },
  },
]);

export const MCP_RESOURCES = Object.freeze([
  {
    uri: 'memory://rules',
    name: 'Memoreal Core & High-Salience Rules',
    description: 'Active Core and high-salience Semantic rules, corrections, and invariants.',
    mimeType: 'application/json',
  },
  {
    uri: 'memory://recent',
    name: 'Memoreal Recent Memories',
    description: 'Most recently encoded episodic and semantic memories across active sessions.',
    mimeType: 'application/json',
  },
  {
    uri: 'memory://stats',
    name: 'Memoreal Store & Graph Statistics',
    description: 'Global and per-namespace counts, tier distribution, and graph edge metrics.',
    mimeType: 'application/json',
  },
]);

export const MCP_PROMPTS = Object.freeze([
  {
    name: 'memoreal-session-start',
    description: 'Load token-budgeted project context and check engine health at the start of an AI coding session.',
    arguments: [
      {
        name: 'namespace',
        description: 'Workspace namespace (pwd with "/" replaced by "-").',
        required: false,
      },
    ],
  },
  {
    name: 'memoreal-wrap-up',
    description: 'Apply the Memoreal write gate, encode session learnings, and consolidate duplicate memories.',
    arguments: [
      {
        name: 'namespace',
        description: 'Workspace namespace to consolidate.',
        required: false,
      },
    ],
  },
  {
    name: 'memoreal-handoff',
    description: 'Prepare a structured context handoff between specialist agent wings (architect, reviewer, qa, security, ops).',
    arguments: [
      { name: 'from_wing', description: 'Source agent wing.', required: true },
      { name: 'to_wing', description: 'Destination agent wing.', required: true },
      { name: 'task', description: 'Task description for the receiving wing.', required: true },
    ],
  },
]);
