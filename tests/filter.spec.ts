import { describe, expect, it } from 'vitest'
import { resolveLarkConfig } from '../src/config.ts'
import { shouldAccept } from '../src/filter.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../src/brand.ts'
import type { LarkMessageEvent } from '../src/types.ts'

const settings = resolveLarkConfig({ allowedSenders: ['ou_owner'], botName: 'My bot' })
const base: LarkMessageEvent = {
  eventId: toEventId('ev-1'), messageId: toMessageId('om_1'), chatId: toChatId('oc_1'),
  chatType: 'p2p', messageType: 'text', senderId: toOpenId('ou_owner'), content: 'run tests', createTimeMs: '1',
}

describe('access filter', () => {
  it('admits authorized private text and rejects other senders', () => {
    expect(shouldAccept(base, settings)).toBe(true)
    expect(shouldAccept({ ...base, senderId: toOpenId('ou_stranger') }, settings)).toBe(false)
    expect(shouldAccept({ ...base, senderId: toOpenId('ou_stranger') }, resolveLarkConfig({ allowAllSenders: true }))).toBe(true)
  })

  it('requires an exact leading bot mention for groups', () => {
    for (const content of ['hello @My bot', '@another /stop', '@My bot-evil /stop', '@My /stop']) {
      expect(shouldAccept({ ...base, chatType: 'group', content }, settings)).toBe(false)
    }
    expect(shouldAccept({ ...base, chatType: 'group', content: '@My bot /stop' }, settings)).toBe(true)
    expect(shouldAccept({ ...base, chatType: 'group', content: '@My bot /stop' }, { ...settings, groupPolicy: 'disabled' })).toBe(false)
    expect(shouldAccept({ ...base, chatType: 'group', content: '@My bot /stop' }, { ...settings, botName: undefined })).toBe(false)
  })

  it('combines chat and sender restrictions and ignores non-text content', () => {
    expect(shouldAccept(base, { ...settings, allowedChats: [toChatId('oc_other')] })).toBe(false)
    expect(shouldAccept({ ...base, messageType: 'image' }, settings)).toBe(false)
    expect(shouldAccept({ ...base, content: '  ' }, settings)).toBe(false)
  })
})
