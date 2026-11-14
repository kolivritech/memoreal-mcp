import fs from 'node:fs';
import path from 'node:path';
import { AGENT_WINGS } from './schemas.mjs';

export function walkSourceFiles(rootDir, maxFiles = 150) {
  const results = [];
  const allowedExts = new Set(['.mjs', '.js', '.ts', '.tsx', '.py', '.rs', '.go', '.md']);
  const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next']);

  function walk(dir) {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (ignoredDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && allowedExts.has(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }

  walk(rootDir);
  return results;
}

export function searchWorkspaceCode(args = {}, defaultRoot = process.cwd()) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('Validation error: "query" is required.');
  }
  const rootDir = args.path ? path.resolve(args.path) : defaultRoot;
  const files = walkSourceFiles(rootDir);
  const qLower = query.toLowerCase();
  const hits = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(qLower)) continue;
      const isDef =
        /\b(function|class|const|let|export|def|fn|struct|enum|interface|type)\b/.test(line);
      hits.push({
        name: query,
        kind: isDef ? 'definition' : 'reference',
        file: path.relative(rootDir, file) || path.basename(file),
        line: i + 1,
        snippet: line.trim().slice(0, 180),
        score: isDef ? 1.0 : 0.6,
      });
      if (hits.length >= 40) break;
    }
    if (hits.length >= 40) break;
  }

  hits.sort((a, b) => b.score - a.score);
  return {
    query,
    type: args.type || 'any',
    count: hits.length,
    results: hits.slice(0, 20),
  };
}

export function explainWorkspaceCode(store, args = {}) {
  const target = typeof args.target === 'string' ? args.target.trim() : '';
  if (!target) {
    throw new Error('Validation error: "target" symbol is required.');
  }
  const searchRes = store.searchCode({ query: target, path: args.path });
  const definitions = searchRes.results.filter((r) => r.kind === 'definition');
  const references = searchRes.results.filter((r) => r.kind === 'reference');
  const relatedTests = searchRes.results.filter((r) => /test|spec/i.test(r.file));
  const relatedMemories = store._scoreMemories(target, args.namespace, 5).map((m) => ({
    id: m.id,
    content: m.content,
    salience: m.salience,
  }));

  return {
    target,
    depth: args.depth || 'standard',
    definitions,
    references,
    related_tests: relatedTests,
    related_memories: relatedMemories,
    summary: `Found ${definitions.length} definition(s), ${references.length} reference(s), and ${relatedTests.length} test hit(s) for "${target}".`,
  };
}

export function computeStoreHealth(store, extra = {}) {
  const active = store.state.memories.filter((m) => !m.superseded_by);
  const tiers = { Semantic: 0, Episodic: 0, Core: 0, Buffer: 0 };
  const namespaces = new Set();
  for (const m of active) {
    tiers[m.tier] = (tiers[m.tier] || 0) + 1;
    namespaces.add(m.namespace);
  }
  return {
    status: 'healthy',
    engine: 'memoria-mcp',
    version: '1.0.0',
    mode: extra.cloudSyncEnabled ? 'cloud-hybrid' : 'local-standalone',
    storage_path: store.storagePath,
    memory_count: active.length,
    total_records: store.state.memories.length,
    edge_count: store.state.edges.length,
    namespace_count: namespaces.size,
    tier_distribution: tiers,
    uptime_ms: Date.now() - store.startedAt,
  };
}

export function computeNamespaceStats(store, args = {}) {
  const namespace = typeof args.namespace === 'string' ? args.namespace.trim() : store.defaultNamespace;
  const active = store.state.memories.filter((m) => m.namespace === namespace && !m.superseded_by);
  const tiers = { Semantic: 0, Episodic: 0, Core: 0, Buffer: 0 };
  let salienceSum = 0;
  const ids = new Set();
  for (const m of active) {
    tiers[m.tier] = (tiers[m.tier] || 0) + 1;
    salienceSum += m.salience;
    ids.add(m.id);
  }
  const edgeCount = store.state.edges.filter((e) => ids.has(e.from) || ids.has(e.to)).length;
  const handoffCount = store.state.handoffs.filter((h) => h.namespace === namespace).length;

  return {
    namespace,
    memory_count: active.length,
    edge_count: edgeCount,
    tier_distribution: tiers,
    average_salience: active.length > 0 ? Number((salienceSum / active.length).toFixed(4)) : 0,
    handoff_count: handoffCount,
  };
}

export function listStoreAgentWings(store, args = {}) {
  const namespace = args.namespace ? String(args.namespace).trim() : undefined;
  const wings = AGENT_WINGS.map((w) => {
    const count = store.state.memories.filter(
      (m) =>
        !m.superseded_by &&
        (!namespace || m.namespace === namespace) &&
        (m.context || []).some(([k, v]) => (k === 'wing' || k === 'to_wing') && v === w.id)
    ).length;
    return { ...w, active_memories: count };
  });

  const recentHandoffs = store.state.handoffs
    .filter((h) => !namespace || h.namespace === namespace)
    .slice(-10)
    .reverse();

  return {
    namespace: namespace || 'all',
    wings,
    recent_handoffs: recentHandoffs,
  };
}

export function consolidateNamespace(store, tokenizeText, args = {}) {
  const namespace = typeof args.namespace === 'string' ? args.namespace.trim() : store.defaultNamespace;
  const active = store.state.memories.filter((m) => m.namespace === namespace && !m.superseded_by);
  let mergedCount = 0;
  let promotedCount = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (a.superseded_by) continue;
    const tokensA = new Set(tokenizeText(a.content));
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if (b.superseded_by) continue;
      const tokensB = tokenizeText(b.content);
      if (tokensA.size === 0 || tokensB.length === 0) continue;
      const overlap = tokensB.filter((t) => tokensA.has(t)).length;
      const jaccard = overlap / new Set([...tokensA, ...tokensB]).size;
      if (jaccard >= 0.8) {
        const keeper = a.salience >= b.salience ? a : b;
        const older = keeper === a ? b : a;
        older.superseded_by = keeper.id;
        older.updated_at = nowIso;
        keeper.salience = Math.min(1, Number((keeper.salience + 0.05).toFixed(4)));
        store.state.edges.push({
          from: keeper.id,
          to: older.id,
          relation: 'ConsolidatedInto',
          weight: Number(jaccard.toFixed(3)),
          created_at: nowIso,
        });
        mergedCount++;
      }
    }
    if (a.type === 'episodic' && a.salience >= 0.8 && !a.superseded_by) {
      a.type = 'semantic';
      a.tier = 'Semantic';
      a.updated_at = nowIso;
      promotedCount++;
    }
  }

  if (mergedCount > 0 || promotedCount > 0) store._save();
  const remaining = store.state.memories.filter(
    (m) => m.namespace === namespace && !m.superseded_by
  ).length;

  return {
    namespace,
    merged_count: mergedCount,
    promoted_count: promotedCount,
    active_memories: remaining,
    edge_count: store.state.edges.length,
  };
}

export function performAgentHandoff(store, args = {}) {
  const fromWing = typeof args.from_wing === 'string' ? args.from_wing.trim() : '';
  const toWing = typeof args.to_wing === 'string' ? args.to_wing.trim() : '';
  const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
  const task = typeof args.task === 'string' ? args.task.trim() : '';

  if (!fromWing || !toWing || !summary || !task) {
    throw new Error('Validation error: "from_wing", "to_wing", "summary", and "task" are required.');
  }

  const namespace = args.namespace || store.defaultNamespace;
  const memoryIds = Array.isArray(args.memory_ids) ? args.memory_ids.map(String) : [];
  const encoded = store.encodeMemory({
    namespace,
    type: 'semantic',
    salience: 0.85,
    content: `[Wing Handoff ${fromWing} -> ${toWing}] Summary: ${summary} | Task: ${task}`,
    context: [
      ['wing', toWing],
      ['from_wing', fromWing],
      ['handoff_task', task],
    ],
  });

  const handoff = {
    handoff_id: `hoff_${encoded.id.slice(4)}`,
    memory_id: encoded.id,
    from_wing: fromWing,
    to_wing: toWing,
    namespace,
    summary,
    task,
    memory_ids: memoryIds,
    status: 'handed_off',
    created_at: encoded.created_at,
  };

  store.state.handoffs.push(handoff);
  store._save();
  return handoff;
}
