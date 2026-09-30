# Troubleshooting

English | [简体中文](troubleshooting.zh-CN.md)

Start with the symptom below. Keep credentials and message content out of public logs; include the plugin, dsh, Node.js, and `lark-cli` versions when reporting a reproducible bug.

| Symptom | Check and recovery |
|---|---|
| Startup rejects an empty sender list | Set your app-specific `open_id` in `allowedSenders`. Avoid broadening access just to bypass the check. |
| `lark-cli` cannot be found | Run `lark-cli --version` in the same environment that launches dsh, or set an absolute `larkCliPath`. |
| Missing `lib/index.mjs` | Run `pnpm build` in the plugin checkout before linking it. Direct GitHub installation of unbuilt source is not a supported install path. |
| Bot-name detection fails | Set the exact `botName`, or use `groupPolicy: disabled` for direct messages. |
| Consumer never becomes ready | Inspect the local dsh log for CLI setup, event subscription, scope, or network errors. Check `lark-cli event schema im.message.receive_v1 --json` and the [setup guide](setup.md). |
| `/help` receives no reply | Confirm app availability, bot membership, the sender's app-specific ID, chat allowlist, and text message type. In groups, put the bot mention first and check `groupPolicy`. |
| Direct messages work, group messages do not | Enable receive permissions for bot mentions, add the bot to the allowed group, and use its exact display name. |
| Task waits without an answer | Use `/status`, then inspect the dsh Web UI for a tool approval or model error. Lark cannot approve pending tools. |
| Busy or capacity response | Wait for work to finish, use `/stop` to discard a chat's queued work, or `/new` to release its session. Raise limits only after checking host capacity. |
| Answer is cut short | Increase `maxReplyChars` within Lark's message limits, or inspect the full answer in the dsh session. |
| Replies arrive as separate messages | An anchored reply failed and the sender fell back to posting in the chat. Inspect local logs for the failed reply. |
| Reply cannot be delivered | Check the app's send permission and chat membership. Failed delivery is logged locally; there is no durable outgoing queue. |
| Duplicate work after a restart | Event deduplication is bounded and held in memory. Check for multiple bridge instances and inspect the session before resending a task. |

## Inspect event consumers

```sh
lark-cli event status --json
```

This read-only command shows local consumers. Multiple tools may share the CLI event daemon; identify the owning process before stopping anything. Stop the owning dsh instance normally so the plugin can unsubscribe. Avoid force-killing the consumer because the CLI may need to remove a server-side subscription.

## Verify configuration without connecting

```sh
dsh --profile web --dump-config
```

Locate the `dsh-lark` layer and the `lark` row. Confirm the final `config`, especially if home-level or launch-time patches also target this row. The dump composes configuration; it does not establish a Lark connection or validate tool permissions.

If the problem remains, open a [bug report](https://github.com/ChengqianHuang/dsh-lark/issues/new?template=bug_report.yml) with a minimal redacted configuration and reproduction. Report security issues through the [security policy](../SECURITY.md).
