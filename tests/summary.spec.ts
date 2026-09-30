import { onTestFinished, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { runMessageTurn } from '../src/summary.ts'
import { blockedStream, event, runtime } from './helpers/runtime.ts'

it('removes only the owned queued message when another producer owns the active turn', async () => {
  const blocked = blockedStream()
  const h = await runtime([blocked.script])
  onTestFinished(() => h.close())
  const handle = await h.ctx.agents.create({ sessionId: SessionId('owned-queue-test'), agentOptions: { provider: 'mock', model: 'mock' } })
  onTestFinished(() => handle.dispose())
  const agent = handle.agent
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'UI work' }], source: { kind: 'user' } }))
  await blocked.started
  const controller = new AbortController()
  const bridgeMessage = createUserMessage({ content: [{ type: 'text', text: 'bridge work' }], source: { kind: 'user' } })
  const other = createUserMessage({ content: [{ type: 'text', text: 'another producer' }], source: { kind: 'user' } })
  const outcome = runMessageTurn(agent, bridgeMessage, controller.signal)
  agent.followup(other)
  controller.abort()
  expect(await outcome).toEqual({ kind: 'canceled' })
  expect(agent.status).toBe('running')
  expect(agent.inbox.nextTurn.map(message => message.id)).toEqual([other.id])
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
})

it('settles an externally discarded message without waiting for unrelated work', async () => {
  const blocked = blockedStream()
  const h = await runtime([blocked.script])
  onTestFinished(() => h.close())
  const handle = await h.ctx.agents.create({ sessionId: SessionId('owned-queue-test'), agentOptions: { provider: 'mock', model: 'mock' } })
  onTestFinished(() => handle.dispose())
  const agent = handle.agent
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'UI work' }], source: { kind: 'user' } }))
  await blocked.started
  const message = createUserMessage({ content: [{ type: 'text', text: 'pending' }], source: { kind: 'user' } })
  const outcome = runMessageTurn(agent, message, new AbortController().signal)
  agent.inbox.remove(message.id)
  expect(await outcome).toEqual({ kind: 'discarded' })
  expect(agent.status).toBe('running')
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
})

it('records a keyless conversation and the matching chat replies', async () => {
  const h = await runtime(['The workspace is ready.', 'The follow-up is complete.'], { locale: 'en', botName: 'Fixture bot' })
  onTestFinished(() => h.close())
  h.router.handle(event('one', '@Fixture bot Describe this workspace'))
  await h.router.settle()
  h.router.handle(event('two', 'Continue the review'))
  await h.router.settle()
  const recorded = h.agents[0]!.session.snapshotEvents().flatMap<{ type: string; data: unknown }>(entry => {
    switch (entry.type) {
      case 'user/message': return [{ type: entry.type, data: { content: entry.data.content, source: entry.data.source } }]
      case 'assistant/message': return [{ type: entry.type, data: { turn: entry.data.turn, content: entry.data.message.content } }]
      case 'turn/end': return [{ type: entry.type, data: entry.data }]
      default: return []
    }
  })
  expect({ recorded, replies: h.egress.calls }).toMatchSnapshot()
})
