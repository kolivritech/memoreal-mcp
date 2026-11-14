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
  'Memoria Cloud provides deterministic long-term memory and code intelligence across sessions. Set MEMORIA_API_KEY from https://memoria.kolivri.com/register. At session start, call build_context with the workspace namespace and a task query (plus health in parallel). Before re-reading files or assuming missing context, call recall_memories, search_code, or explain_code. Persist durable architectural decisions, root causes, and user rules via encode_memory or batch_encode, rate recalled items with feedback, and run consolidate periodically to merge duplicates.';

export const MCP_TOOLS = Object.freeze([
  {
    name: 'encode_memory',
    title: 'Encode Memory',
    description:
      'Store a new memory with tier classification (episodic, semantic, buffer, core), salience weight, and key-value context metadata.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Memory content to store.' },
        type: {
          type: 'string',
          enum: MEMORY_TYPES,
          default: 'episodic',
          description: 'Memory tier: episodic, semantic, buffer, or core.',
        },
        namespace: {
          type: 'string',
          description: 'Project or workspace namespace (e.g. pwd with "/" replaced by "-").',
        },
        salience: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.5,
          description: 'Importance weight between 0.0 and 1.0.',
        },
        context: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Optional list of [key, value] metadata pairs.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'batch_encode',
    title: 'Batch Encode Memories',
    description: 'Encode multiple memories atomically in a single batch call.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Default namespace for memories in the batch.' },
        memories: {
          type: 'array',
          description: 'Array of memory objects to encode.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              type: { type: 'string', enum: MEMORY_TYPES, default: 'episodic' },
              namespace: { type: 'string' },
              salience: { type: 'number', minimum: 0, maximum: 1 },
              context: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            required: ['content'],
          },
        },
      },
      required: ['memories'],
    },
  },
  {
    name: 'recall_memories',
    title: 'Recall Memories',
    description:
      'Retrieve relevant memories ranked deterministically by BM25, salience, tier weight, feedback utility, and temporal freshness.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against stored memories.' },
        namespace: { type: 'string', description: 'Namespace filter (omit to search default or all).' },
        token_budget: {
          type: 'integer',
          default: 4096,
          description: 'Maximum token budget for returned memories.',
        },
        mode: {
          type: 'string',
          enum: CONTEXT_MODES,
          description: 'Optional retrieval context mode override.',
        },
        limit: {
          type: 'integer',
          default: 20,
          description: 'Maximum number of memories to return.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'build_context',
    title: 'Build Session Context',
    description:
      'Assemble a token-budgeted <memory_context> block combining Core rules, Semantic facts, and Episodic history for session grounding.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic or task query to ground context around.' },
        namespace: { type: 'string', description: 'Project or workspace namespace.' },
        token_budget: {
          type: 'integer',
          default: 4096,
          description: 'Maximum token budget for assembled context (default 4096).',
        },
        mode: {
          type: 'string',
          enum: CONTEXT_MODES,
          description: 'Optional retrieval context mode override.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'forget_memory',
    title: 'Forget Memory',
    description: 'Delete a specific memory and its incident graph edges by ID.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique memory ID to remove.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_by_context',
    title: 'Delete Memories by Context',
    description: 'Delete all memories matching a specific context metadata [key, value] pair.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Metadata key to match.' },
        value: { type: 'string', description: 'Metadata value to match.' },
        namespace: { type: 'string', description: 'Optional namespace scope.' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'feedback',
    title: 'Record Memory Feedback',
    description: 'Record whether a recalled memory was useful and adjust its salience score.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to rate.' },
        useful: { type: 'boolean', description: 'True if helpful, false if noisy or outdated.' },
      },
      required: ['id', 'useful'],
    },
  },
  {
    name: 'consolidate',
    title: 'Consolidate Namespace Memories',
    description:
      'Deduplicate memories within a namespace, link superseded records, and promote recurring high-salience episodic memories to Semantic tier.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace to consolidate.' },
      },
      required: ['namespace'],
    },
  },
  {
    name: 'health',
    title: 'Check Memoria Health',
    description: 'Return Memoria engine health, storage status, tier distribution, and cloud sync mode.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stats',
    title: 'Get Namespace Statistics',
    description: 'Return detailed memory, edge, and tier statistics for a namespace.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace to inspect.' },
      },
      required: ['namespace'],
    },
  },
  {
    name: 'search_code',
    title: 'Search Indexed Code',
    description:
      'Search indexed code definitions and workspace source files by symbol or query, returning ranked definitions with file and line numbers.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name or code search query.' },
        namespace: { type: 'string', description: 'Optional Memoria namespace.' },
        type: {
          type: 'string',
          default: 'any',
          description: 'Definition kind filter (function, class, const, file, or any).',
        },
        path: { type: 'string', description: 'Optional workspace directory to scan.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'explain_code',
    title: 'Explain Code Symbol',
    description:
      'Explain a code symbol: where it is defined, who references it across the workspace, related tests, and associated architectural memories.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Symbol or identifier to explain (provide target or symbol).' },
        symbol: { type: 'string', description: 'Alias for target symbol identifier (provide target or symbol).' },
        namespace: { type: 'string', description: 'Optional Memoria namespace.' },
        depth: {
          type: 'string',
          enum: ['shallow', 'standard', 'deep'],
          default: 'standard',
          description: 'Analysis depth.',
        },
        path: { type: 'string', description: 'Optional workspace directory to scan.' },
      },
      required: [],
    },
  },
  {
    name: 'list_agent_wings',
    title: 'List Specialist Agent Wings',
    description:
      'List specialist multi-agent wings (architect, reviewer, qa, security, ops), their active memory counts, and recent handoffs.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Optional namespace filter.' },
      },
    },
  },
  {
    name: 'handoff_to_agent',
    title: 'Hand Off Context to Specialist Wing',
    description:
      'Hand off task context, architectural findings, and selected memory IDs from one specialist agent wing to another.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Target specialist wing (alias: to_wing).',
        },
        to_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Target specialist wing.',
        },
        from_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Originating specialist wing.',
        },
        from_agent: {
          type: 'string',
          description: 'Originating agent or wing identifier.',
        },
        summary: { type: 'string', description: 'Concise summary of findings and constraints.' },
        task: { type: 'string', description: 'Optional actionable task for the target wing.' },
        namespace: { type: 'string', description: 'Project or workspace namespace.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of relevant file paths.',
        },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of memory IDs to attach to the handoff.',
        },
      },
      required: ['summary'],
    },
  },
]);

export const MCP_RESOURCES = Object.freeze([
  {
    uri: 'memory://rules',
    name: 'Memoria Core & High-Salience Rules',
    description: 'Active Core and high-salience Semantic rules, corrections, and invariants.',
    mimeType: 'application/json',
  },
  {
    uri: 'memory://recent',
    name: 'Memoria Recent Memories',
    description: 'Most recently encoded episodic and semantic memories across active sessions.',
    mimeType: 'application/json',
  },
  {
    uri: 'memory://stats',
    name: 'Memoria Store & Graph Statistics',
    description: 'Global and per-namespace counts, tier distribution, and graph edge metrics.',
    mimeType: 'application/json',
  },
]);

export const MCP_PROMPTS = Object.freeze([
  {
    name: 'memoria-session-start',
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
    name: 'memoria-wrap-up',
    description: 'Apply the Memoria write gate, encode session learnings, and consolidate duplicate memories.',
    arguments: [
      {
        name: 'namespace',
        description: 'Workspace namespace to consolidate.',
        required: false,
      },
    ],
  },
  {
    name: 'memoria-handoff',
    description: 'Prepare a structured context handoff between specialist agent wings (architect, reviewer, qa, security, ops).',
    arguments: [
      { name: 'from_wing', description: 'Source agent wing.', required: true },
      { name: 'to_wing', description: 'Destination agent wing.', required: true },
      { name: 'task', description: 'Task description for the receiving wing.', required: true },
    ],
  },
]);
