# 配置参考

[English](configuration.md) | 简体中文

所有设置都位于 profile patch 中 `lark` 行的 `config` 下。[个人示例](../examples/personal.patch.yml)只允许一个账号私聊；[群聊示例](../examples/group.patch.yml)只允许指定账号在一个聊天中操作。无效设置会导致启动失败。

## 访问控制与工作区

| 设置 | 默认值 | 含义 |
|---|---|---|
| `allowedSenders` | `[]` | 当前应用下的发送者 `open_id`。除非显式启用 `allowAllSenders`，否则不能为空。 |
| `allowAllSenders` | `false` | 接受机器人收到的所有发送者；不能与非空的 `allowedSenders` 同时配置。启用前请阅读[安全说明](../SECURITY.zh-CN.md)。 |
| `allowedChats` | `[]` | 限制可接收的聊天 ID；为空时允许已授权发送者所在的任意聊天。 |
| `groupPolicy` | `mentions` | `mentions` 要求消息开头准确提及机器人；`disabled` 拒绝所有群消息。 |
| `botName` | 自动检测 | 准确的机器人显示名；启用群处理且自动检测失败时，必须显式配置。 |
| `workspacePath` | `~/.dsh/lark/workspace` | 共享工作目录；必须为绝对路径或以 `~/` 开头；不存在时会创建。 |
| `agentPreset` | 宿主默认值 | 新会话挂载的 agent preset；显式配置不存在的 preset 会失败。 |
| `permissionPreset` | 宿主默认值 | 可选的宿主权限 preset；插件不会自动放行工具权限。 |
| `locale` | `zh-CN` | 桥接提示语言，支持 `zh-CN` 或 `en`，不控制模型回答语言。 |
| `titlePrefix` | `[lark] ` | dsh 会话标题前缀。 |

## 容量与时间

| 设置 | 默认值 | 含义 |
|---|---|---|
| `sessionIdleMinutes` | `30` | 空闲有效期；到期后的下一条消息创建新会话。 |
| `maxPendingMessagesPerChat` | `8` | 每个聊天等待中的任务上限，不包含当前任务；超出后回复繁忙提示。 |
| `maxActiveChats` | `32` | 聊天绑定总数上限；有新任务到来时回收已空闲过期的绑定。 |
| `maxReplyChars` | `4000` | 回复 Unicode 码点数量上限，包含省略号；更长的回答会被截断。 |
| `dedupCapacity` | `1000` | 内存中保留的最近事件 ID 数量，用于抑制重复投递。 |
| `restartDelayMs` | `3000` | 事件消费者意外退出后的重启等待时间。 |
| `ingressReadyTimeoutMs` | `30000` | 等待 CLI 事件消费者就绪提示的最长时间。 |
| `egressTimeoutMs` | `30000` | 单次 CLI 请求的最长耗时，也适用于预检查和名称检测。 |

数值限制必须为正数。`sessionIdleMinutes` 支持小数，但换算后须至少为 1 毫秒且不超过安全整数范围。计数和毫秒设置要求安全整数；重启与 CLI 超时上限为 `2147483647` 毫秒。容量不足时不会静默接受额外任务。

## 传输

| 设置 | 默认值 | 含义 |
|---|---|---|
| `larkCliPath` | `lark-cli` | PATH 中的 CLI 可执行文件，或其绝对路径。 |
| `identity` | `bot` | 仅接受 `bot`；接收事件只支持机器人身份。 |

事件键固定为 `im.message.receive_v1`。凭据与租户选择由 `lark-cli` 管理，模型凭据由 dsh 管理。请勿在此配置文件中填写凭据。
