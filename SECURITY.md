# Security and data handling

English | [简体中文](SECURITY.zh-CN.md)

`dsh-lark` lets approved chat participants submit tasks to an agent running on your machine. Use it with people you trust to exercise the host's configured tools and permissions.

## Access model

A nonempty sender allowlist is required by default. `allowedChats` further restricts where those senders can issue tasks; it does not isolate their filesystem access. `allowAllSenders: true` explicitly permits every sender the bot can receive when the sender list is empty. App availability alone is not a substitute for choosing who may run local tasks.

Each chat has its own conversation, but all chats share `workspacePath` and the host's tool environment. Authorized users can affect the same files. All members of a group can see answers, including information gathered from that shared workspace. An authorized group member can reset or stop the group's bridge session. Use separate host instances and workspaces when users need isolation.

The bridge mounts the configured agent preset and preserves host permission defaults. Approvals happen in dsh; the plugin does not grant approval from chat. A permissive `permissionPreset` increases what a chat message can do. Prompt text and files read by the agent remain untrusted inputs to the model.

## Data and delivery

Accepted prompts and source identifiers are written to the host's session log. The model provider receives data according to the host's model configuration, and final answers go to Lark or Feishu. Review model and chat retention policies before using sensitive workspaces. The plugin has no independent analytics endpoint.

`lark-cli` manages app credentials; dsh manages model credentials. Keep both outside this repository. Local diagnostic logs can contain paths and CLI error details; redact them before sharing.

Recent event IDs, chat bindings, and pending tasks are stored in memory. Restarts discard them. Reply failure may fall back to a new message in the same chat, and ambiguous network failures can result in duplicate delivery. Inspect the session before retrying a task with side effects.

## Report a vulnerability

Use GitHub's **Report a vulnerability** action in this repository's Security tab when available. If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel without including exploit details, credentials, or personal data. Do not post working exploits or sensitive logs in a public issue.

Include affected versions, prerequisites, the impact, and a minimal reproduction using synthetic data. This project is pre-release; fixes target the current development line, with no promised response deadline or long-term support branch.
