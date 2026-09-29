import { describe, expect, it } from 'vitest'
import { resolveLarkConfig } from '../src/config.ts'

describe('resolveLarkConfig', () => {
  it('computes every default from an empty config', () => {
    const settings = resolveLarkConfig({})
    expect(settings.larkCliPath).toBe('lark-cli')
    expect(settings.identity).toBe('bot')
    expect(settings.eventKey).toBe('im.message.receive_v1')
    expect(settings.allowedSenders).toEqual([])
    expect(settings.allowedChats).toEqual([])
    expect(settings.workspacePath).toMatch(/\.dsh\/lark\/workspace$/)
    expect(settings.sessionIdleMs).toBe(30 * 60_000)
    expect(settings.restartDelayMs).toBe(3_000)
    expect(settings.maxReplyChars).toBe(4_000)
    expect(settings.titlePrefix).toBe('[lark] ')
    expect(settings.agentPreset).toBeUndefined()
    expect(settings.permissionPreset).toBeUndefined()
  })

  it('expands a leading ~ in workspacePath to the home directory', () => {
    const settings = resolveLarkConfig({ workspacePath: '~/lark-ws' })
    expect(settings.workspacePath).not.toContain('~')
    expect(settings.workspacePath.endsWith('/lark-ws')).toBe(true)
  })

  it('keeps explicit preset names', () => {
    const settings = resolveLarkConfig({ agentPreset: 'coder', permissionPreset: 'yolo' })
    expect(settings.agentPreset).toBe('coder')
    expect(settings.permissionPreset).toBe('yolo')
  })

  it('trims allowlist entries', () => {
    const settings = resolveLarkConfig({ allowedSenders: [' ou_a '], allowedChats: ['oc_1'] })
    expect(settings.allowedSenders).toEqual(['ou_a'])
    expect(settings.allowedChats).toEqual(['oc_1'])
  })

  it('rejects blank strings and unknown identities', () => {
    expect(() => resolveLarkConfig({ larkCliPath: '   ' })).toThrow(/larkCliPath/)
    expect(() => resolveLarkConfig({ titlePrefix: '' })).toThrow(/titlePrefix/)
    expect(() => resolveLarkConfig({ identity: 'root' })).toThrow(/identity/)
    expect(() => resolveLarkConfig({ agentPreset: ' ' })).toThrow(/agentPreset/)
  })

  it('rejects blank allowlist entries and non-positive numbers', () => {
    expect(() => resolveLarkConfig({ allowedSenders: ['ok', '  '] })).toThrow(/allowedSenders/)
    expect(() => resolveLarkConfig({ sessionIdleMinutes: 0 })).toThrow(/sessionIdleMinutes/)
    expect(() => resolveLarkConfig({ sessionIdleMinutes: Number.POSITIVE_INFINITY })).toThrow(/sessionIdleMinutes/)
    expect(() => resolveLarkConfig({ restartDelayMs: -1 })).toThrow(/restartDelayMs/)
    expect(() => resolveLarkConfig({ maxReplyChars: 1.5 })).toThrow(/maxReplyChars/)
    expect(() => resolveLarkConfig({ workspacePath: 'relative/path' })).not.toThrow()
  })
})
