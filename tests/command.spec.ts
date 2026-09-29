import { describe, expect, it } from 'vitest'
import { describeBridgeCommands, isKnownCommand, parseBridgeCommand, stripMention } from '../src/command.ts'

describe('stripMention', () => {
  it('strips the exact bot name, including names with spaces', () => {
    expect(stripMention('@黄成乾的飞书 CLI 你好', '黄成乾的飞书 CLI')).toBe('你好')
    expect(stripMention('@测试Bot /new', '测试Bot')).toBe('/new')
  })

  it('falls back to the first token when the name is unknown', () => {
    expect(stripMention('@bot 你好', undefined)).toBe('你好')
  })

  it('leaves text without a mention unchanged', () => {
    expect(stripMention('直接说话', undefined)).toBe('直接说话')
    expect(stripMention('  带空白  ', undefined)).toBe('带空白')
  })

  it('returns empty text for a bare mention', () => {
    expect(stripMention('@bot', undefined)).toBe('')
  })
})

describe('parseBridgeCommand', () => {
  it('parses name-only commands case-insensitively', () => {
    expect(parseBridgeCommand('/new')).toEqual({ name: 'new', argument: '' })
    expect(parseBridgeCommand('/STATUS')).toEqual({ name: 'status', argument: '' })
    expect(parseBridgeCommand('  /help  ')).toEqual({ name: 'help', argument: '' })
  })

  it('parses commands with arguments across lines', () => {
    expect(parseBridgeCommand('/new 保留理由')).toEqual({ name: 'new', argument: '保留理由' })
    expect(parseBridgeCommand('/stop\n说明')).toEqual({ name: 'stop', argument: '说明' })
  })

  it('rejects non-commands and malformed tokens', () => {
    expect(parseBridgeCommand('帮我跑测试')).toBeUndefined()
    expect(parseBridgeCommand('')).toBeUndefined()
    expect(parseBridgeCommand('/')).toBeUndefined()
    expect(parseBridgeCommand('/1new')).toBeUndefined()
    expect(parseBridgeCommand('text /new')).toBeUndefined()
  })

  it('recognizes known names and renders the help text', () => {
    expect(isKnownCommand('new')).toBe(true)
    expect(isKnownCommand('foo')).toBe(false)
    const help = describeBridgeCommands()
    expect(help).toContain('可用命令')
    expect(help).toContain('/stop — 停止正在运行的回合')
  })
})
