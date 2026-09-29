# dsh-lark

https://github.com/ChengqianHuang/dsh-lark · topic: `dsh-plugin`

个人侧 Lark/飞书桥接 bundle：在飞书里给机器人发消息，消息实时驱动本机 dsh 会话，会话跑完把最终回答回复到聊天里。飞书是遥控器，dsh 是引擎，`lark-cli` 是两侧的传输层。

安装与使用见 dsh 用户文档 `docs/user/develop/basic/publish.md`。设计决策见 [DESIGN.md](DESIGN.md)。

## 安装（dsh 源码运行模式下）

本仓库 clone（或 link）到任意位置后，在 dsh 仓库根目录安装进 profile：

```sh
# 从本仓库的本地 clone 安装（link 模式，源码即生效）
pnpm dsh plugin --profile web add /path/to/dsh-lark
pnpm dsh --profile web --dump-config               # 验证出现 "# == dsh-lark" 层
pnpm dsh web                                       # 启动后从飞书对话
```

卸载：`pnpm dsh plugin --profile web remove dsh-lark`。

前置条件（加载时逐项响亮校验）：

- `lark-cli` 在 PATH 中（或用 `larkCliPath` 指定绝对路径），且应用已开通「接收消息」事件（`im.message.receive_v1`）；
- 配置里的 `workspacePath` 会自动创建。

配置（可选，写进 profile 的 cordis.patch.yml 或由默认值兜底）：

```yaml
- id: lark
  name: dsh-lark
  config:
    # larkCliPath: lark-cli              # 默认走 PATH
    # identity: bot                      # 收消息用 bot 身份，无需 auth login
    allowedSenders: [ou_c4198d18421b0749d2a7c79409a76ef3]   # 建议显式配置
    # allowedChats: []                   # 空 = 机器人能听到的所有会话
    # workspacePath: ~/.dsh/lark/workspace
    # sessionIdleMinutes: 30             # 聊天闲置多久后，下一条消息开新会话
    # restartDelayMs: 3000               # 消费进程崩溃后的重启延迟
    # maxReplyChars: 4000                # 回复长度上限，超出截断
    # titlePrefix: "[lark] "             # web UI 会话标题前缀
    # agentPreset: coder                 # 可选：挂进驱动会话的 agent preset
    # permissionPreset: yolo             # 可选：驱动会话的权限 preset
```

## 触发规则

- **私聊**：机器人收到的每条文本消息都是命令。
- **群聊**：只有 **@机器人** 的文本消息是命令（飞书本身也只向机器人推送 @它 的群消息）。
- 消息原文（含 @前缀）原样进入会话；`event_id` 去重，重连补投不会重复执行。
- `allowedSenders` / `allowedChats` 为空表示不限制；个人机建议配白名单。

## 会话映射与回复

- 每个 chat 最多挂一个活跃会话；首条消息创建会话（出现在 web UI 的 workspace 列表，标题带 `titlePrefix`）。
- 会话空闲超过 `sessionIdleMinutes` 后，该聊天下一条消息开新会话，旧会话正常释放。
- 每条消息是一次独立的 followup 回合；会话运行中再来的消息由 agent 自行排队。
- 回合结束后取最后一段 assistant 文本，优先 `+messages-reply` 回到触发消息，失败则退回 `+messages-send` 发到聊天；超过 `maxReplyChars` 截断。
- 创建会话、回合执行、回复发送失败都会把错误文本发回聊天，不静默。

## 构建 / 测试

```sh
(cd dsh-lark && pnpm install --ignore-workspace --config.auto-install-peers=false)
(cd dsh-lark && pnpm exec tsdown)                    # 产出 lib/index.mjs
pnpm exec vitest run --config dsh-lark/vitest.config.ts
pnpm exec tsc -p dsh-lark/tsconfig.json --noEmit
```

修改源码后重新 `pnpm exec tsdown` 即可（profile 里是 link，指向本目录）。
类型检查读取 DSH 各依赖包的声明文件；首次运行前需先构建上层 DSH 仓库。
