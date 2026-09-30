/** Locale-owned text for bridge commands and chat-visible failures. @module */

import type { Locale } from './config.ts'

/** Facts shown by /status without exposing local paths or other chats. */
export interface ChatStatus {
  id: string
  running: boolean
  queued: number
  remainingMinutes: number
}

interface BridgeCopy {
  help: string
  noSession: string
  noRunning: string
  newSession: string
  stopped: string
  discarded: string
  empty: string
  failed: string
  blocked: string
  interrupted: string
  limited: string
  starting: string
  unknown(name: string): string
  usage(name: string): string
  stopping(queued: number): string
  queued(position: number): string
  queueFull(limit: number): string
  chatLimit(limit: number): string
  status(facts: ChatStatus): string
}

/** Complete English and Chinese bridge copy; model output is never translated. */
export const copy: Readonly<Record<Locale, BridgeCopy>> = {
  'zh-CN': {
    help: '可用命令：\n/new — 结束当前会话并取消排队，下一条消息开始新会话\n/stop — 停止当前请求并取消排队\n/status — 查看会话状态和排队数量\n/help — 显示帮助\n\n需要审批时，请在 dsh Web UI 中处理。',
    noSession: '当前没有活跃会话；下一条消息将创建新会话。',
    noRunning: '当前没有正在运行或排队的请求。',
    newSession: '已结束当前会话并取消排队；下一条消息开始新会话。',
    stopped: '已停止本轮。',
    discarded: '这条消息在执行前已被移出队列，请重新发送。',
    empty: '（dsh 本轮没有文本输出）',
    failed: 'dsh 处理失败，请查看运行日志后重试。',
    blocked: '本轮被阻止，请在 dsh Web UI 中检查会话和权限。',
    interrupted: '本轮未能完成，请重新发送消息。',
    limited: '本轮达到输出上限，回答可能不完整。',
    starting: '正在准备会话。',
    unknown: name => `未知命令 /${name}。发送 /help 查看可用命令。`,
    usage: name => `/${name} 不接受参数，请单独发送 /${name}。`,
    stopping: queued => `已请求停止当前请求，取消 ${String(queued)} 条排队消息。`,
    queued: position => `已排队，前面还有 ${String(position)} 条消息。发送 /stop 可停止并清空队列。`,
    queueFull: limit => `队列已满（最多 ${String(limit)} 条），请稍后重试，或发送 /stop 清空队列。`,
    chatLimit: limit => `活跃聊天已达到上限（${String(limit)} 个），请先在现有聊天发送 /new 释放会话。`,
    status: facts => `会话 ${facts.id}\n状态：${facts.running ? '运行中' : '空闲'}\n排队：${String(facts.queued)} 条\n${facts.running ? '运行期间不计算闲置到期。' : `${String(facts.remainingMinutes)} 分钟后闲置到期。`}`,
  },
  en: {
    help: 'Commands:\n/new — End this session and clear queued messages\n/stop — Stop this request and clear queued messages\n/status — Show session and queue status\n/help — Show help\n\nHandle approval requests in the dsh Web UI.',
    noSession: 'No active session. Your next message will start one.',
    noRunning: 'No request is running or queued.',
    newSession: 'Session ended and queue cleared. Your next message will start a new session.',
    stopped: 'This turn was stopped.',
    discarded: 'This message was removed from the queue before it ran. Please send it again.',
    empty: '(dsh returned no text for this turn.)',
    failed: 'dsh could not process this request. Check the runtime logs and try again.',
    blocked: 'This turn was blocked. Check the session and permissions in the dsh Web UI.',
    interrupted: 'This turn did not finish. Please send the message again.',
    limited: 'This turn reached its output limit. The answer may be incomplete.',
    starting: 'Preparing the session.',
    unknown: name => `Unknown command /${name}. Send /help to list commands.`,
    usage: name => `/${name} does not accept arguments. Send /${name} on its own.`,
    stopping: queued => `Stop requested. Cleared ${String(queued)} queued message(s).`,
    queued: position => `Queued behind ${String(position)} message(s). Send /stop to stop and clear the queue.`,
    queueFull: limit => `The queue is full (${String(limit)} messages). Try again later or send /stop to clear it.`,
    chatLimit: limit => `The active chat limit (${String(limit)}) was reached. Send /new in an existing chat to release a session.`,
    status: facts => `Session ${facts.id}\nStatus: ${facts.running ? 'running' : 'idle'}\nQueued: ${String(facts.queued)}\n${facts.running ? 'Idle expiry pauses while running.' : `Idle expiry in ${String(facts.remainingMinutes)} minute(s).`}`,
  },
}
