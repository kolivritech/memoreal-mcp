# /memoria-wrap-up — Session Wrap-Up

Summarize this session and encode learnings into Memoria long-term memory.

## Steps

1. Derive the namespace: run `$HOME/.memoria/bin/memoria-ns` or replace `/` with `-` in the working directory path.

2. Review what happened this session. Summarize:
   - What was the goal? What was accomplished?
   - Key decisions made and their rationale
   - Bugs found, root causes identified, fixes applied
   - Patterns or architecture insights learned
   - What was harder than expected? What went smoothly?
   - Open questions, unfinished work, next steps

3. Encode each category into Memoria using `encode_memory` with the derived namespace:
   - **(type: episodic, salience: 0.7)** Session summary: goal, accomplishments, outcome
   - **(type: semantic, salience: 0.8)** Decisions and rationale (one memory per major decision)
   - **(type: semantic, salience: 0.8)** Lessons learned: what to do differently, what worked well
   - **(type: semantic, salience: 0.6)** Code patterns or architecture insights
   - **(type: episodic, salience: 0.5)** Open questions and next steps
   Include `[["source", "wrap-up"], ["session_date", "<today>"]]` in the context metadata for each.

4. Run `consolidate` on the namespace to merge any duplicates with existing memories.

5. Print a short summary of what was encoded (count of memories, key topics).
