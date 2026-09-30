---
description: "从飞书或 Lark 启动本机 dsh 任务，并在聊天中收到每个任务的回答。"
kind: "package-bundle"
---

# dsh-lark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![CI](https://github.com/ChengqianHuang/dsh-lark/actions/workflows/ci.yml/badge.svg)](https://github.com/ChengqianHuang/dsh-lark/actions/workflows/ci.yml)

**发条消息，让本机编程助手开始工作。**

[English](README.md) | 简体中文

## 概要

向飞书或 Lark 机器人发送任务，[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 就会在本机工作区中执行，并回复触发任务的那条消息。你可以审查改动、排查测试失败，或询问代码；会话也会保留在 dsh Web UI 中，方便继续查看。

- **连续对话。** 每个聊天保留独立会话，后续消息可以沿用上下文。
- **随时掌控。** 限制发送者和聊天，用 `/status` 查看状态，用 `/stop` 停止，用 `/new` 重新开始。
- **沿用 dsh 配置。** 会话使用宿主的默认 agent preset 和权限策略。
- **本地接入。** 桥接通过 [lark-cli](https://github.com/larksuite/cli) 订阅事件，无需开放公网 webhook 接口。

可以试试：“解释这个仓库的入口”“审查工作区里的改动”或“找出 parser 测试失败的原因”。具体可执行的操作取决于 dsh 的工具和权限。

## 目录

- [使用](#use-this-package)
- [命令](#commands)
- [实现概览](#understand-the-implementation)
- [继续阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用

你需要能够正常运行的 dsh、Node.js `^22.19.0 || >=24.0.0`、pnpm，以及已配置的飞书或 Lark 机器人；`lark-cli` 需要在 PATH 中。当前兼容目标为 dsh `0.1.2-alpha.5`；凭据、权限与发送者 ID 的准备见[安装指南](docs/setup.zh-CN.md)。

### 1. 构建并安装组合包

```sh
git clone https://github.com/ChengqianHuang/dsh-lark.git
cd dsh-lark
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add "$PWD"
```

本地目录会链接到 `web` profile；修改源码后需要重新构建。如果从源码运行 dsh，请在 harness 仓库中用 `pnpm dsh` 执行下文的 `dsh` 命令，并给 `add` 传入插件目录的绝对路径。

### 2. 授权自己的账号

把下面的配置合并到 `${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml`，将示例发送者 ID 换成自己的 ID，并保留文件中已有的其他配置。

```yaml
- id: lark
  config:
    allowedSenders: [ou_your_open_id]
    workspacePath: ~/projects/my-project
    groupPolicy: disabled
    locale: en
```

先从私聊开始。群聊请使用 `groupPolicy: mentions`，并限制 `allowedChats`，详见[配置参考](docs/configuration.zh-CN.md)。发送者白名单为空时启动会失败，除非显式启用 `allowAllSenders`。示例使用英文提示，中文请设为 `locale: zh-CN`。

### 3. 启动并试用

```sh
dsh --profile web --dump-config
dsh web
```

配置输出应包含 `dsh-lark` 层和你的设置；这一步不检查飞书连接。向机器人发送 `/help`，再请它介绍工作区。在 Web UI 打开对应会话，可以查看工具执行情况或处理权限审批。

卸载使用 `dsh plugin --profile web remove dsh-lark`。已经保存的 dsh 会话历史仍由宿主的保留策略管理。

<a id="commands"></a>
## 命令

| 消息 | 结果 |
|---|---|
| 普通文本 | 在当前聊天的会话中执行一个任务；后续任务进入有长度限制的队列。 |
| `/status` | 立即查看当前会话、运行状态与队列，无需等待任务完成。 |
| `/stop` | 取消桥接的当前任务并清空待处理消息。 |
| `/new` | 取消桥接任务、清空队列并重置当前聊天的会话。 |
| `/help` | 立即显示可用命令。 |

群聊消息必须以机器人的准确 `@显示名` 开头。未知斜杠命令会返回帮助，不会作为 agent 提示词执行。机器人状态提示支持英文和简体中文；模型根据对话选择回答语言。

-----

<a id="understand-the-implementation"></a>
## 实现概览

<details>
<summary>消息处理与会话归属</summary>

`lark-cli` 提供消息事件 → 检查发送者与聊天权限 → 聊天队列提交 dsh 回合 → 桥接提取该回合记录的回答 → `lark-cli` 回复触发消息。

组合包的 [patch](cordis.patch.yml) 安装 `lark` 行。[服务](https://github.com/ChengqianHuang/dsh-lark/blob/main/src/index.ts) 管理事件消费者与[路由器](https://github.com/ChengqianHuang/dsh-lark/blob/main/src/bridge.ts)；宿主管理 agent、工具、凭据、权限和持久会话历史。并发、卸载与投递保证见[设计说明](DESIGN.zh-CN.md)。

</details>

<a id="further-exploration"></a>
## 继续阅读

- [安装指南](docs/setup.zh-CN.md) · [配置参考](docs/configuration.zh-CN.md) · [故障排查](docs/troubleshooting.zh-CN.md)
- [安全与数据处理](SECURITY.zh-CN.md) · [参与贡献](CONTRIBUTING.zh-CN.md) · [MIT 许可证](LICENSE)
- [个人与群聊配置示例](examples/)

<a id="model-experience"></a>
## 模型体验

通过检查的文本会作为用户消息写入日志，并附带飞书聊天、发送者和消息 ID。桥接去除开头的机器人提及，并自行处理斜杠命令。工具与提示词由 agent preset 提供；桥接不添加模型工具。只有已完成回合的最终文本会发回聊天，并受配置的长度上限约束。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

支持文本消息与纯文本回复，不支持附件、卡片、流式回复和飞书内审批。长回答会被截断；完整内容请查看 dsh 会话。

各聊天的会话共用配置的文件系统工作区和宿主权限。群成员可以看到回复，并共享该群的对话上下文。聊天绑定、待处理消息和去重记录不会跨插件重启保留。这是面向可信用户的集成，不保证消息恰好投递一次；添加其他用户前请阅读[安全模型](SECURITY.zh-CN.md)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景</summary>

无。

</details>
