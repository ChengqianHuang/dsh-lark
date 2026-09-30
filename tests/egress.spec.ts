import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { assertLarkCliAvailable, fetchBotName, LarkEgress, truncateReply } from '../src/egress.ts'
import { toChatId, toMessageId } from '../src/brand.ts'
import { fakeCli } from './helpers/fake-cli.ts'

describe.skipIf(process.platform === 'win32')('CLI egress on supported POSIX hosts', () => {
  it('passes exact text as an argument and explicitly uses bot identity', async () => {
    const { command } = await fakeCli()
    const egress = new LarkEgress(command, 5_000)
    const text = 'literal $(touch /tmp/not-created) `quotes`\n中文 🐱'
    await egress.reply(toMessageId('om_a'), text)
    await egress.send(toChatId('oc_a'), text)
    const calls = (await readFile(`${command}.calls`, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(calls).toEqual([
      ['im', '+messages-reply', '--as', 'bot', '--message-id', 'om_a', '--text', text],
      ['im', '+messages-send', '--as', 'bot', '--chat-id', 'oc_a', '--text', text],
    ])
  })

  it.each(['null', '[]', 'false', '{"ok":false,"error":{"message":"rejected"}}', 'not json'])('rejects malformed or failed output %s', async rawOutput => {
    const { command } = await fakeCli({ rawOutput })
    await expect(new LarkEgress(command, 5_000).reply(toMessageId('om_a'), 'hello')).rejects.toThrow(/reported failure|unparseable/)
  })

  it('reports process failures and detects the bot through the documented raw API response', async () => {
    const { command } = await fakeCli({ failure: true })
    await assertLarkCliAvailable(command, 5_000)
    expect(await fetchBotName(command, 5_000)).toBe('Fixture bot')
    await expect(new LarkEgress(command, 5_000).send(toChatId('oc_a'), 'hello')).rejects.toThrow('fixture request failed')
  })

  it('does not guess a bot name from unrelated JSON', async () => {
    const { command } = await fakeCli({ botInfo: { ok: true, data: { app_name: 'wrong place' } } })
    expect(await fetchBotName(command, 5_000)).toBeUndefined()
  })
})

it('truncates by Unicode code point including a one-character bound', () => {
  expect(truncateReply('🐱你好', 2)).toBe('🐱…')
  expect(truncateReply('abc', 1)).toBe('…')
  expect(truncateReply('🐱你好', 3)).toBe('🐱你好')
})
