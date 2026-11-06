# Session context usage

Each desktop chat has a Context row above Terminal and Conversation. It uses the
latest native report. It does not show cumulative token consumption or account
quota usage.

## Behavior

| Provider | Data | Display |
| --- | --- | --- |
| Codex | `token_count.info.last_token_usage.total_tokens`, `model_context_window` | Percent and used/limit tokens; missing fields stay unknown |
| Claude Code | Latest main assistant message: input + cache read + cache creation; window of its `message.model` | Percent and used/limit tokens; an unknown model leaves the limit unknown |
| OpenCode | Latest completed main assistant message: input + output + reasoning + cache read/write | Tokens; limit unknown |
| Antigravity | Latest `gen_metadata` row of `~/.gemini/antigravity-cli/conversations/<id>.db`: `context_window_metadata.estimated_tokens_used`, `max_context_tokens` | Percent and used/limit tokens (CLI estimate) |
| Kimi, shell | No context telemetry in the current integration | Unavailable |

Codex percent is the raw used/window ratio, rounded to a whole percent. The CLI
can show a different percent because it reserves a baseline. No Codex window is
inferred from a model name. Claude excludes output from its context input count.

Data updates through existing session events. Native file polling is 400 ms;
OpenCode polling is 300 ms; Antigravity database polling is 1 s. Counts can lag
while a request runs. The tooltip
describes the source and shows the native timestamp when present.

- Each managed session owns its own snapshot. Switching tabs does not copy it.
- Start, reconnect, and native Codex rollout changes clear the old snapshot.
- Resume reads at most 4 MiB before the launch boundary for context only. It does
  not replay old activity or completion notices. Saved snapshots are not trusted
  after service startup.
- Input containing Enter/newlines or a submitted message clears the snapshot.
  This covers native compact, new, clear, and resume commands without interpreting
  the CLI input editor. Ordinary input can therefore also show Unknown briefly.
- Native compact events clear counts until the next usage report. OpenCode
  activity changes cannot restore an old count. Summary and child-agent usage is
  excluded where the native schema marks it.
- Transcript truncation or read failure clears counts. Clear terminal scrollback
  preserves context. A disconnected UI hides its old counts.

Claude transcripts do not report a context-window limit. The limit comes from
Anthropic's model table (`claudeContextWindow` in `native-context.mjs`): 1M for
Opus and Sonnet 4.6 and later, Haiku 5.5 and later, Fable and Mythos; 200K for
older models. A count above that window, such as Sonnet 4.5 with the 1M option,
hides the limit. `<synthetic>` messages are ignored. Update the table when a new
model family ships. This change does not replace user status-line settings or
hooks.

Antigravity (agy 1.4.7) stores each conversation as SQLite in WAL mode with
protobuf rows. The service opens the bound conversation read-only with
`node:sqlite` and decodes only `chat_model(1).chat_start_metadata(9).
context_window_metadata(10)` of the latest `gen_metadata` row. Field numbers come
from the descriptors embedded in the agy binary. A schema change or a missing
`node:sqlite` shows Unavailable. `estimated_tokens_used` is the CLI's own count
for its compaction limit and is higher than the provider's input token count.
An unchanged latest row is not reported again after input clears the row. OpenCode message events also lack a
window limit. Unsupported or changed schemas stay unknown. Switching to a new
Claude conversation inside its CLI can leave the row unknown: this change does
not add Claude native-ID discovery. Managed resume and same-session compact are
supported. Large histories without recent telemetry can also remain unknown.

## Implementation

- `desktop/service/native-context.mjs`: strict native count parsing and unknown
  states. `native-events.mjs`: context events and bounded resume reads.
- `desktop/service/sessions.mjs`: per-session state, broadcast, and reset paths.
- `desktop/service/antigravity.mjs`: read-only Antigravity conversation database
  polling. `native-context.mjs` also holds the Claude window table.
- `desktop/service/opencode/observer.mjs`, `opencode.mjs`: native OpenCode counts
  and independent context revision tracking.
- `src/desktop/ContextUsage.tsx`, `Chats.tsx`, `types.ts`, `desktop.css`: readable
  context row, meter, and explicit unknown states. Rust has no telemetry role.
- `desktop/service/test/context-usage.test.mjs`, `context-usage-ui.mjs`: parser,
  lifecycle, freshness, and browser regression checks. `package.json` includes
  the new UI check in `desktop:test:ui`.

## Verification

Checks cover native counts, cumulative-count rejection, malformed/missing
fields, zero usage, child/summary exclusion, isolated sessions, resume without
activity replay, compact/reset, truncation, OpenCode freshness, disconnected UI,
and readable widths of 320, 500, 900, and 1440 px.

Run service checks with `npm test`, UI checks with
`MRMAK_TEST_BROWSER=chromium node desktop/service/test/context-usage-ui.mjs`,
and build/lint with `npm run build` and `npm run lint`. UI fixtures use synthetic
records and terminals. They do not start provider CLIs or use accounts.

## Native source references

- [Codex context and cumulative token semantics](https://github.com/openai/codex/blob/main/codex-rs/tui/src/token_usage.rs)
- [Claude context input and cache accounting](https://code.claude.com/docs/en/statusline#context-window-fields)
- [OpenCode native context display](https://github.com/anomalyco/opencode/blob/v1.3.0/packages/opencode/src/cli/cmd/tui/routes/session/header.tsx)
