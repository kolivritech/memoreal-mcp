---
name: memoreal-connect
description: Connect this workspace to Memoreal Cloud via the 3-Click Interactive In-Chat Wizard (legacy alias: /memoria-connect).
---

# /memoreal-connect — 3-Click Interactive In-Chat Wizard

> **Note**: `/memoreal-connect` is the canonical command. `/memoria-connect` is supported as a backward-compatible alias.

Authenticate and pair this IDE workspace with Memoreal Cloud (`https://memoreal.kolivri.com`) using RFC 8628 OAuth device pairing directly within chat.

**Security Invariant:** Never ask the user to paste raw API keys into chat or reveal secrets. All pairing occurs securely through the browser.

---

## 3-Click In-Chat Wizard Flow

Drive the onboarding flow using interactive questions via `AskUserQuestion` (in Claude Code) or `question` (in OpenCode & Cursor).

### Step 1: Connect Card

When unauthenticated or when the user invokes `/memoreal-connect`, present the Step 1 card:

- **Prompt**: "Connect this workspace to Memoreal Cloud for deterministic long-term memory and code intelligence across sessions?"
- **Choices**:
  - `Connect in 1 Click via Google / Browser (Recommended)`
  - `Skip for this session`

If the user chooses `Skip for this session`, acknowledge politely and continue the session with local-only context.

---

### Step 2: Device Pairing & Verification Card

When the user chooses `Connect in 1 Click via Google / Browser (Recommended)`:

1. Call the `connect_account` MCP tool:
   ```json
   {
     "action": "start",
     "open_browser": true
   }
   ```
2. The tool starts background polling, attempts to open the default system browser, and returns `status: "waiting_for_browser"` with `user_code`, `verification_uri`, and `verification_uri_complete`.
3. Display the clickable verification link in chat:
   - Link: `verification_uri_complete` (or `verification_uri` with code `user_code`)
4. Immediately present the Step 2 interactive verification card:
   - **Prompt**: "Authorize Memoreal in your browser to complete pairing, then click below to verify."
   - **Choices**:
     - `I clicked Authorize — Verify`
5. When the user confirms `I clicked Authorize — Verify`, call:
   ```json
   {
     "action": "status"
   }
   ```
6. If `connect_account` returns `status: "connected"`, the session credentials and IDE configs have been hot-reloaded automatically. Proceed to Step 3.
7. If the status is still `waiting_for_browser`, notify the user and offer `I clicked Authorize — Verify` once more.

---

### Step 3: Repo Code-Graph Indexing Card

Once connected, prompt the user to initialize code-graph intelligence:

- **Prompt**: "Memoreal Cloud is connected! Would you like to index this repository's code graph now for intelligent symbol and caller recall?"
- **Choices**:
  - `Yes — Index repo now (Recommended)`
  - `Later`

If the user chooses `Yes — Index repo now (Recommended)`, run `/memoreal-sync-code` to build the semantic code graph. If `Later`, confirm that `build_context`, `encode_memory`, and `recall_memories` are immediately available without restarting the IDE.
