/** Per-chat sessions, bounded message queues, and immediate bridge commands. @module */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, errorChain, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LarkChatId } from './brand.ts'
import { describeBridgeCommands, isKnownCommand, parseBridgeCommand, stripMention } from './command.ts'
import type { LarkSettings } from './config.ts'
import { truncateReply, type Egress } from './egress.ts'
import { copy } from './i18n.ts'
import { runMessageTurn, type TurnOutcome } from './summary.ts'
import type { LarkMessageEvent } from './types.ts'

interface ChatEntry {
  handle: Awaited<ReturnType<Context['agents']['create']>>
  agent: Agent
  lastActiveAt: number
}

interface Work {
  kind: 'message' | 'reset'
  event: LarkMessageEvent
  text: string
}

interface ChatState {
  entry?: ChatEntry | undefined
  queue: Work[]
  active?: Work | undefined
  controller?: AbortController | undefined
  task?: Promise<void> | undefined
}

/** Respect the initial model effort until a durable request header can own it. */
function installInitialSelection(agentCtx: Context, selection: ModelSelection): void {
  agentCtx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    if (agentCtx.agent?.session.requestHeader() !== undefined
      || resolved.provider !== selection.provider || resolved.model !== selection.model) return resolved
    const { reasoningEffort: _inherited, ...rest } = resolved
    return { ...rest, ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) }
  })
}

/** Keep title seeds readable without splitting an astral Unicode character. */
function titleFromText(text: string): string {
  return Array.from(text.split('\n').find(line => line.trim() !== '')?.trim() ?? '').slice(0, 40).join('')
}

/** Route authorized messages into owned sessions and replies. */
export class ChatRouter {
  private readonly chats = new Map<LarkChatId, ChatState>()
  private readonly tasks = new Set<Promise<void>>()
  private workspacePromise: Promise<Awaited<ReturnType<Context['workspaceRegistry']['create']>>> | undefined
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * Create a router without starting work.
   * @param ctx - Services used to create and configure sessions.
   * @param settings - Validated deployment and access settings.
   * @param egress - Reply transport.
   */
  constructor(private readonly ctx: Context, private readonly settings: LarkSettings, private readonly egress: Egress) {}

  /**
   * Admit one already-authorized event. Commands remain responsive during turns.
   * @param event - Event accepted by the access filter.
   */
  handle(event: LarkMessageEvent): void {
    if (this.disposed) return
    this.reapIdle()
    const text = stripMention(event.content, this.settings.botName)
    if (text === '') return
    const strings = copy[this.settings.locale]
    const command = parseBridgeCommand(text)
    if (command !== undefined) {
      if (!isKnownCommand(command.name)) {
        this.track(this.reply(event, strings.unknown(command.name)))
      } else if (command.argument !== '') {
        this.track(this.reply(event, strings.usage(command.name)))
      } else if (command.name === 'help') {
        this.track(this.reply(event, describeBridgeCommands(this.settings.locale)))
      } else if (command.name === 'status') {
        this.track(this.reply(event, this.statusFor(event.chatId)))
      } else {
        this.control(event, command.name)
      }
      return
    }
    let state = this.chats.get(event.chatId)
    if (state === undefined) {
      if (this.chats.size >= this.settings.maxActiveChats) {
        this.track(this.reply(event, strings.chatLimit(this.settings.maxActiveChats)))
        return
      }
      state = { queue: [] }
      this.chats.set(event.chatId, state)
    }
    const queuedMessages = state.queue.filter(work => work.kind === 'message').length
    const waiting = Math.max(0, queuedMessages - (state.active === undefined && state.task !== undefined ? 1 : 0))
    if (waiting >= this.settings.maxPendingMessagesPerChat) {
      this.track(this.reply(event, strings.queueFull(this.settings.maxPendingMessagesPerChat)))
      return
    }
    if (state.task !== undefined) this.track(this.reply(event, strings.queued(waiting + 1)))
    state.queue.push({ kind: 'message', event, text })
    this.startDrain(event.chatId, state)
  }

  /**
   * Wait until all accepted work and transport replies settle.
   * @returns Fulfillment after the router has no active tasks.
   */
  async settle(): Promise<void> {
    while (this.tasks.size > 0) await Promise.all([...this.tasks])
  }

  /**
   * Close admission immediately, cancel queued work, and await owned agents and replies.
   * Repeated calls share the same completion promise.
   * @returns Fulfillment after all owned work has stopped.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    for (const state of this.chats.values()) {
      state.queue.length = 0
      state.controller?.abort()
    }
    this.disposal = this.finishDisposal()
    return this.disposal
  }

  private async finishDisposal(): Promise<void> {
    const results = await Promise.allSettled([...this.chats.values()].map(state => this.releaseEntry(state)))
    await this.settle()
    // A creation already beyond publication is rollback-disposed by createEntry.
    this.chats.clear()
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'dsh-lark: session cleanup failed')
  }

  /** Own background work and contain failures from command and drain callbacks. */
  private track(operation: Promise<void>): void {
    const task = operation.catch((error: unknown) => {
      this.ctx.logger.warn(`dsh-lark: handler failed: ${errorChain(error)}`)
    })
    this.tasks.add(task)
    void task.then(() => { this.tasks.delete(task) })
  }

  private control(event: LarkMessageEvent, command: 'stop' | 'new'): void {
    const state = this.chats.get(event.chatId)
    const strings = copy[this.settings.locale]
    if (state === undefined) {
      this.track(this.reply(event, strings.noSession))
      return
    }
    const queued = state.queue.filter(work => work.kind === 'message').length
    state.queue.length = 0
    state.controller?.abort()
    if (command === 'stop') {
      this.track(this.reply(event, state.active === undefined && queued === 0 ? strings.noRunning : strings.stopping(queued)))
      return
    }
    state.queue.push({ kind: 'reset', event, text: '' })
    this.startDrain(event.chatId, state)
  }

  private startDrain(chatId: LarkChatId, state: ChatState): void {
    if (state.task !== undefined) return
    // Publish the task before its first handler can reenter through a callback.
    const task = Promise.resolve().then(async () => {
      while (!this.disposed) {
        const work = state.queue.shift()
        if (work === undefined) break
        state.active = work
        const controller = new AbortController()
        state.controller = controller
        try {
          if (work.kind === 'reset') {
            await this.releaseEntry(state)
            await this.reply(work.event, copy[this.settings.locale].newSession)
          } else {
            await this.processMessage(state, work, controller.signal)
          }
        } finally {
          state.active = undefined
          state.controller = undefined
        }
      }
    }).finally(() => {
      state.task = undefined
      if (!this.disposed && state.queue.length > 0) this.startDrain(chatId, state)
      else if (state.entry === undefined && this.chats.get(chatId) === state) this.chats.delete(chatId)
    })
    state.task = task
    this.track(task)
  }

  private async processMessage(state: ChatState, work: Work, signal: AbortSignal): Promise<void> {
    try {
      const entry = await this.ensureEntry(state, work.text, signal)
      signal.throwIfAborted()
      const message = createUserMessage({
        content: [{ type: 'text', text: work.text }],
        source: {
          kind: 'lark', chatId: work.event.chatId, chatType: work.event.chatType,
          senderId: work.event.senderId, messageId: work.event.messageId,
        },
      })
      const outcome = await runMessageTurn(entry.agent, message, signal)
      entry.lastActiveAt = Date.now()
      await this.reply(work.event, this.replyTextFor(outcome))
    } catch (error: unknown) {
      if (!signal.aborted) this.ctx.logger.warn(`dsh-lark: request ${work.event.messageId} failed: ${errorChain(error)}`)
      await this.reply(work.event, signal.aborted ? copy[this.settings.locale].stopped : copy[this.settings.locale].failed)
    }
  }

  private replyTextFor(outcome: TurnOutcome): string {
    const strings = copy[this.settings.locale]
    if (outcome.kind === 'canceled') return strings.stopped
    if (outcome.kind === 'discarded') return strings.discarded
    switch (outcome.reason.kind) {
      case 'completed': return outcome.text.trim() || strings.empty
      case 'aborted': return strings.stopped
      case 'error':
        this.ctx.logger.warn(`dsh-lark: turn failed: ${outcome.reason.error.message}`)
        return strings.failed
      case 'blocked': return strings.blocked
      case 'interrupted': return strings.interrupted
      case 'max-tokens': return `${strings.limited}${outcome.text.trim() === '' ? '' : `\n\n${outcome.text.trim()}`}`
      // Harness plugins can add new turn endings; never present those as success.
      default: return strings.interrupted
    }
  }

  private statusFor(chatId: LarkChatId): string {
    const state = this.chats.get(chatId)
    const strings = copy[this.settings.locale]
    if (state === undefined) return strings.noSession
    if (state.entry === undefined) return strings.starting
    return strings.status({
      id: state.entry.agent.session.id,
      running: state.active !== undefined || state.entry.agent.status === 'running',
      queued: state.queue.filter(work => work.kind === 'message').length,
      remainingMinutes: Math.max(0, Math.ceil((this.settings.sessionIdleMs - (Date.now() - state.entry.lastActiveAt)) / 60_000)),
    })
  }

  /** Expired idle sessions release resources when another accepted event arrives. */
  private reapIdle(): void {
    for (const [id, state] of this.chats) {
      if (state.task !== undefined || state.entry === undefined || state.entry.agent.status !== 'idle') continue
      if (Date.now() - state.entry.lastActiveAt < this.settings.sessionIdleMs) continue
      this.chats.delete(id)
      this.track(this.releaseEntry(state))
    }
  }

  private async reply(event: LarkMessageEvent, text: string): Promise<void> {
    if (this.disposed) return
    const bounded = truncateReply(text, this.settings.maxReplyChars)
    try {
      await this.egress.reply(event.messageId, bounded)
    } catch (replyError: unknown) {
      this.ctx.logger.warn(`dsh-lark: reply to ${event.messageId} failed: ${errorChain(replyError)}`)
      if (this.disposed) return
      try {
        await this.egress.send(event.chatId, bounded)
      } catch (sendError: unknown) {
        this.ctx.logger.warn(`dsh-lark: send to ${event.chatId} failed: ${errorChain(sendError)}`)
      }
    }
  }

  private async ensureEntry(state: ChatState, title: string, signal: AbortSignal): Promise<ChatEntry> {
    if (state.entry !== undefined) return state.entry
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const preset = await this.ctx.agentPresets.resolve(this.settings.agentPreset)
    signal.throwIfAborted()
    if (this.settings.permissionPreset !== undefined) this.ctx.permissionPresets.resolve(this.settings.permissionPreset)
    const workspace = await this.ensureWorkspace()
    signal.throwIfAborted()
    const sessionId = brandString<SessionId>(`lark-${randomUUID()}`)
    const handle = await this.ctx.agents.create({
      sessionId,
      signal,
      meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
        installInitialSelection(agentCtx, selection)
      },
    })
    let attached = false
    try {
      signal.throwIfAborted()
      await workspace.attachSession(sessionId)
      attached = true
      signal.throwIfAborted()
      if (this.settings.permissionPreset !== undefined) this.ctx.permissionPresets.set(handle.agent.session, this.settings.permissionPreset)
      this.ctx.sessionTitle.rename(handle.agent.session, `${this.settings.titlePrefix}${titleFromText(title)}`)
      const entry = { handle, agent: handle.agent, lastActiveAt: Date.now() }
      state.entry = entry
      return entry
    } catch (error: unknown) {
      if (attached) {
        try { await workspace.detachSession(sessionId) }
        catch (rollbackError: unknown) { this.ctx.logger.warn(`dsh-lark: detach failed: ${errorChain(rollbackError)}`) }
      }
      await handle.dispose()
      throw error
    }
  }

  private ensureWorkspace(): Promise<Awaited<ReturnType<Context['workspaceRegistry']['create']>>> {
    this.workspacePromise ??= this.ctx.workspaceRegistry.create(this.settings.workspacePath).catch((error: unknown) => {
      this.workspacePromise = undefined
      throw error
    })
    return this.workspacePromise
  }

  private async releaseEntry(state: ChatState): Promise<void> {
    const entry = state.entry
    state.entry = undefined
    if (entry === undefined) return
    await entry.handle.dispose()
  }
}
