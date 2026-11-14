import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeNamespaceStats, computeStoreHealth, consolidateNamespace, explainWorkspaceCode, listStoreAgentWings, performAgentHandoff, searchWorkspaceCode } from './code-intel.mjs';
import { AGENT_WINGS, CONTEXT_MODES, MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS, MEMORY_TYPES } from './schemas.mjs';

export { AGENT_WINGS, CONTEXT_MODES, MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS, MEMORY_TYPES };

const TIER_MAP = Object.freeze({ episodic: 'Episodic', semantic: 'Semantic', buffer: 'Buffer', core: 'Core' });
const TIER_WEIGHT = Object.freeze({ Core: 1.3, Semantic: 1.15, Episodic: 1.0, Buffer: 0.9 });

export function tokenizeText(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function normalizeContextPairs(rawContext) {
  if (!rawContext) return [];
  if (Array.isArray(rawContext)) {
    const pairs = [];
    for (const item of rawContext) {
      if (Array.isArray(item) && item.length >= 2) {
        pairs.push([String(item[0]), String(item[1])]);
      } else if (item && typeof item === 'object') {
        for (const [k, v] of Object.entries(item)) {
          pairs.push([String(k), String(v)]);
        }
      } else if (typeof item === 'string') {
        pairs.push(['tag', item]);
      }
    }
    return pairs;
  }
  if (typeof rawContext === 'object') {
    return Object.entries(rawContext).map(([k, v]) => [String(k), String(v)]);
  }
  if (typeof rawContext === 'string') {
    return [['note', rawContext]];
  }
  return [];
}

function resolveDefaultStoragePath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.MEMORIA_STORAGE_PATH) return path.resolve(process.env.MEMORIA_STORAGE_PATH);
  return path.join(os.homedir(), '.memoria', 'local-memories.json');
}

export class LocalMemoryStore {
  constructor(options = {}) {
    this.storagePath = resolveDefaultStoragePath(options.storagePath);
    this.defaultNamespace = options.defaultNamespace || process.env.MEMORIA_NAMESPACE || 'default';
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.startedAt = Date.now();
    this.state = {
      version: 1,
      memories: [],
      edges: [],
      handoffs: [],
    };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state.memories = Array.isArray(parsed.memories) ? parsed.memories : [];
          this.state.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
          this.state.handoffs = Array.isArray(parsed.handoffs) ? parsed.handoffs : [];
        }
      }
    } catch {
      this.state = { version: 1, memories: [], edges: [], handoffs: [] };
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      const fallbackDir = path.join(os.tmpdir(), '.memoria');
      fs.mkdirSync(fallbackDir, { recursive: true });
      this.storagePath = path.join(fallbackDir, 'local-memories.json');
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
    }
  }

  encodeMemory(args = {}) {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!content) {
      throw new Error('Validation error: "content" is required and must be a non-empty string.');
    }

    const rawType = typeof args.type === 'string' ? args.type.trim().toLowerCase() : 'episodic';
    const type = MEMORY_TYPES.includes(rawType) ? rawType : 'episodic';
    const tier = TIER_MAP[type] || 'Episodic';
    const namespace =
      typeof args.namespace === 'string' && args.namespace.trim()
        ? args.namespace.trim()
        : this.defaultNamespace;

    const rawSalience = args.salience === undefined ? 0.5 : Number(args.salience);
    const salience = Number.isFinite(rawSalience)
      ? Math.min(1, Math.max(0, Number(rawSalience.toFixed(4))))
      : 0.5;

    const context = normalizeContextPairs(args.context);
    const nowIso = new Date().toISOString();
    const hash = crypto
      .createHash('sha1')
      .update(`${namespace}:${type}:${content}:${Date.now()}:${Math.random()}`)
      .digest('hex')
      .slice(0, 12);
    const id = `mem_${hash}`;

    const record = {
      id,
      namespace,
      type,
      tier,
      content,
      context,
      salience,
      useful_count: 0,
      not_useful_count: 0,
      superseded_by: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const newTokens = new Set(tokenizeText(content));
    for (const existing of this.state.memories) {
      if (existing.namespace !== namespace || existing.superseded_by) continue;
      const existingTokens = tokenizeText(existing.content);
      if (existingTokens.length === 0 || newTokens.size === 0) continue;
      const overlap = existingTokens.filter((t) => newTokens.has(t)).length;
      const jaccard = overlap / new Set([...existingTokens, ...newTokens]).size;
      if (jaccard >= 0.85 && existing.type === type) {
        existing.superseded_by = id;
        existing.updated_at = nowIso;
        this.state.edges.push({
          from: id,
          to: existing.id,
          relation: 'Supersedes',
          weight: Number(jaccard.toFixed(3)),
          created_at: nowIso,
        });
      } else if (jaccard >= 0.35) {
        this.state.edges.push({
          from: id,
          to: existing.id,
          relation: 'RelatedTo',
          weight: Number(jaccard.toFixed(3)),
          created_at: nowIso,
        });
      }
    }

    this.state.memories.push(record);
    this._save();

    return {
      id: record.id,
      status: 'encoded',
      namespace: record.namespace,
      type: record.type,
      tier: record.tier,
      salience: record.salience,
      context: record.context,
      created_at: record.created_at,
    };
  }

  batchEncode(args = {}) {
    if (!Array.isArray(args.memories) || args.memories.length === 0) {
      throw new Error('Validation error: "memories" must be a non-empty array.');
    }
    const defaultNs = args.namespace || this.defaultNamespace;
    const encoded = [];
    for (const item of args.memories) {
      const res = this.encodeMemory({
        ...item,
        namespace: item.namespace || defaultNs,
      });
      encoded.push(res);
    }
    return {
      status: 'encoded',
      encoded_count: encoded.length,
      ids: encoded.map((e) => e.id),
      namespace: defaultNs,
      memories: encoded,
    };
  }

  _scoreMemories(query, namespace, limit = 20) {
    const active = this.state.memories.filter(
      (m) => !m.superseded_by && (!namespace || m.namespace === namespace)
    );
    if (active.length === 0) return [];

    const queryTokens = tokenizeText(query);
    const queryLower = (query || '').toLowerCase().trim();
    const docs = active.map((m) => {
      const ctxText = (m.context || []).map(([k, v]) => `${k} ${v}`).join(' ');
      const tokens = tokenizeText(`${m.content} ${ctxText}`);
      return { memory: m, tokens, length: Math.max(1, tokens.length) };
    });

    const avgDocLen = docs.reduce((acc, d) => acc + d.length, 0) / docs.length;
    const df = new Map();
    for (const qToken of queryTokens) {
      let count = 0;
      for (const d of docs) {
        if (d.tokens.includes(qToken)) count++;
      }
      df.set(qToken, count);
    }

    const k1 = 1.5;
    const b = 0.75;
    const N = docs.length;
    const nowMs = Date.now();

    const scored = docs.map(({ memory, tokens, length }) => {
      let bm25 = 0;
      for (const qToken of queryTokens) {
        const tf = tokens.filter((t) => t === qToken).length;
        if (tf === 0) continue;
        const n_q = df.get(qToken) || 0;
        const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));
        const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (length / avgDocLen)));
        bm25 += idf * normTf;
      }

      if (queryLower && memory.content.toLowerCase().includes(queryLower)) {
        bm25 += 1.5;
      }

      const ageHours = Math.max(
        0,
        (nowMs - new Date(memory.created_at || nowMs).getTime()) / (1000 * 3600)
      );
      const freshness = 1 / (1 + ageHours / 168);
      const tierBoost = TIER_WEIGHT[memory.tier] || 1.0;
      const feedbackDelta = (memory.useful_count - memory.not_useful_count) * 0.05;
      const effectiveSalience = Math.min(1, Math.max(0.05, memory.salience + feedbackDelta));

      const score = Number(
        ((bm25 * 0.65 + effectiveSalience * 0.25 + freshness * 0.1) * tierBoost).toFixed(4)
      );

      return {
        ...memory,
        score,
        bm25: Number(bm25.toFixed(4)),
      };
    });

    const matched = queryTokens.length > 0 ? scored.filter((s) => s.bm25 > 0) : scored;
    const pool = matched.length > 0 ? matched : scored;
    pool.sort((a, b) => b.score - a.score || b.salience - a.salience);
    return pool.slice(0, Math.max(1, limit));
  }

  recallMemories(args = {}) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('Validation error: "query" is required.');
    }
    const namespace = args.namespace ? String(args.namespace).trim() : undefined;
    const tokenBudget = Number(args.token_budget) > 0 ? Number(args.token_budget) : 4096;
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
    const mode = args.mode || 'operational';

    const ranked = this._scoreMemories(query, namespace, limit);
    const selected = [];
    let usedTokens = 0;

    for (const item of ranked) {
      const estTokens = Math.max(1, Math.ceil(item.content.length / 4));
      if (usedTokens + estTokens > tokenBudget && selected.length > 0) break;
      usedTokens += estTokens;
      selected.push({
        id: item.id,
        namespace: item.namespace,
        type: item.type,
        tier: item.tier,
        content: item.content,
        salience: item.salience,
        score: item.score,
        context: item.context,
        created_at: item.created_at,
      });
    }

    return {
      memories: selected,
      count: selected.length,
      namespace: namespace || 'all',
      query,
      mode,
      token_budget: tokenBudget,
      tokens_used: usedTokens,
    };
  }

  buildContext(args = {}) {
    const query = typeof args.query === 'string' ? args.query.trim() : 'recent context';
    const namespace = args.namespace ? String(args.namespace).trim() : undefined;
    const tokenBudget = Number(args.token_budget) > 0 ? Number(args.token_budget) : 4096;
    const mode = args.mode || 'operational';

    const recalled = this.recallMemories({
      query,
      namespace,
      token_budget: tokenBudget,
      mode,
      limit: 30,
    });

    const coreRules = recalled.memories.filter((m) => m.type === 'core' || m.salience >= 0.85);
    const semanticFacts = recalled.memories.filter(
      (m) => m.type === 'semantic' && !coreRules.includes(m)
    );
    const episodic = recalled.memories.filter(
      (m) => !coreRules.includes(m) && !semanticFacts.includes(m)
    );

    const lines = ['<memory_context>'];
    if (coreRules.length > 0) {
      lines.push('## Core Rules & Invariants');
      for (const m of coreRules) {
        lines.push(`- ${m.content} [id: ${m.id}, salience: ${m.salience.toFixed(2)}]`);
      }
    }
    if (semanticFacts.length > 0) {
      lines.push('## Established Facts');
      for (const m of semanticFacts) {
        lines.push(`- ${m.content} [id: ${m.id}, salience: ${m.salience.toFixed(2)}]`);
      }
    }
    if (episodic.length > 0) {
      lines.push('## Recent Context');
      for (const m of episodic) {
        lines.push(`- ${m.content} [id: ${m.id}, salience: ${m.salience.toFixed(2)}]`);
      }
    }
    if (recalled.memories.length === 0) {
      lines.push('No prior memories matched this namespace/query.');
    }
    lines.push('</memory_context>');

    return {
      context: lines.join('\n'),
      memories_used: recalled.memories.length,
      namespace: namespace || this.defaultNamespace,
      mode,
      token_budget: tokenBudget,
      tokens_used: recalled.tokens_used,
    };
  }

  forgetMemory(args = {}) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      throw new Error('Validation error: "id" is required.');
    }
    const beforeCount = this.state.memories.length;
    this.state.memories = this.state.memories.filter((m) => m.id !== id);
    const deleted = this.state.memories.length < beforeCount;
    this.state.edges = this.state.edges.filter((e) => e.from !== id && e.to !== id);
    for (const m of this.state.memories) {
      if (m.superseded_by === id) m.superseded_by = null;
    }
    if (deleted) this._save();
    return { id, deleted };
  }

  deleteByContext(args = {}) {
    const key = typeof args.key === 'string' ? args.key.trim() : '';
    const value = typeof args.value === 'string' ? args.value.trim() : '';
    if (!key || !value) {
      throw new Error('Validation error: both "key" and "value" are required.');
    }
    const namespace = args.namespace ? String(args.namespace).trim() : undefined;
    const removedIds = [];

    this.state.memories = this.state.memories.filter((m) => {
      if (namespace && m.namespace !== namespace) return true;
      const matches = (m.context || []).some(([k, v]) => k === key && v === value);
      if (matches) {
        removedIds.push(m.id);
        return false;
      }
      return true;
    });

    if (removedIds.length > 0) {
      const idSet = new Set(removedIds);
      this.state.edges = this.state.edges.filter((e) => !idSet.has(e.from) && !idSet.has(e.to));
      this._save();
    }

    return {
      deleted_count: removedIds.length,
      deleted_ids: removedIds,
      key,
      value,
      namespace: namespace || 'all',
    };
  }

  feedback(args = {}) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id || typeof args.useful !== 'boolean') {
      throw new Error('Validation error: "id" (string) and "useful" (boolean) are required.');
    }
    const target = this.state.memories.find((m) => m.id === id);
    if (!target) {
      throw new Error(`Memory not found: "${id}"`);
    }
    if (args.useful) {
      target.useful_count = (target.useful_count || 0) + 1;
      target.salience = Math.min(1, Number((target.salience + 0.08).toFixed(4)));
    } else {
      target.not_useful_count = (target.not_useful_count || 0) + 1;
      target.salience = Math.max(0.05, Number((target.salience - 0.08).toFixed(4)));
    }
    target.updated_at = new Date().toISOString();
    this._save();
    return {
      id: target.id,
      useful: args.useful,
      salience: target.salience,
      useful_count: target.useful_count,
      not_useful_count: target.not_useful_count,
      updated: true,
    };
  }

  consolidate(args = {}) {
    return consolidateNamespace(this, tokenizeText, args);
  }

  health(extra = {}) {
    return computeStoreHealth(this, extra);
  }

  stats(args = {}) {
    return computeNamespaceStats(this, args);
  }

  searchCode(args = {}) {
    return searchWorkspaceCode(args, this.workspaceRoot);
  }

  explainCode(args = {}) {
    return explainWorkspaceCode(this, args);
  }

  listAgentWings(args = {}) {
    return listStoreAgentWings(this, args);
  }

  handoffToAgent(args = {}) {
    return performAgentHandoff(this, args);
  }
}
