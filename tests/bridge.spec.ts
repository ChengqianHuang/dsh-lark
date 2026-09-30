import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { copy } from '../src/i18n.ts'
import { blockedStream, event, runtime } from './helpers/runtime.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })
async function setup(...args: Parameters<typeof runtime>) {
  const h = await runtime(...args)
  cleanups.push(() => h.close())
  return h
}

describe('chat sessions through the published agent runtime', () => {
  it('mounts the default preset, records source metadata, and reuses the session', async () => {
    const h = await setup(['first', 'second'], { botName: 'My bot' })
    h.router.handle(event('one', '@My bot run tests'))
    await h.router.settle()
    h.router.handle(event('two', 'continue'))
    await h.router.settle()
    expect(h.created).toHaveBeenCalledTimes(1)
    expect(h.resolve).toHaveBeenCalledWith(undefined)
    expect(h.mount).toHaveBeenCalledWith(expect.anything(), 'standard')
    const input = h.agents[0]?.session.snapshotEvents().find(e => e.type === 'user/message')
    expect(input?.data).toMatchObject({ content: [{ type: 'text', text: 'run tests' }], source: { kind: 'lark', messageId: 'om_one', chatId: 'oc_test', senderId: 'ou_owner' } })
    expect(h.egress.calls.map(call => call.text)).toEqual(['first', 'second'])
  })

  it('replies with the owned turn while a later UI turn is still running', async () => {
    const foreign = blockedStream()
    const h = await setup(['lark answer', foreign.script])
    const replied = Promise.withResolvers<void>()
    h.egress.onReply = text => { if (text === 'lark answer') replied.resolve() }
    const off = h.ctx.on('agent/turn-stopping', ({ agent }) => {
      off()
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'private UI request' }], source: { kind: 'user' } }))
    })
    h.router.handle(event())
    await foreign.started
    await replied.promise
    expect(h.egress.calls).toEqual([{ kind: 'reply', target: 'om_one', text: 'lark answer' }])
    expect(h.agents[0]?.status).toBe('running')
    h.agents[0]?.cancel({ kind: 'user' })
    await h.router.settle()
  })

  it('keeps /status responsive and reports cancellation instead of partial output', async () => {
    const blocked = blockedStream()
    const h = await setup([blocked.script], { locale: 'en' })
    h.router.handle(event())
    await blocked.started
    const status = Promise.withResolvers<void>()
    h.egress.onReply = text => { if (text.includes('Status: running')) status.resolve() }
    h.router.handle(event('status', '/status'))
    await status.promise
    h.router.handle(event('stop', '/stop'))
    await h.router.settle()
    await blocked.ended
    expect(h.egress.calls.find(call => call.target === 'om_one')?.text).toBe(copy.en.stopped)
    expect(h.egress.calls.every(call => !call.text.includes('partial answer'))).toBe(true)
  })

  it('bounds its queue and /stop clears messages that have not entered the agent', async () => {
    const blocked = blockedStream()
    const h = await setup([blocked.script], { locale: 'en', maxPendingMessagesPerChat: 1 })
    h.router.handle(event())
    await blocked.started
    h.router.handle(event('two', 'next'))
    h.router.handle(event('three', 'overflow'))
    h.router.handle(event('stop', '/stop'))
    await h.router.settle()
    expect(h.model.requests).toHaveLength(1)
    expect(h.egress.calls.find(call => call.target === 'om_three')?.text).toContain('queue is full')
    expect(h.egress.calls.find(call => call.target === 'om_stop')?.text).toContain('Cleared 1')
  })

  it('resets immediately and gives following work a fresh session', async () => {
    const blocked = blockedStream()
    const h = await setup([blocked.script, 'fresh'], { locale: 'en' })
    h.router.handle(event())
    await blocked.started
    h.router.handle(event('oldqueue', 'discard this'))
    h.router.handle(event('reset', '/new'))
    h.router.handle(event('fresh', 'new task'))
    await h.router.settle()
    expect(h.created).toHaveBeenCalledTimes(2)
    expect(h.model.requests).toHaveLength(2)
    expect(h.egress.calls.findLast(call => call.target === 'om_fresh')?.text).toBe('fresh')
  })

  it('closes admission, cancels model work and suppresses late replies during unload', async () => {
    const blocked = blockedStream()
    const h = await setup([blocked.script])
    h.router.handle(event())
    await blocked.started
    const first = h.router.dispose()
    expect(h.router.dispose()).toBe(first)
    h.router.handle(event('late', 'must not run'))
    await first
    await blocked.ended
    expect(h.egress.calls).toEqual([])
    expect(h.ctx.agents.get(h.agents[0]!.id)).toBeUndefined()
  })

  it('does not expose internal errors and falls back when anchored replies fail', async () => {
    const h = await setup([async function* () { throw new Error('/private/local/path: credential missing') }], { locale: 'en' })
    h.egress.failReply = true
    h.router.handle(event())
    await h.router.settle()
    expect(h.egress.calls).toEqual([{ kind: 'send', target: 'oc_test', text: copy.en.failed }])
    expect(h.logger.warn).toHaveBeenCalled()
  })

  it('expires idle sessions using the configured clock interval', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const h = await setup(['one', 'two'], { sessionIdleMinutes: 1 })
    h.router.handle(event())
    await h.router.settle()
    clock.mockReturnValue(61_001)
    h.router.handle(event('two', 'again'))
    await h.router.settle()
    expect(h.created).toHaveBeenCalledTimes(2)
  })

  it('limits active chats and allows a new chat after /new releases an old one', async () => {
    const h = await setup(['one', 'two'], { maxActiveChats: 1, locale: 'en' })
    h.router.handle(event())
    await h.router.settle()
    h.router.handle(event('other', 'hello', 'oc_other'))
    await h.router.settle()
    expect(h.egress.calls.at(-1)?.text).toContain('active chat limit')
    h.router.handle(event('reset', '/new'))
    await h.router.settle()
    h.router.handle(event('other2', 'hello', 'oc_other'))
    await h.router.settle()
    expect(h.created).toHaveBeenCalledTimes(2)
  })

  it('answers help, unknown commands and argument errors without creating sessions', async () => {
    const h = await setup([], { locale: 'en' })
    for (const [id, text] of [['help', '/help'], ['unknown', '/whatever'], ['args', '/new now'], ['malformed', '/'], ['status', '/status']] as const) h.router.handle(event(id, text))
    await h.router.settle()
    expect(h.created).not.toHaveBeenCalled()
    expect(h.egress.calls.map(call => call.text)).toMatchSnapshot()
  })
})
