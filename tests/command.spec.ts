import { describe, expect, it } from 'vitest'
import { describeBridgeCommands, hasBotMention, isKnownCommand, parseBridgeCommand, stripMention } from '../src/command.ts'

describe('bot mentions', () => {
  it('recognizes exact names with spaces and a token boundary', () => {
    expect(stripMention(' @黄成乾的飞书 CLI /new ', '黄成乾的飞书 CLI')).toBe('/new')
    expect(stripMention('@bot', 'bot')).toBe('')
    expect(hasBotMention('@bot-extra hello', 'bot')).toBe(false)
    expect(hasBotMention('hello @bot', 'bot')).toBe(false)
  })

  it('preserves unknown and unrelated mentions in private messages', () => {
    expect(stripMention('@someone check this', 'bot')).toBe('@someone check this')
    expect(stripMention('@person with spaces', undefined)).toBe('@person with spaces')
    expect(stripMention('  plain text  ', undefined)).toBe('plain text')
  })
})

describe('commands', () => {
  it('parses commands and leaves ordinary prose unchanged', () => {
    expect(parseBridgeCommand('/STATUS')).toEqual({ name: 'status', argument: '' })
    expect(parseBridgeCommand('/new explain\nwhy')).toEqual({ name: 'new', argument: 'explain\nwhy' })
    expect(parseBridgeCommand('please /new')).toBeUndefined()
    expect(parseBridgeCommand('')).toBeUndefined()
  })

  it('keeps malformed slash commands out of the agent', () => {
    expect(parseBridgeCommand('/')).toEqual({ name: '', argument: '' })
    expect(parseBridgeCommand('/1new')).toEqual({ name: '1new', argument: '' })
    expect(isKnownCommand('1new')).toBe(false)
    expect(isKnownCommand('stop')).toBe(true)
  })

  it('provides help in both locales', () => {
    expect(describeBridgeCommands('en')).toContain('/status — Show session')
    expect(describeBridgeCommands('zh-CN')).toContain('/stop — 停止当前请求')
  })
})
