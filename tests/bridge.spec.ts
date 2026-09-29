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
}

function makeAgent(log: FakeSessionLog, messages: Array<unknown>): Agent {
  return {
    session: {
      get seq(): number {
        return log.events.length
      },
      eventAt: (seq: number) => log.events[seq],
    },
    followup(message: unknown): void {
      messages.push(message)
      log.events.push({ type: 'turn/start', data: {} })
      log.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: log.reply }] } } })
      log.events.push({ type: 'turn/end', data: { reason: log.reason } })
    },
    whenIdle: async () => {},
  } as unknown as Agent
}

interface Harness {
  ctx: Context
  settings: LarkSettings
  created: string[]
  disposed: string[]
  titles: string[]
  logs: Array<{ log: FakeSessionLog; messages: Array<unknown> }>
}

function harness(overrides: { sessionIdleMinutes?: number; maxReplyChars?: number } = {}): Harness {
  const created: string[] = []
  const disposed: string[] = []
  const titles: string[] = []
  const logs: Array<{ log: FakeSessionLog; messages: Array<unknown> }> = []
  const ctx = {
    agents: {
      create: async (options: { sessionId: string }) => {
        created.push(options.sessionId)
        const log: FakeSessionLog = { events: [], reply: 'ok', reason: { kind: 'completed' } }
        const messages: Array<unknown> = []
        logs.push({ log, messages })
        return {
          agent: makeAgent(log, messages),
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

describe('ChatRouter', () => {
  it('creates a titled session, forwards the message with the lark source, and replies with the turn text', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await router.settle()
    expect(h.created).toHaveLength(1)
    expect(h.titles[0]).toBe('[lark] 帮我跑测试')
    const message = h.logs[0]?.messages[0] as { source: { kind: string; chatId: string; senderId: string } }
    expect(message.source).toMatchObject({ kind: 'lark', chatId: 'oc_1', senderId: 'ou_1' })
    expect(egress.calls).toEqual([{ kind: 'reply', target: 'om_1', text: 'ok' }])
    await router.dispose()
  })

  it('reuses the chat session for a second message', async () => {
    const h = harness()
    const router = new ChatRouter(h.ctx, h.settings, new RecordingEgress())
    router.handle(event())
    await router.settle()
    router.handle(event({ messageId: toMessageId('om_2') }))
    await router.settle()
    expect(h.created).toHaveLength(1)
    expect(h.logs[0]?.messages).toHaveLength(2)
    await router.dispose()
  })

  it('starts a fresh session after the idle window and disposes the old one', async () => {
    const h = harness({ sessionIdleMinutes: 0.0002 })
    const router = new ChatRouter(h.ctx, h.settings, new RecordingEgress())
    router.handle(event())
    await router.settle()
    await new Promise(resolve => setTimeout(resolve, 30))
    router.handle(event())
    await router.settle()
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
    await router.settle()
    expect(egress.calls).toEqual([{ kind: 'send', target: 'oc_1', text: 'ok' }])
    await router.dispose()
  })

  it('reports an error turn through the reply path', async () => {
    const h = harness()
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await router.settle()
    const log = h.logs[0]?.log
    if (log === undefined) throw new Error('missing fake session log')
    log.reply = ''
    log.reason = { kind: 'error', error: { code: 'boom', message: '模型不可用' } }
    router.handle(event({ messageId: toMessageId('om_3') }))
    await router.settle()
    expect(egress.calls.map(call => call.text)).toEqual(['ok', 'dsh 本轮出错：模型不可用'])
    await router.dispose()
  })

  it('truncates replies beyond the configured bound', async () => {
    const h = harness({ maxReplyChars: 5 })
    const egress = new RecordingEgress()
    const router = new ChatRouter(h.ctx, h.settings, egress)
    router.handle(event())
    await router.settle()
    const log = h.logs[0]?.log
    if (log === undefined) throw new Error('missing fake session log')
    log.reply = 'abcdefghijklmno'
    router.handle(event({ messageId: toMessageId('om_4') }))
    await router.settle()
    expect(egress.calls.at(-1)?.text).toBe('abcd…')
    await router.dispose()
  })
})
