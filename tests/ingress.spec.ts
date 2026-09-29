import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { READY_MARKER_PREFIX, LarkIngest } from '../src/ingress.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../src/brand.ts'
import type { LarkMessageEvent } from '../src/types.ts'

const fixture = fileURLToPath(new URL('./helpers/fake-lark-consume.mjs', import.meta.url))

const EVENT: Record<string, unknown> = {
  type: 'im.message.receive_v1',
  event_id: 'ev-1',
  message_id: 'om_1',
  chat_id: 'oc_1',
  chat_type: 'p2p',
  message_type: 'text',
  sender_id: 'ou_1',
  content: '你好',
  create_time: '1',
}

interface Captured {
  events: LarkMessageEvent[]
  exits: string[]
  warns: string[]
  infos: string[]
}

function runOnce(env: Record<string, string>): { ingest: LarkIngest; captured: Captured } {
  const captured: Captured = { events: [], exits: [], warns: [], infos: [] }
  const ingest = new LarkIngest(process.execPath, [fixture], {
    onEvent: event => { captured.events.push(event) },
    onUnexpectedExit: reason => { captured.exits.push(reason) },
    logger: {
      info: message => { captured.infos.push(message) },
      warn: message => { captured.warns.push(message) },
    },
  })
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  return { ingest, captured }
}

function cleanEnv(): void {
  delete process.env.FAKE_EVENTS
  delete process.env.FAKE_CRASH
}

describe('LarkIngest', () => {
  it('dispatches events after the ready marker and deduplicates redeliveries', async () => {
    process.env.FAKE_EVENTS = JSON.stringify([EVENT, EVENT])
    const { ingest, captured } = runOnce({})
    try {
      ingest.start()
      for (let i = 0; i < 100 && captured.events.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(captured.exits).toEqual([])
      expect(captured.events).toHaveLength(1)
      expect(captured.events[0]).toMatchObject({ messageId: toMessageId('om_1'), chatId: toChatId('oc_1'), senderId: toOpenId('ou_1') })
      expect(captured.events[0]?.eventId).toBe(toEventId('ev-1'))
      expect(captured.infos.some(line => line.includes('ingress ready'))).toBe(true)
    } finally {
      await ingest.dispose()
      cleanEnv()
    }
    expect(captured.exits).toEqual([])
  })

  it('buffers stdout lines that arrive before the ready marker', async () => {
    // The fixture writes the marker and the events back-to-back; the reader
    // side must not drop lines that lose the cross-pipe race.
    process.env.FAKE_EVENTS = JSON.stringify([EVENT])
    const { ingest, captured } = runOnce({})
    try {
      ingest.start()
      for (let i = 0; i < 100 && captured.events.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(captured.events).toHaveLength(1)
    } finally {
      await ingest.dispose()
      cleanEnv()
    }
  })

  it('skips unparseable and non-event lines with a warning', async () => {
    process.env.FAKE_EVENTS = JSON.stringify([EVENT])
    const { ingest, captured } = runOnce({ FAKE_JUNK: '1' })
    try {
      ingest.start()
      for (let i = 0; i < 100 && captured.events.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(captured.events).toHaveLength(1)
      expect(captured.warns.some(line => line.includes('unparseable'))).toBe(true)
      expect(captured.warns.filter(line => line.includes('not a receive-message event'))).toHaveLength(2)
    } finally {
      await ingest.dispose()
      cleanEnv()
    }
  })

  it('reports an unexpected exit when the consumer crashes before the marker', async () => {
    const { ingest, captured } = runOnce({ FAKE_CRASH: '1' })
    try {
      ingest.start()
      for (let i = 0; i < 100 && captured.exits.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(captured.exits[0]).toContain('before ready marker')
    } finally {
      await ingest.dispose()
      cleanEnv()
    }
  })

  it('rejects start after dispose and double start while running', async () => {
    process.env.FAKE_EVENTS = '[]'
    const { ingest } = runOnce({})
    try {
      ingest.start()
      expect(() => ingest.start()).toThrow(/already running/)
    } finally {
      await ingest.dispose()
      cleanEnv()
    }
    expect(() => ingest.start()).toThrow(/disposed/)
  })
})
