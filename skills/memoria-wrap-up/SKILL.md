---
name: memoria-wrap-up
description: Summarize session accomplishments, encode write-gated learnings into Memoria/Memoreal, and consolidate duplicates (canonical: /memoreal-wrap-up).
---

# /memoria-wrap-up — Session Wrap-Up

> **Note**: `/memoreal-wrap-up` is the canonical command. `/memoria-wrap-up` is maintained as a backward-compatible alias.

Summarize this session and encode learnings into Memoreal long-term memory.

## Steps

1. Derive the namespace: run `$HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns` or replace `/` with `-` in the working directory path.
2. Review what happened this session (goal, key decisions, bugs found, root causes, patterns, open questions).
3. Encode each category into Memoreal using `encode_memory` with the derived namespace:
   - **(type: episodic, salience: 0.7)** Session summary
   - **(type: semantic, salience: 0.8)** Decisions and rationale
   - **(type: semantic, salience: 0.8)** Lessons learned
   - **(type: semantic, salience: 0.6)** Code patterns or architecture insights
   - **(type: episodic, salience: 0.5)** Open questions and next steps
   Include `[["source", "wrap-up"], ["session_date", "<today>"]]` in the context metadata for each.
4. Run `consolidate` on the namespace to merge any duplicates with existing memories.
5. Print a short summary of what was encoded.
