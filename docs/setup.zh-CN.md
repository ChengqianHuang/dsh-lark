# 配置机器人

[English](setup.md) | 简体中文

本指南从能够正常使用的 dsh `web` profile 开始，完成一次私聊任务。桥接的验证目标为 dsh `0.1.2-alpha.5` 和 `lark-cli 1.0.27` 提供的事件协议。实际投递还取决于租户中的应用配置和权限。

## 1. 准备宿主

安装并配置 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。接入聊天前，先在 Web UI 完成一次任务，确认模型、工具、工作区和权限都能正常使用。npm 包名为 `@deepseek-ai/dsh`；本插件不能独立运行 agent。

安装并配置[官方 Lark CLI](https://github.com/larksuite/cli#installation--quick-start)。CLI 的应用配置流程负责保存凭据；插件使用这些配置，YAML 中不需要填写应用密钥。配置 CLI 时请选择正确的 Lark 或飞书品牌。

```sh
lark-cli --version
lark-cli event schema im.message.receive_v1 --json
```

事件 schema 必须将 `bot` 列为可用身份，并提供 `event_id`、`message_id`、`chat_id`、`chat_type`、`sender_id`、`message_type` 和已渲染的 `content`。如不满足，请通过 CLI 的配置流程创建或配置应用。

## 2. 配置应用

在[飞书开发者后台](https://open.feishu.cn/app)或 [Lark 开发者后台](https://open.larksuite.com/app)启用应用的机器人能力，并使应用对自己的账号可用。订阅 `im.message.receive_v1` 事件，并开通租户所需的收发消息权限。CLI 的接收事件 schema 声明了 `im:message.p2p_msg:readonly`；群聊还需要接收提及机器人消息的权限。回复需要应用消息权限，例如 `im:message:send_as_bot`，详见[接收事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)和[回复 API](https://open.feishu.cn/document/server-docs/im-v1/message/reply)。按租户要求发布应用变更或完成审批。

桥接使用 `bot` 身份收消息，并以同一机器人身份回复。用户登录不能补充应用缺失的权限；请根据 CLI 权限错误中的开发者后台链接调整应用权限。

## 3. 获取发送者 ID

白名单使用当前应用下的 `open_id`（`ou_…`），不使用显示名、邮箱或 `user_id`。如果尚未获得该 ID，先停止桥接，再运行下面的有限时监听，并向机器人发送一条无敏感内容的私聊消息：

```sh
lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 60s
```

看到 `[event] ready` 提示后再发送消息。从返回事件复制 `sender_id`；聊天白名单使用其中的 `chat_id`。事件含有消息文本，请作为私有信息保存。这是人工验证租户配置的步骤；仓库自动检查使用合成事件，不会发送飞书消息。

## 4. 安装并验证

按 [README 快速开始](../README.zh-CN.md#use-this-package)安装，或调整[个人配置示例](../examples/personal.patch.yml)。使用 `locale: zh-CN` 显示中文命令提示。先设置 `groupPolicy: disabled`；权限审批仍在 dsh Web UI 中处理。

发送 `/help`、`/status`，再问一个只读问题，例如“这个工作区有哪些文件？”。确认回答回复了你的原消息，并且 Web UI 中出现对应会话。继续追问以验证上下文，再用 `/new` 开始独立对话。聊天空闲达到 `sessionIdleMinutes` 后，下一条消息会启动新会话。

启用群聊时请使用[群聊示例](../examples/group.patch.yml)，将机器人加入白名单中的群，每条任务都以准确的 `@显示名` 开头。群内所有成员都能看到回复，已授权发送者共享该群的会话。

## 配置位置

组合包插入 `lark` 行，profile patch 根据 `id` 覆盖该行。patch 会替换整个 `config` 值，因此请在同一个条目中保留所有需要的设置。个人配置不要写入组合包自身的 `cordis.patch.yml`。

宿主从 `$DSH_HOME/profiles` 读取 profile；未设置 `DSH_HOME` 时使用 `~/.dsh/profiles`。启动时会创建不存在的工作区。默认值见[配置参考](configuration.zh-CN.md)，故障处理见[排查指南](troubleshooting.zh-CN.md)。
