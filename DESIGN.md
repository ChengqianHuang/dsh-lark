# Design

English | [简体中文](DESIGN.zh-CN.md)

This reference describes message ownership and failure handling. User configuration belongs in the [configuration reference](docs/configuration.md); the [Agent Note](https://github.com/ChengqianHuang/dsh-lark/blob/main/.agents/notes/implemented/architecture/2026-10-01-owned-chat-turns.md) records the decisions behind these rules.

## One chat, one session

The router maintains one active session per chat and serializes ordinary prompts within that chat. Other chats can progress independently. Waiting messages and active chats have explicit capacity limits. Idle expiry is checked when work arrives; it does not interrupt an active task.

A new session attaches to the configured workspace, uses the selected model, mounts the explicit or host-default agent preset, and applies the optional permission preset. Session text and Lark source identifiers enter the host's durable log. The bridge's chat-to-session map remains in memory, so a plugin restart creates new bindings while host session history remains available.

## Reply ownership

Every submitted user message has its own dsh message ID. The bridge correlates the recorded turn to that ID and extracts only the assistant messages within the corresponding turn. Work submitted from the Web UI or another producer cannot replace the answer selected for a Lark reply.

Cancellation and failure take precedence over partial assistant text. The bridge sends a localized status instead of treating unfinished text as a completed answer. Normal answers are truncated by Unicode code point, anchored to the triggering Lark message, and sent with bot identity. If an anchored reply fails, a separate message in the same chat is attempted; failure of both attempts is recorded locally.

## Commands and shutdown

`/help` and `/status` bypass the task queue. `/stop` cancels the bridge's current request and clears its pending queue. `/new` also releases the session so the next ordinary message begins fresh. A command is processed only after sender, chat, and mention checks pass.

Disposal stops admission and restarts, cancels bridge work, releases session handles, and waits for the event consumer to close. The CLI receives stdin EOF for graceful unsubscribe; the plugin does not force-kill the consumer. An unresponsive CLI can therefore delay shutdown. Local logs remain the source for diagnosing such failures.

## Event transport

The plugin starts one `lark-cli event consume im.message.receive_v1 --as bot` child. It keeps stdin open during consumption and waits for the exact stderr ready marker before dispatching stdout events. A startup error or readiness timeout fails initialization; unexpected exit after readiness triggers a delayed restart.

Recent event IDs are bounded in memory and survive a consumer restart within the same plugin instance. They do not survive a plugin reload or host restart. There is no durable inbox, outgoing queue, or exactly-once execution promise. A network timeout can leave delivery status ambiguous, especially when the reply path falls back to a chat send.

## Installed peers and duplicate Cordis instances

The bundle installs its pinned `@deepseek-ai/*` peers into its own `node_modules`, so typecheck and tests run without a harness checkout. When the profile loads the linked bundle, Node resolves the plugin's Cordis import from that local store, and the process hosts two Cordis module instances: the host's and the bundle's. This works only because Cordis keys its wiring symbols through `Symbol.for`, which all instances share. Any Cordis change that introduces ordinary `Symbol` identity, module-level registries, or `instanceof` checks across the host/plugin seam is breaking for this bundle and must be re-reviewed.

## Trust and extension points

The plugin accepts text only, requires an explicit sender policy, and verifies a leading group mention against the configured or discovered bot name. Shell interpolation is not used for transport commands; text is passed as an argument. All authorized chats still share the workspace and host tool permissions, as described in [security](SECURITY.md).

The host's existing agent, preset, workspace, and permission services own execution. The plugin introduces no new model tool, HTTP endpoint, or alternate agent loop. Changes to attachments, approvals, or streaming must preserve logged inputs, reply ownership, cancellation, and the configured resource limits.
