# Configuration reference

English | [简体中文](configuration.zh-CN.md)

All settings belong under the `lark` row's `config` in your profile patch. The [personal example](../examples/personal.patch.yml) admits one account in direct messages; the [group example](../examples/group.patch.yml) admits named accounts in one chat. Invalid settings fail startup.

## Access and workspace

| Setting | Default | Meaning |
|---|---|---|
| `allowedSenders` | `[]` | App-specific sender `open_id` values. Must be nonempty unless `allowAllSenders` is explicitly enabled. |
| `allowAllSenders` | `false` | Admit every sender the bot receives; cannot be combined with a nonempty `allowedSenders`. See [security](../SECURITY.md) before enabling. |
| `allowedChats` | `[]` | Restrict accepted chat IDs; empty allows any chat from an authorized sender. |
| `groupPolicy` | `mentions` | `mentions` requires an exact leading bot mention; `disabled` rejects all group messages. |
| `botName` | Auto-detected | Exact bot display name. Required explicitly if group handling is enabled and detection fails. |
| `workspacePath` | `~/.dsh/lark/workspace` | Shared working directory. Must be absolute or begin with `~/`; missing directories are created. |
| `agentPreset` | Host default | Agent preset to mount for new sessions. An explicit unknown preset fails. |
| `permissionPreset` | Host defaults | Optional host permission preset. The plugin does not automatically grant tool permissions. |
| `locale` | `zh-CN` | `zh-CN` or `en` for bridge notices, independent of model answer language. |
| `titlePrefix` | `[lark] ` | Prefix for session titles in dsh. |

## Capacity and timing

| Setting | Default | Meaning |
|---|---|---|
| `sessionIdleMinutes` | `30` | Idle lifetime; the next message after expiry starts a fresh session. |
| `maxPendingMessagesPerChat` | `8` | Maximum waiting tasks per chat, excluding its current task. Excess messages receive a busy response. |
| `maxActiveChats` | `32` | Maximum chat bindings. Expired idle bindings are reclaimed when new work arrives. |
| `maxReplyChars` | `4000` | Maximum Unicode code points, including the ellipsis; longer answers are truncated. |
| `dedupCapacity` | `1000` | Number of recent event IDs retained in memory to suppress redelivery. |
| `restartDelayMs` | `3000` | Delay before restarting an unexpectedly exited event consumer. |
| `ingressReadyTimeoutMs` | `30000` | Maximum wait for the CLI event-consumer ready notice. |
| `egressTimeoutMs` | `30000` | Maximum duration for a CLI request, including preflight and name discovery. |

Numeric limits must be positive. `sessionIdleMinutes` accepts fractions but must represent at least one millisecond within the safe-integer range. Count and millisecond settings require safe integers; restart and CLI timeout values cannot exceed `2147483647` milliseconds. Capacity errors do not silently enqueue extra work.

## Transport

| Setting | Default | Meaning |
|---|---|---|
| `larkCliPath` | `lark-cli` | CLI executable on PATH, or an absolute executable path. |
| `identity` | `bot` | Only `bot` is accepted; the receive event is a bot-only protocol. |

The event key is fixed to `im.message.receive_v1`. Credentials and tenant selection belong to `lark-cli`; model credentials belong to dsh. Keep credentials out of this configuration file.
