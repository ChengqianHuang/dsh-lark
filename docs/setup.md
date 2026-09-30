# Set up your bot

English | [简体中文](setup.zh-CN.md)

This guide starts with a working dsh `web` profile and ends with a direct-message task. The bridge is tested against dsh `0.1.2-alpha.5` and the event protocol exposed by `lark-cli 1.0.27`. Live delivery also depends on your tenant's app configuration and permissions.

## 1. Prepare the host

Install and configure [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Complete a task in its Web UI before connecting chat so you know the model, tools, workspace, and permissions work. The npm package is `@deepseek-ai/dsh`; this plugin is not a standalone agent.

Install and configure the [official Lark CLI](https://github.com/larksuite/cli#installation--quick-start). Its app setup stores credentials; the plugin uses that configuration and does not accept app secrets in YAML. Select the correct Lark or Feishu brand during CLI setup.

```sh
lark-cli --version
lark-cli event schema im.message.receive_v1 --json
```

The event schema must list `bot` as an allowed identity and expose `event_id`, `message_id`, `chat_id`, `chat_type`, `sender_id`, `message_type`, and rendered `content`. Use the CLI's setup flow to create or configure your app if this prerequisite is missing.

## 2. Configure the app

In your [Feishu developer console](https://open.feishu.cn/app) or [Lark developer console](https://open.larksuite.com/app), enable the app's bot capability and make it available to your account. Subscribe to the `im.message.receive_v1` event and enable the receive/send permissions required by your tenant. The CLI's receive schema declares `im:message.p2p_msg:readonly`; groups also require permission to receive messages that mention the bot. Replying requires an app messaging permission such as `im:message:send_as_bot`; consult the [receive event](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive) and [reply API](https://open.feishu.cn/document/server-docs/im-v1/message/reply) references. Publish or approve the app changes as required by your tenant.

The bridge consumes as `bot` and replies as the same bot. User login does not grant the app missing permissions. Follow the developer-console link in a CLI permission error to fix app scopes.

## 3. Find your sender ID

The allowlist uses your app-specific `open_id` (`ou_…`), not your display name, email, or `user_id`. If you do not already have it, stop the bridge, then run this bounded listener and send a harmless direct message to the bot:

```sh
lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 60s
```

Wait for the `[event] ready` notice before sending. Copy `sender_id` from the resulting event; use `chat_id` for a chat allowlist. Treat the event as private because it includes message text. This is a manual tenant verification step; the repository's automated checks use synthetic events and never send Lark messages.

## 4. Install and verify

Follow the [README quickstart](../README.md#use-this-package), or adapt the [personal example](../examples/personal.patch.yml). Set `locale: zh-CN` for Chinese command notices. Start with `groupPolicy: disabled`; permission requests remain in the dsh Web UI.

Send `/help`, `/status`, then a read-only question such as “What files are in this workspace?”. Confirm the answer replies to your message and the session appears in the Web UI. Send a follow-up to check context, then `/new` to start a separate conversation. An idle chat starts a fresh session on its next message after `sessionIdleMinutes`.

To enable groups, use the [group example](../examples/group.patch.yml), invite the bot to the allowed chat, and begin each task with its exact `@display name`. Everyone in that group can see replies, and authorized senders share its session.

## Configuration placement

The bundle inserts the `lark` row; your profile patch overrides that row by `id`. A patch replaces its entire `config` value, so retain every setting you need in a single entry. Do not edit the bundle's own `cordis.patch.yml` for personal settings.

The host reads profiles under `$DSH_HOME/profiles`, or `~/.dsh/profiles` when `DSH_HOME` is unset. A missing workspace is created at startup. See [configuration](configuration.md) for defaults and [troubleshooting](troubleshooting.md) for failures.
