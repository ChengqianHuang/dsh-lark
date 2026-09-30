---
description: "Run local dsh tasks from Lark or Feishu and receive each task's answer in chat."
kind: "package-bundle"
---

# dsh-lark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![CI](https://github.com/ChengqianHuang/dsh-lark/actions/workflows/ci.yml/badge.svg)](https://github.com/ChengqianHuang/dsh-lark/actions/workflows/ci.yml)

**Your local coding agent, a chat message away.**

English | [简体中文](README.zh-CN.md)

## Summary

Send your Lark or Feishu bot a task. [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) runs it in your local workspace and replies to the message that started it. Review a change, investigate a failing test, or ask about your code while keeping the session available in the dsh Web UI.

- **Continue the conversation.** Each chat keeps its own session; follow-up messages retain context.
- **Stay in control.** Restrict senders and chats, inspect `/status`, interrupt with `/stop`, and start fresh with `/new`.
- **Use your existing dsh setup.** Sessions inherit the host's default agent preset and permission policy.
- **Keep setup local.** The bridge uses [lark-cli](https://github.com/larksuite/cli) event subscriptions; it opens no public webhook endpoint.

Example prompts: “Explain this repository's entry points”, “Review the changes in my workspace”, or “Find why the parser test fails”. Available actions depend on your dsh tools and permissions.

## Table of Contents

- [Use this package](#use-this-package)
- [Commands](#commands)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

You need a working dsh installation, Node.js `^22.19.0 || >=24.0.0`, pnpm, and a configured Lark or Feishu bot with `lark-cli` on your PATH. The current compatibility target is dsh `0.1.2-alpha.5`; see [setup](docs/setup.md) for credentials, scopes, and your sender ID.

### 1. Build and install the bundle

```sh
git clone https://github.com/ChengqianHuang/dsh-lark.git
cd dsh-lark
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add "$PWD"
```

The local checkout is linked into the `web` profile. Rebuild it after changing source. If you run dsh from source, use `pnpm dsh` from the harness repository for the `dsh` commands; pass the absolute plugin directory to `add`.

### 2. Allow your account

Merge this entry into `${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml`, replacing the example sender ID. Keep any existing entries in that file.

```yaml
- id: lark
  config:
    allowedSenders: [ou_your_open_id]
    workspacePath: ~/projects/my-project
    groupPolicy: disabled
    locale: en
```

Start with direct messages. To enable groups, use `groupPolicy: mentions` and restrict `allowedChats`; see the [configuration reference](docs/configuration.md). An empty sender allowlist fails startup unless you explicitly enable `allowAllSenders`. The example uses English notices; set `locale: zh-CN` for Chinese.

### 3. Start and try it

```sh
dsh --profile web --dump-config
dsh web
```

The config dump should contain the `dsh-lark` layer and your settings; it does not check Lark connectivity. Send `/help` to your bot, then ask it to describe the workspace. Open the session in the Web UI to inspect tool activity or handle permission requests.

To remove the bundle, run `dsh plugin --profile web remove dsh-lark`. Saved dsh session history remains subject to your host's retention policy.

<a id="commands"></a>
## Commands

| Message | Result |
|---|---|
| Plain text | Run one task in this chat's session; additional tasks wait in a bounded queue. |
| `/status` | Show the current session, running state, and queue without waiting for a task. |
| `/stop` | Cancel the current bridge task and clear pending messages. |
| `/new` | Cancel bridge work, clear pending messages, and reset this chat's session. |
| `/help` | Show available commands immediately. |

In groups, begin with the bot's exact `@display name`. Unknown slash commands return help and never run as agent prompts. Bot notices support English and Simplified Chinese; the model chooses its answer language from the conversation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Message flow and session ownership</summary>

`lark-cli` delivers message events → sender/chat checks admit them → a chat queue submits a dsh turn → the bridge selects that turn's recorded answer → `lark-cli` replies to its originating message.

The bundle's [patch](cordis.patch.yml) installs the `lark` row. The [service](https://github.com/ChengqianHuang/dsh-lark/blob/main/src/index.ts) owns the event consumer and [router](https://github.com/ChengqianHuang/dsh-lark/blob/main/src/bridge.ts); the host owns agents, tools, credentials, permissions, and durable session history. See [design](DESIGN.md) for concurrency, disposal, and delivery guarantees.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Setup](docs/setup.md) · [Configuration](docs/configuration.md) · [Troubleshooting](docs/troubleshooting.md)
- [Security and data handling](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)
- [Personal and group examples](examples/)

<a id="model-experience"></a>
## Model Experience

Accepted text becomes a logged user message with its Lark chat, sender, and message IDs. The bridge removes the leading bot mention and handles slash commands itself. The agent preset provides tools and prompts; the bridge adds no model tool. Only the completed turn's final text is sent back to chat, subject to the configured length limit.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Text messages and plain-text replies are supported. Attachments, cards, streamed replies, and approvals inside Lark are not supported. Long answers are truncated; inspect the dsh session for the full response.

Chat sessions share the configured filesystem workspace and host permissions. Group members can see replies and share that group's conversation context. Chat bindings, queued messages, and deduplication memory do not survive plugin restarts. This is a trusted-user integration, with no exactly-once delivery guarantee; review the [security model](SECURITY.md) before adding other users.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
