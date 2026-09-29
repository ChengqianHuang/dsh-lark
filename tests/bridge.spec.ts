import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ChatRouter } from '../src/bridge.ts'
import { resolveLarkConfig, type LarkSettings } from '../src/config.ts'
import type { Egress } from '../src/egress.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../src/brand.ts'
import type { LarkMessageEvent } from '../src/types.ts'

/** In-memory session log the fake agent appends to; reply/reason shape the turn. */
interface FakeSessionLog {
  events: Array<{ type: string; data: unknown }>
  reply: string
  reason: unknown
  /** Defer `whenIdle` until the fake cancel resolves it. */
  deferIdle: boolean
}

interface FakeAgent {
  agent: Agent
  cancelCalls: Array<unknown>
  resolveIdle(): void
}

function makeAgent(log: FakeSessionLog, messages: Array<unknown>): FakeAgent {
  const cancelCalls: Array<unknown> = []
  let resolveIdle: (() => void) | undefined
  const agent = {
    session: {
      get seq(): number {
        return log.events.length
      },
      eventAt: (seq: number) => log.events[seq],
    },
    followup(message: unknown): void {
      messages.push(message)
      log.events.push({ type: 'turn/start', data: {} })
      // A deferred turn is "still running": only cancel closes it.
      if (!log.deferIdle) {
        log.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: log.reply }] } } })
        log.events.push({ type: 'turn/end', data: { reason: log.reason } })
      }
    },
    whenIdle(): Promise<void> {
      if (!log.deferIdle) return Promise.resolve()
      return new Promise<void>(resolve => {
        resolveIdle = resolve
      })
    },
    cancel(cause: unknown): void {
      cancelCalls.push(cause)
      log.events.push({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: cause } } })
      resolveIdle?.()
    },
  }
  return {
    agent: agent as unknown as Agent,
    cancelCalls,
    resolveIdle: () => resolveIdle?.(),
  }
}

interface Harness {
  ctx: Context
  settings: LarkSettings
  created: string[]
  disposed: string[]
  titles: string[]
  logs: Array<{ log: FakeSessionLog; messages: Array<unknown>; fake: FakeAgent }>
}

function harness(overrides: { sessionIdleMinutes?: number; maxReplyChars?: number; botName?: string; deferIdle?: boolean } = {}): Harness {
  const created: string[] = []
  const disposed: string[] = []
  const titles: string[] = []
  const logs: Array<{ log: FakeSessionLog; messages: Array<unknown>; fake: FakeAgent }> = []
  const ctx = {
    agents: {
      create: async (options: { sessionId: string }) => {
        created.push(options.sessionId)
        const log: FakeSessionLog = { events: [], reply: 'ok', reason: { kind: 'completed' }, deferIdle: overrides.deferIdle === true }
        const messages: Array<unknown> = []
        const fake = makeAgent(log, messages)
        logs.push({ log, messages, fake })
        return {
          agent: fake.agent,
          dispose: async () => { disposed.push(options.sessionId) },
        }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'dsh' }) },
    agentPresets: {
      resolve: async () => {
        throw new Error('no preset roster in tests')
      },
      mount: async () => {},
    },
    permissionPresets: { resolve: () => 'granted', set: () => {} },
    sessionTitle: { rename: (_session: unknown, title: string) => { titles.push(title) } },
    workspaceRegistry: {
      create: async (path: string) => ({ path, attachSession: async () => {}, detachSession: async () => {} }),
    },
    logger: { info: () => {}, warn: () => {} },
  } as unknown as Context
  const settings = resolveLarkConfig({ workspacePath: '/tmp/dsh-lark-test', ...overrides })
  return { ctx, settings, created, disposed, titles, logs }
}

class RecordingEgress implements Egress {
  readonly calls: Array<{ kind: string; target: string; text: string }> = []
  failReply = false

  async reply(messageId: string, text: string): Promise<void> {
    if (this.failReply) throw new Error('reply transport down')
    this.calls.push({ kind: 'reply', target: messageId, text })
  }

  async send(chatId: string, text: string): Promise<void> {
    this.calls.push({ kind: 'send', target: chatId, text })
  }
}

function event(overrides: Partial<LarkMessageEvent> = {}): LarkMessageEvent {
  return {
    eventId: toEventId(`ev-${String(Math.random())}`),
    messageId: toMessageId('om_1'),
    chatId: toChatId('oc_1'),
    chatType: 'p2p',
    messageType: 'text',
    senderId: toOpenId('ou_1'),
    content: '帮我跑测试',
    createTimeMs: '1',
    ...overrides,
  }
}

async function settle(router: ChatRouter): Promise<void> {
  await router.settle()
}

/** Yield one macrotask so an immediate (chain-bypassing) /stop handler settles. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('ChatRouter turns', () => {
  it('creates a titled session, forwards the stripped text with the lark source, and replies with the turn text', async () => {
    const h = harness({ botName: '测试Bot' })
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '@测试Bot 帮我跑测试' }))
    await settle(router)
    expect(h.created).toHaveLength(1)
    expect(h.titles[0]).toBe('[lark] 帮我跑测试')
    const message = h.logs[0]?.messages[0] as { content: Array<{ text: string }>; source: { kind: string; chatId: string; senderId: string } }
    expect(message.content[0]?.text).toBe('帮我跑测试')
    expect(message.source).toMatchObject({ kind: 'lark', chatId: 'oc_1', senderId: 'ou_1' })
    expect(egress.calls).toEqual([{ kind: 'reply', target: 'om_1', text: 'ok' }])
    await router.dispose()
  })

  it('reuses the chat session for a second message', async () => {
    const h = harness()
    const router = new ChatRouter(h.ctx, h.settings, new RecordingEgress())
    router.handle(event())
    await settle(router)
    router.handle(event({ messageId: toMessageId('om_2') }))
    await settle(router)
    expect(h.created).toHaveLength(1)
    expect(h.logs[0]?.messages).toHaveLength(2)
    await router.dispose()
  })

  it('starts a fresh session after the idle window and disposes the old one', async () => {
    const h = harness({ sessionIdleMinutes: 0.0002 })
    const router = new ChatRouter(h.ctx, h.settings, new RecordingEgress())
    router.handle(event())
    await settle(router)
    await new Promise(resolve => setTimeout(resolve, 30))
    router.handle(event())
    await settle(router)
    expect(h.created).toHaveLength(2)
    expect(h.disposed).toHaveLength(1)
    await router.dispose()
  })

  it('falls back to a plain chat send when the reply fails', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    egress.failReply = true
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await settle(router)
    expect(egress.calls).toEqual([{ kind: 'send', target: 'oc_1', text: 'ok' }])
    await router.dispose()
  })

  it('reports an error turn and a stopped turn through the reply path', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await settle(router)
    const log = h.logs[0]?.log
    if (log === undefined) throw new Error('missing fake session log')
    log.reply = ''
    log.reason = { kind: 'error', error: { code: 'boom', message: '模型不可用' } }
    router.handle(event({ messageId: toMessageId('om_3') }))
    await settle(router)
    log.reason = { kind: 'aborted', reason: { kind: 'user' } }
    router.handle(event({ messageId: toMessageId('om_4') }))
    await settle(router)
    expect(egress.calls.map(call => call.text)).toEqual(['ok', 'dsh 本轮出错：模型不可用', '已停止本轮。'])
    await router.dispose()
  })

  it('truncates replies beyond the configured bound', async () => {
    const h = harness({ maxReplyChars: 5 })
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await settle(router)
    const log = h.logs[0]?.log
    if (log === undefined) throw new Error('missing fake session log')
    log.reply = 'abcdefghijklmno'
    router.handle(event({ messageId: toMessageId('om_4') }))
    await settle(router)
    expect(egress.calls.at(-1)?.text).toBe('abcd…')
    await router.dispose()
  })
})

describe('ChatRouter bridge commands', () => {
  it('answers /help and unknown commands without creating a session', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '/help' }))
    await settle(router)
    router.handle(event({ content: '/foo bar' }))
    await settle(router)
    expect(h.created).toHaveLength(0)
    expect(egress.calls).toHaveLength(2)
    expect(egress.calls[0]?.text).toContain('可用命令')
    expect(egress.calls[1]?.text).toContain('未知命令 /foo')
    await router.dispose()
  })

  it('handles group commands after exact mention stripping', async () => {
    const h = harness({ botName: '测试Bot' })
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ chatType: 'group', content: '@测试Bot /help' }))
    await settle(router)
    expect(h.created).toHaveLength(0)
    expect(egress.calls[0]?.text).toContain('可用命令')
    await router.dispose()
  })

  it('ends the session on /new and reports an absent session', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '/new' }))
    await settle(router)
    expect(egress.calls[0]?.text).toContain('当前没有活跃会话')
    router.handle(event({ content: '第一条' }))
    await settle(router)
    router.handle(event({ content: '/new', messageId: toMessageId('om_2') }))
    await settle(router)
    expect(h.created).toHaveLength(1)
    expect(h.disposed).toHaveLength(1)
    expect(egress.calls.at(-1)?.text).toContain('已结束当前会话')
    router.handle(event({ content: '第二条', messageId: toMessageId('om_3') }))
    await settle(router)
    expect(h.created).toHaveLength(2)
    await router.dispose()
  })

  it('reports status with the session id and state', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '/status' }))
    await settle(router)
    expect(egress.calls[0]?.text).toContain('当前没有活跃会话')
    router.handle(event({ content: '开始会话' }))
    await settle(router)
    router.handle(event({ content: '/status', messageId: toMessageId('om_2') }))
    await settle(router)
    const status = egress.calls.at(-1)?.text ?? ''
    expect(status).toContain('会话 lark-')
    expect(status).toContain('空闲')
    await router.dispose()
  })

  it('stops a running turn immediately and lets the aborted turn reply', async () => {
    const h = harness({ deferIdle: true })
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '长任务' }))
    await tick()
    const entry = h.logs[0]
    if (entry === undefined) throw new Error('missing fake session')
    router.handle(event({ content: '/stop', messageId: toMessageId('om_9') }))
    await tick()
    expect(entry.fake.cancelCalls).toEqual([{ kind: 'user' }])
    entry.fake.resolveIdle()
    await settle(router)
    expect(egress.calls).toEqual([{ kind: 'reply', target: 'om_1', text: '已停止本轮。' }])
    await router.dispose()
  })

  it('answers /stop when nothing is running', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event({ content: '/stop' }))
    await tick()
    expect(egress.calls).toEqual([{ kind: 'reply', target: 'om_1', text: '当前没有活跃会话。' }])
    router.handle(event({ content: '开始会话', messageId: toMessageId('om_2') }))
    await settle(router)
    router.handle(event({ content: '/stop', messageId: toMessageId('om_3') }))
    await tick()
    expect(egress.calls.at(-1)?.text).toBe('当前没有正在运行的回合。')
    await router.dispose()
  })
})
