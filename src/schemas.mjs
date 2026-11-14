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

export const MCP_TOOLS = Object.freeze([
  {
    name: 'encode_memory',
    description:
      'Store a new memory with tier classification (episodic, semantic, buffer, core), salience weight, and key-value context metadata.',
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
    description: 'Encode multiple memories atomically in a single batch call.',
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
    description:
      'Retrieve relevant memories ranked deterministically by BM25, salience, tier weight, feedback utility, and temporal freshness.',
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
    description:
      'Assemble a token-budgeted <memory_context> block combining Core rules, Semantic facts, and Episodic history for session grounding.',
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
    description: 'Delete a specific memory and its incident graph edges by ID.',
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
    description: 'Delete all memories matching a specific context metadata [key, value] pair.',
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
    description: 'Record whether a recalled memory was useful and adjust its salience score.',
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
    description:
      'Deduplicate memories within a namespace, link superseded records, and promote recurring high-salience episodic memories to Semantic tier.',
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
    description: 'Return Memoria engine health, storage status, tier distribution, and cloud sync mode.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stats',
    description: 'Return detailed memory, edge, and tier statistics for a namespace.',
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
    description:
      'Search indexed code definitions and workspace source files by symbol or query, returning ranked definitions with file and line numbers.',
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
    description:
      'Explain a code symbol: where it is defined, who references it across the workspace, related tests, and associated architectural memories.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Symbol or identifier to explain.' },
        namespace: { type: 'string', description: 'Optional Memoria namespace.' },
        depth: {
          type: 'string',
          enum: ['shallow', 'standard', 'deep'],
          default: 'standard',
          description: 'Analysis depth.',
        },
        path: { type: 'string', description: 'Optional workspace directory to scan.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'list_agent_wings',
    description:
      'List specialist multi-agent wings (architect, reviewer, qa, security, ops), their active memory counts, and recent handoffs.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Optional namespace filter.' },
      },
    },
  },
  {
    name: 'handoff_to_agent',
    description:
      'Hand off task context, architectural findings, and selected memory IDs from one specialist agent wing to another.',
    inputSchema: {
      type: 'object',
      properties: {
        from_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Originating specialist wing.',
        },
        to_wing: {
          type: 'string',
          enum: ['architect', 'reviewer', 'qa', 'security', 'ops'],
          description: 'Target specialist wing.',
        },
        summary: { type: 'string', description: 'Concise summary of findings and constraints.' },
        task: { type: 'string', description: 'Actionable task for the target wing.' },
        namespace: { type: 'string', description: 'Project or workspace namespace.' },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of memory IDs to attach to the handoff.',
        },
      },
      required: ['from_wing', 'to_wing', 'summary', 'task'],
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
