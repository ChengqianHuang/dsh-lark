import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LarkIngest } from '../src/ingress.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../src/brand.ts'
import type { LarkMessageEvent } from '../src/types.ts'

const fixture = fileURLToPath(new URL('./helpers/fake-lark-consume.mjs', import.meta.url))
const EVENT = {
  type: 'im.message.receive_v1', event_id: 'ev-1', message_id: 'om_1', chat_id: 'oc_1',
  chat_type: 'p2p', message_type: 'text', sender_id: 'ou_1', content: '你好', create_time: '1',
}

async function harness(scenario: Record<string, unknown> = {}, settings: { readyTimeoutMs?: number; dedupCapacity?: number; throwOnEvent?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-ingress-'))
  const beforeReady = Promise.withResolvers<void>()
  const eventArrived = Promise.withResolvers<void>()
  const wrongMarker = Promise.withResolvers<void>()
  const exit = Promise.withResolvers<void>()
  const eof = Promise.withResolvers<void>()
  const events: LarkMessageEvent[] = []
  const exits: string[] = []
  const warns: string[] = []
  const options = {
    ...scenario,
    readyGate: scenario['gateReady'] ? join(root, 'ready') : undefined,
    shutdownGate: scenario['gateShutdown'] ? join(root, 'shutdown') : undefined,
    eofPath: join(root, 'eof'),
    closedPath: join(root, 'closed'),
  }
  const ingest = new LarkIngest(process.execPath, [fixture, JSON.stringify(options)], {
    onEvent: event => {
      events.push(event)
      eventArrived.resolve()
      if (settings.throwOnEvent) throw new Error('subscriber broke')
    },
    onUnexpectedExit: reason => { exits.push(reason); exit.resolve() },
    logger: {
      info: message => {
        if (message.endsWith('fixture: before ready')) beforeReady.resolve()
        if (message.endsWith('fixture: stdin closed')) eof.resolve()
        if (message.endsWith('[event] ready event_key=im.message.message_read_v1')) wrongMarker.resolve()
      },
      warn: message => { warns.push(message) },
    },
  }, { eventKey: 'im.message.receive_v1', readyTimeoutMs: settings.readyTimeoutMs ?? 30_000, dedupCapacity: settings.dedupCapacity ?? 1_000 })
  onTestFinished(async () => {
    await writeFile(join(root, 'ready'), '')
    await writeFile(join(root, 'shutdown'), '')
    await ingest.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { ingest, events, exits, warns, root, beforeReady: beforeReady.promise, eventArrived: eventArrived.promise, exit: exit.promise, eof: eof.promise, wrongMarker: wrongMarker.promise }
}

describe('LarkIngest', () => {
  it('waits for the exact ready marker and retains stdout that arrived first', async () => {
    const h = await harness({ gateReady: true, beforeReady: [EVENT] })
    const starting = h.ingest.start()
    await h.beforeReady
    expect(h.events).toEqual([])
    await writeFile(join(h.root, 'ready'), '')
    await starting
    await h.eventArrived
    expect(h.events[0]).toMatchObject({ messageId: toMessageId('om_1'), chatId: toChatId('oc_1'), senderId: toOpenId('ou_1'), eventId: toEventId('ev-1') })
    await h.ingest.dispose()
    expect(h.exits).toEqual([])
    expect(await readFile(join(h.root, 'closed'), 'utf8')).toBe('unsubscribed')
  })

  it('deduplicates redeliveries across child restarts', async () => {
    const h = await harness({ events: [EVENT, EVENT], exitAfterEvents: true })
    await h.ingest.start()
    await h.exit
    expect(h.events).toHaveLength(1)
    await h.ingest.start()
    await h.ingest.dispose()
    expect(h.events).toHaveLength(1)
    expect(h.exits[0]).toContain('code=7')
  })

  it('evicts only the oldest ids when deduplication reaches its configured capacity', async () => {
    const h = await harness({ events: [EVENT, { ...EVENT, event_id: 'ev-2' }, { ...EVENT, event_id: 'ev-3' }, EVENT], exitAfterEvents: true }, { dedupCapacity: 2 })
    await h.ingest.start()
    await h.exit
    expect(h.events.map(event => event.eventId)).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-1'])
  })

  it('skips malformed payloads and contains subscriber exceptions', async () => {
    const h = await harness({ junk: true, events: [EVENT, { ...EVENT, event_id: 'ev-2' }], exitAfterEvents: true }, { throwOnEvent: true })
    await h.ingest.start()
    await h.exit
    expect(h.events).toHaveLength(2)
    expect(h.warns.filter(message => message.includes('unparseable'))).toHaveLength(1)
    expect(h.warns.filter(message => message.includes('not a receive-message event'))).toHaveLength(2)
    expect(h.warns.filter(message => message.includes('subscriber broke'))).toHaveLength(2)
  })

  it('rejects startup when a consumer exits before readiness', async () => {
    const h = await harness({ crashBeforeReady: true })
    await expect(h.ingest.start()).rejects.toThrow('before ready marker')
    expect(h.exits).toEqual([])
  })

  it('rejects a wrong event-key marker and gracefully closes the startup child', async () => {
    const h = await harness({ eventKey: 'im.message.message_read_v1' }, { readyTimeoutMs: 100 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onTestFinished(() => { vi.useRealTimers() })
    const starting = h.ingest.start()
    const rejected = expect(starting).rejects.toThrow('ready marker was not received')
    await h.wrongMarker
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(await readFile(join(h.root, 'closed'), 'utf8')).toBe('unsubscribed')
    expect(h.exits).toEqual([])
  })

  it('rejects a missing executable without a restart notification', async () => {
    const exits: string[] = []
    const ingest = new LarkIngest('/no-such-dsh-lark-executable', [], {
      onEvent: () => {}, onUnexpectedExit: reason => { exits.push(reason) }, logger: { info: () => {}, warn: () => {} },
    }, { eventKey: 'im.message.receive_v1', readyTimeoutMs: 30_000, dedupCapacity: 1 })
    onTestFinished(() => ingest.dispose())
    await expect(ingest.start()).rejects.toThrow('spawn failed')
    expect(exits).toEqual([])
  })

  it('stops admission before EOF and waits for actual unsubscribe completion', async () => {
    const h = await harness({ events: [EVENT], gateShutdown: true, lateEvents: [{ ...EVENT, event_id: 'late' }] })
    await h.ingest.start()
    await h.eventArrived
    const disposal = h.ingest.dispose()
    expect(h.ingest.dispose()).toBe(disposal)
    let settled = false
    void disposal.then(() => { settled = true })
    // The child writes this file only after receiving EOF, then blocks on our release file.
    await expect.poll(() => readFile(join(h.root, 'eof'), 'utf8')).toBe('stdin closed')
    expect(settled).toBe(false)
    await writeFile(join(h.root, 'shutdown'), '')
    await disposal
    expect(await readFile(join(h.root, 'closed'), 'utf8')).toBe('unsubscribed')
    expect(h.events).toHaveLength(1)
    expect(h.exits).toEqual([])
    expect(() => h.ingest.start()).toThrow('disposed')
  })

  it('rejects simultaneous starts and cancels a pending startup on disposal', async () => {
    const h = await harness({ gateReady: true })
    const starting = h.ingest.start()
    const rejected = expect(starting).rejects.toThrow('disposed before readiness')
    expect(() => h.ingest.start()).toThrow('already running')
    await h.beforeReady
    await h.ingest.dispose()
    await rejected
  })
})
