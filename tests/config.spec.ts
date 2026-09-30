import { describe, expect, it } from 'vitest'
import { resolveLarkConfig } from '../src/config.ts'

const access = { allowedSenders: ['ou_owner'] }

describe('resolveLarkConfig', () => {
  it('requires an explicit access policy', () => {
    expect(() => resolveLarkConfig({})).toThrow(/allowedSenders/)
    expect(() => resolveLarkConfig({ allowedSenders: [] })).toThrow(/allowedSenders/)
    expect(() => resolveLarkConfig({ ...access, allowAllSenders: true })).toThrow(/not both/)
    expect(resolveLarkConfig({ allowAllSenders: true }).allowAllSenders).toBe(true)
  })

  it('resolves bounded defaults and preserves the host preset choice', () => {
    expect(resolveLarkConfig(access)).toMatchObject({
      identity: 'bot', eventKey: 'im.message.receive_v1', locale: 'zh-CN', groupPolicy: 'mentions',
      sessionIdleMs: 1_800_000, restartDelayMs: 3_000, ingressReadyTimeoutMs: 30_000,
      egressTimeoutMs: 30_000, maxPendingMessagesPerChat: 8, maxActiveChats: 32,
      dedupCapacity: 1_000, maxReplyChars: 4_000, titlePrefix: '[lark] ', agentPreset: undefined,
      permissionPreset: undefined, allowAllSenders: false,
    })
  })

  it('expands home paths but rejects relative paths', () => {
    expect(resolveLarkConfig({ ...access, workspacePath: '~/lark-ws' }).workspacePath).toMatch(/\/lark-ws$/)
    expect(() => resolveLarkConfig({ ...access, workspacePath: 'relative/path' })).toThrow(/absolute/)
    expect(() => resolveLarkConfig({ ...access, workspacePath: '  ' })).toThrow(/blank/)
  })

  it('validates and deduplicates sender and chat identifiers', () => {
    expect(resolveLarkConfig({ allowedSenders: [' ou_a ', 'ou_a'], allowedChats: [' oc_1 '] })).toMatchObject({ allowedSenders: ['ou_a'], allowedChats: ['oc_1'] })
    for (const value of ['', 'ou_', 'user@example.com', 'ou_a b']) {
      expect(() => resolveLarkConfig({ allowedSenders: [value] })).toThrow(/identifiers/)
    }
    expect(() => resolveLarkConfig({ ...access, allowedChats: ['ou_a'] })).toThrow(/allowedChats/)
  })

  it('preserves intentional title spacing and explicit preset names', () => {
    expect(resolveLarkConfig({ ...access, titlePrefix: 'Work: ', agentPreset: ' standard ', permissionPreset: 'ask', locale: 'en' })).toMatchObject({ titlePrefix: 'Work: ', agentPreset: 'standard', permissionPreset: 'ask', locale: 'en' })
    expect(resolveLarkConfig({ ...access, titlePrefix: '' }).titlePrefix).toBe('')
  })

  it('rejects unsupported identities and timer overflow', () => {
    for (const identity of ['user', 'auto', 'root', ' ']) expect(() => resolveLarkConfig({ ...access, identity })).toThrow()
    expect(() => resolveLarkConfig({ ...access, restartDelayMs: 2_147_483_648 })).toThrow(/restartDelayMs/)
    expect(() => resolveLarkConfig({ ...access, ingressReadyTimeoutMs: 0 })).toThrow(/ingressReadyTimeoutMs/)
    expect(() => resolveLarkConfig({ ...access, egressTimeoutMs: -1 })).toThrow(/egressTimeoutMs/)
    expect(() => resolveLarkConfig({ ...access, maxReplyChars: 1.5 })).toThrow(/maxReplyChars/)
    expect(() => resolveLarkConfig({ ...access, sessionIdleMinutes: Infinity })).toThrow(/sessionIdleMinutes/)
    expect(() => resolveLarkConfig({ ...access, sessionIdleMinutes: 0 })).toThrow(/sessionIdleMinutes/)
    expect(() => resolveLarkConfig({ ...access, botName: ' ' })).toThrow(/botName/)
    expect(() => resolveLarkConfig({ ...access, maxActiveChats: 0 })).toThrow(/maxActiveChats/)
  })
})
