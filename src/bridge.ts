/**
 * Chat-to-session routing. One Feishu chat maps to at most one live dsh
 * session; a message on an idle-expired chat starts a fresh session. Each
 * message becomes one followup turn, the turn runs to quiescence, and the
 * last assistant text is replied back to the triggering message. Per-chat
 * handler chains serialize creation and replies while the agent queues its
 * own turns.
 *
 * Messages whose mention-stripped text parses as a bridge command
 * (`/new`, `/status`, `/help`, unknown names) run on the same per-chat chain
 * so they serialize with turns; `/stop` bypasses the chain and acts
 * immediately, because a queued stop could never reach a running turn.
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LarkChatId } from './brand.ts'
import { describeBridgeCommands, isKnownCommand, parseBridgeCommand, stripMention, type BridgeCommand } from './command.ts'
import type { LarkSettings } from './config.ts'
import type { Egress } from './egress.ts'
import { summarizeTurn, type TurnOutcome } from './summary.ts'
import type { LarkMessageEvent } from './types.ts'

/** One chat's live session plus its activity stamp. */
interface ChatEntry {
  readonly handle: Awaited<ReturnType<Context['agents']['create']>>
  readonly agent: Agent
  readonly sessionId: SessionId
  lastActiveAt: number
  /** `true` from followup until the turn settles; read by the immediate /stop path. */
  running: boolean
}

/** First title line for a fresh session, bounded for the web UI listing. */
function titleFromEvent(text: string, chatId: LarkChatId): string {
  const line = text.split('\n').map(candidate => candidate.trim()).find(candidate => candidate !== '')
    ?? chatId
  return line.slice(0, 40)
}

/** Human reply text for one settled turn. */
function replyTextFor(outcome: TurnOutcome): string {
  const text = outcome.text.trim()
  if (text !== '') return text
  if (outcome.reason?.kind === 'aborted') return '已停止本轮。'
  if (outcome.reason?.kind === 'error') return `dsh 本轮出错：${outcome.reason.error.message}`
  return '（dsh 本轮没有文本输出）'
}

/** Whole minutes for status lines; sub-minute durations read as one minute. */
function minutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} 分钟`
}

/** Route accepted Feishu messages into driven dsh sessions and reply in chat. */
export class ChatRouter {
  private readonly chats = new Map<LarkChatId, ChatEntry>()
  private readonly chains = new Map<LarkChatId, Promise<void>>()
  private workspacePromise: Promise<Awaited<ReturnType<Context['workspaceRegistry']['create']>>> | undefined
  private disposed = false

  /**
   * Store the runtime context, resolved settings, and outbound messaging.
   * @param ctx - plugin context carrying the agent, preset, title, and workspace services.
   * @param settings - resolved deployment settings, including the bot name for mention stripping.
   * @param egress - outbound Feishu messaging.
   */
  constructor(
    private readonly ctx: Context,
    private readonly settings: LarkSettings,
    private readonly egress: Egress,
  ) {}

  /**
   * Dispatch one accepted message; never throws. `/stop` cancels the running
   * turn immediately; everything else joins the chat's serialized chain.
   * @param event - accepted receive-message event.
   */
  handle(event: LarkMessageEvent): void {
    if (this.disposed) return
    const text = stripMention(event.content, this.settings.botName)
    const command = parseBridgeCommand(text)
    if (command !== undefined && command.name === 'stop') {
      void this.stopRunningTurn(event).catch(error => {
        this.ctx.logger.warn(`dsh-lark: chat ${event.chatId} stop failed: ${errorChain(error)}`)
      })
      return
    }
    const tail = (this.chains.get(event.chatId) ?? Promise.resolve()).then(() => this.processMessage(event, text, command))
    this.chains.set(event.chatId, tail.catch(error => {
      this.ctx.logger.warn(`dsh-lark: chat ${event.chatId} handler failed: ${errorChain(error)}`)
    }))
  }

  /**
   * Resolve when every dispatched handler has settled; tests and shutdown await this.
   */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.chains.values()])
  }

  /**
   * Dispose every live chat session. Chains settle first, so no turn is
   * interrupted mid-flight.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.settle()
    for (const [chatId, entry] of this.chats) {
      this.chats.delete(chatId)
      await this.disposeEntry(chatId, entry)
    }
  }

  /** Route one chained message to its command or turn handler. */
  private async processMessage(event: LarkMessageEvent, text: string, command: BridgeCommand | undefined): Promise<void> {
    if (command !== undefined) {
      await this.processCommand(event, command)
      return
    }
    if (text === '') return
    await this.processChatMessage(event, text)
  }

  /** Execute one chained bridge command. */
  private async processCommand(event: LarkMessageEvent, command: BridgeCommand): Promise<void> {
    if (!isKnownCommand(command.name)) {
      await this.reply(event, `未知命令 /${command.name}\n\n${describeBridgeCommands()}`)
      return
    }
    if (command.name === 'new') {
      const entry = this.chats.get(event.chatId)
      if (entry === undefined) {
        await this.reply(event, '当前没有活跃会话；下一条消息将创建新会话。')
        return
      }
      this.chats.delete(event.chatId)
      await this.disposeEntry(event.chatId, entry)
      await this.reply(event, '已结束当前会话；下一条消息开始新会话。')
      return
    }
    if (command.name === 'status') {
      await this.reply(event, this.statusFor(event.chatId))
      return
    }
    if (command.name === 'help') {
      await this.reply(event, describeBridgeCommands())
      return
    }
    // `/stop` never reaches the chain; this arm only keeps the switch exhaustive.
  }

  /** Cancel the chat's running turn now, replying only when there is nothing to stop. */
  private async stopRunningTurn(event: LarkMessageEvent): Promise<void> {
    const entry = this.chats.get(event.chatId)
    if (entry === undefined) {
      await this.reply(event, '当前没有活跃会话。')
      return
    }
    if (!entry.running) {
      await this.reply(event, '当前没有正在运行的回合。')
      return
    }
    entry.agent.cancel({ kind: 'user' })
  }

  /** Compose the /status report for one chat. */
  private statusFor(chatId: LarkChatId): string {
    const entry = this.chats.get(chatId)
    if (entry === undefined) return '当前没有活跃会话；下一条消息将创建新会话。'
    const elapsedMs = Date.now() - entry.lastActiveAt
    const remainingMs = Math.max(0, this.settings.sessionIdleMs - elapsedMs)
    return [
      `会话 ${entry.sessionId.slice(0, 13)}（${entry.running ? '运行中' : '空闲'}）`,
      `上次活动：${minutes(elapsedMs)}前；${minutes(remainingMs)}后闲置到期`,
    ].join('\n')
  }

  /** Run one message through create-or-reuse, one turn, and the reply. */
  private async processChatMessage(event: LarkMessageEvent, text: string): Promise<void> {
    try {
      const entry = await this.ensureEntry(event.chatId, titleFromEvent(text, event.chatId))
      const firstSeq = entry.agent.session.seq
      entry.agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'lark',
          chatId: event.chatId,
          chatType: event.chatType,
          senderId: event.senderId,
          messageId: event.messageId,
        },
      }))
      entry.lastActiveAt = Date.now()
      entry.running = true
      try {
        await entry.agent.whenIdle()
      } finally {
        entry.running = false
      }
      entry.lastActiveAt = Date.now()
      const outcome = summarizeTurn(entry.agent.session, firstSeq)
      await this.reply(event, replyTextFor(outcome))
    } catch (error) {
      this.ctx.logger.warn(`dsh-lark: chat ${event.chatId} turn failed: ${errorChain(error)}`)
      await this.reply(event, `dsh 处理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Reply anchored to the message; fall back to a plain chat send. */
  private async reply(event: LarkMessageEvent, text: string): Promise<void> {
    const bounded = text.length > this.settings.maxReplyChars
      ? `${text.slice(0, Math.max(1, this.settings.maxReplyChars - 1))}…`
      : text
    try {
      await this.egress.reply(event.messageId, bounded)
    } catch (replyError) {
      this.ctx.logger.warn(`dsh-lark: reply to ${event.messageId} failed: ${errorChain(replyError)}`)
      try {
        await this.egress.send(event.chatId, bounded)
      } catch (sendError) {
        this.ctx.logger.warn(`dsh-lark: send to ${event.chatId} failed: ${errorChain(sendError)}`)
      }
    }
  }

  /** Return the chat's live session, replacing one that idled out. */
  private async ensureEntry(chatId: LarkChatId, seedTitle: string): Promise<ChatEntry> {
    const existing = this.chats.get(chatId)
    if (existing !== undefined) {
      if (Date.now() - existing.lastActiveAt < this.settings.sessionIdleMs) return existing
      this.chats.delete(chatId)
      await this.disposeEntry(chatId, existing)
    }
    return this.createEntry(chatId, seedTitle)
  }

  /** Create, attach, title, and configure one fresh session for the chat. */
  private async createEntry(chatId: LarkChatId, seedTitle: string): Promise<ChatEntry> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const preset = this.settings.agentPreset === undefined
      ? undefined
      : await this.ctx.agentPresets.resolve(this.settings.agentPreset)
    if (this.settings.permissionPreset !== undefined) this.ctx.permissionPresets.resolve(this.settings.permissionPreset)
    const workspace = await this.ensureWorkspace()
    const sessionId = brandString<SessionId>(`lark-${randomUUID()}`)
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: workspace.path, ...(preset === undefined ? {} : { agentPreset: preset.id }) },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: preset === undefined
        ? (agentCtx: Context) => {
          const selected: ModelSelectionRef = { current: selection, assembled: undefined }
          installModelSelection(agentCtx, selected)
        }
        : async (agentCtx: Context) => {
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
        },
    })
    let attached = false
    try {
      await workspace.attachSession(sessionId)
      attached = true
      if (this.settings.permissionPreset !== undefined) {
        this.ctx.permissionPresets.set(handle.agent.session, this.settings.permissionPreset)
      }
      this.ctx.sessionTitle.rename(handle.agent.session, `${this.settings.titlePrefix}${seedTitle}`)
    } catch (error: unknown) {
      if (attached) {
        try {
          await workspace.detachSession(sessionId)
        } catch (rollbackError: unknown) {
          this.ctx.logger.warn(`dsh-lark: workspace detach for "${sessionId}" failed: ${errorChain(rollbackError)}`)
        }
      }
      try {
        await handle.dispose()
      } catch (rollbackError: unknown) {
        this.ctx.logger.warn(`dsh-lark: agent disposal for "${sessionId}" failed: ${errorChain(rollbackError)}`)
      }
      throw error
    }
    const entry: ChatEntry = { handle, agent: handle.agent, sessionId, lastActiveAt: Date.now(), running: false }
    this.chats.set(chatId, entry)
    return entry
  }

  /** One shared workspace entity reused across every chat. */
  private ensureWorkspace(): Promise<Awaited<ReturnType<Context['workspaceRegistry']['create']>>> {
    this.workspacePromise ??= this.ctx.workspaceRegistry.create(this.settings.workspacePath)
    return this.workspacePromise
  }

  /** Dispose one chat's agent handle, reporting a rollback failure without throwing. */
  private async disposeEntry(chatId: LarkChatId, entry: ChatEntry): Promise<void> {
    try {
      await entry.handle.dispose()
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-lark: chat ${chatId} session disposal failed: ${errorChain(error)}`)
    }
  }
}
