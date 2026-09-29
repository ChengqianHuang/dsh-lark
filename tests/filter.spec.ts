import { describe, expect, it } from 'vitest'
import { resolveLarkConfig } from '../src/config.ts'
import { shouldAccept } from '../src/filter.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../src/brand.ts'
import type { LarkMessageEvent } from '../src/types.ts'

const settings = resolveLarkConfig({})

function event(overrides: Partial<LarkMessageEvent> = {}): LarkMessageEvent {
  return {
    eventId: toEventId('ev-1'),
    messageId: toMessageId('om_1'),
    chatId: toChatId('oc_1'),
    chatType: 'p2p',
    messageType: 'text',
    senderId: toOpenId('ou_1'),
    content: '跑一下测试',
    createTimeMs: '1',
    ...overrides,
  }
}

describe('shouldAccept', () => {
  it('accepts every p2p text message by default', () => {
    expect(shouldAccept(event(), settings)).toBe(true)
  })

  it('accepts a group message only when it starts with @', () => {
    expect(shouldAccept(event({ chatType: 'group', content: '@bot 跑测试' }), settings)).toBe(true)
    expect(shouldAccept(event({ chatType: 'group', content: 'hello @bot' }), settings)).toBe(false)
  })

  it('ignores non-text messages', () => {
    expect(shouldAccept(event({ messageType: 'image' }), settings)).toBe(false)
    expect(shouldAccept(event({ messageType: 'interactive' }), settings)).toBe(false)
  })

  it('filters by sender and chat allowlists when configured', () => {
    const narrowed = resolveLarkConfig({ allowedSenders: ['ou_2'], allowedChats: ['oc_2'] })
    expect(shouldAccept(event(), narrowed)).toBe(false)
    expect(shouldAccept(event({ senderId: toOpenId('ou_2'), chatId: toChatId('oc_2') }), narrowed)).toBe(true)
  })
})
