# dsh-lark 设计决策

飞书聊天是遥控器：命令从聊天进来，dsh 会话跑完，回答回到聊天。SQLite 之于 dsh-personal 是存储，`lark-cli` 之于 dsh-lark 是传输——事实和结果都由 dsh 会话产生，插件只搬运。

## 方向选择：直连 `ctx.agents`，不走 webhook 规则

webhook 家族（`packages/webhook/`）是「事件 → 规则 → 建会话」的 fire-and-forget 缝，明确不持有 Agent 完成状态；而本插件的核心价值恰恰是**把结果说回聊天**。所以桥接直接消费 `ctx.agents`（headless 运行器与 schedule 插件的既有模式）：`agents.create()` + `followup()` + `await whenIdle()` + 读 durable log 摘出最后的 assistant 文本。会话创建序列（workspace attach、permission preset、标题）沿用 `createWebhookSession` 的形状，使会话在 web UI 里和普通会话一致可见。

消息 source 合并 `'lark'` kind 进 `MessageSourceMap`（webhook 合并 `'webhook'` 同款），触发消息的 chat/sender/message id 全部进 durable log——模型可见即日志可重建。

## 入口是子进程契约管理，不是 HTTP

lark-cli `event consume` 有明确协议，本插件逐条兑现：

- stderr 等到 `[event] ready event_key=…` 才开始消费 stdout；之前的 stdout 行缓存不丢（跨 pipe 无顺序保证）。
- spawn 的 stdin 永不写入、永不关闭——EOF 即优雅退出，这正是常驻订阅需要的反面。
- 退出只用 SIGTERM；kill -9 会跳过 lark-cli 的服务端订阅注销，造成重复投递。
- 一个进程只听一个 EventKey；`im.message.receive_v1` 是固定协议常量，不做配置。
- 非预期退出（崩溃、掉线）按 `restartDelayMs` 无限重启；重启复用同一个 `LarkIngest`，`event_id` 去重集合跨重启存活，补投事件不重复执行。
- 加载时 `lark-cli --version` 预检，二进制缺失让插件加载失败（misconfiguration fails loud）。

## 触发与安全

群消息飞书侧本来就只推送 @机器人 的，插件再要求渲染文本以 `@` 开头，双层收敛；私聊全收。`allowedSenders` / `allowedChats` 白名单默认空（不限制），个人机上建议显式配置——能私聊这个 bot 的人 = 应用可见范围内的人。非文本消息（图片/卡片等）一律忽略。

权限上，`permissionPreset` 可选：不配置时会话走 profile 默认审批流（需要人在 web UI 点批准）；远程遥控场景应配置自动放行的 preset，这是部署者的明确选择，不是插件默认。

## 会话映射：chat 粒度 + 惰性过期

一个 chat 一个活跃会话，`lastActiveAt` 惰性判断过期（无定时器），过期后旧会话 `handle.dispose()`、下一条消息开新会话。每条消息一次 `followup`（独立回合）而不是 `steer`（打断当前步）：遥控场景下「新命令」比「插话」常见，打断留给未来的配置项。同一 chat 的处理链用 promise 串行，保证回复与触发消息的对应关系；会话运行中再来的消息由 agent inbox 自然排队。

## 斜杠命令与 @前缀剥离

桥接命令在 mention 剥离后解析：`/name` 控制桥接本身，不进 agent；未知命令回提示而非转发，避免误触发回合。`/stop` 旁路 per-chat 串行链立即执行——排队中的 stop 永远追不上正在运行的回合，cancel 用 `{ kind: 'user' }`，被停的回合以 `aborted` 结束并回复「已停止本轮」；其余命令照常排队，与回合保持先后次序。机器人显示名在加载时经 `bot/v3/info` 自动获取（`botName` 配置可覆盖，探测失败不阻塞加载），群消息按精确名字剥离 @前缀，agent 收到的是干净文本；拿不到名字时退化为首 token 启发式。

## 回复策略

最后一段 assistant 文本 → 截断到 `maxReplyChars` → `+messages-reply` 锚定触发消息；回复失败降级 `+messages-send`，再失败记日志。没有输出文本的回合（纯工具执行）和错误回合都发兜底文案——飞书侧永远有反馈。lark-cli 调用一律 argv 数组（`execFile`），不走 shell。
