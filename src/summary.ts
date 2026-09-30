/** Identify a submitted message's turn and read only that turn's logged output. @module */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type Session, type SessionLogOffset, type TurnEndReason } from '@deepseek-ai/dsh-session'

/** A message's settled turn, or a message that never completed a turn. */
export type TurnOutcome =
  | { kind: 'finished'; text: string; reason: TurnEndReason }
  | { kind: 'discarded' }
  | { kind: 'canceled' }

/**
 * Read the last assistant text from one identified turn.
 * @param session - Durable log containing the turn.
 * @param firstSeq - Offset captured before submitting the message.
 * @param turn - Turn identified by the message's inbox claim.
 * @returns Last text message in that turn, or an empty string.
 * @throws If a captured log position cannot be read.
 */
export function summarizeTurn(session: Session, firstSeq: SessionLogOffset, turn: number): string {
  let text = ''
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) throw new Error(`dsh-lark: cannot read session event ${String(seq)}`)
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    const joined = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    // A final response with no text must not reuse a preceding progress message.
    text = joined
  }
  return text
}

/**
 * Submit a follow-up and observe its own claim and turn ending.
 * Cancellation removes this message while queued, or cancels its running turn
 * with other inbox work preserved. No whole-agent idle transition identifies
 * this message's result. All listeners are released on every exit.
 * @param agent - Agent receiving the message.
 * @param message - Identified bridge input.
 * @param signal - Cancellation for this request or plugin shutdown.
 * @returns The message's turn outcome, independent of later turns.
 */
export function runMessageTurn(agent: Agent, message: UserMessage, signal: AbortSignal): Promise<TurnOutcome> {
  if (signal.aborted) return Promise.resolve({ kind: 'canceled' })
  const firstSeq = agent.session.seq
  return new Promise<TurnOutcome>((resolve, reject) => {
    let turn: number | undefined
    let settled = false
    let cancelRequested = false
    const listeners: Array<() => void> = []
    const cleanup = (): void => {
      signal.removeEventListener('abort', abort)
      for (const dispose of listeners.splice(0)) dispose()
    }
    const finish = (outcome: TurnOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }
    const abort = (): void => {
      if (settled || cancelRequested) return
      cancelRequested = true
      try {
        if (turn === undefined) {
          agent.inbox.remove(message.id)
          finish({ kind: 'canceled' })
        } else {
          // The matching turn/end remains the completion signal after cancellation.
          agent.cancel({ kind: 'user' }, { keepInbox: true })
        }
      } catch (error: unknown) {
        settled = true
        cleanup()
        reject(error)
      }
    }
    try {
      listeners.push(agent.ctx.on('agent/inbox/claimed', payload => {
        if (payload.agent.id === agent.id && payload.message.id === message.id) turn = payload.turn
      }))
      listeners.push(agent.ctx.on('agent/inbox/discarded', payload => {
        if (payload.agent.id === agent.id && payload.message.id === message.id) finish({ kind: cancelRequested ? 'canceled' : 'discarded' })
      }))
      listeners.push(agent.ctx.on('session/event', (session, event) => {
        if (session.id !== agent.session.id || event.type !== 'turn/end' || event.data.turn !== turn) return
        try {
          finish(cancelRequested
            ? { kind: 'canceled' }
            : { kind: 'finished', text: summarizeTurn(session, firstSeq, event.data.turn), reason: event.data.reason })
        } catch (error: unknown) {
          settled = true
          cleanup()
          reject(error)
        }
      }))
      signal.addEventListener('abort', abort, { once: true })
      agent.followup(message)
    } catch (error: unknown) {
      settled = true
      cleanup()
      reject(error)
    }
  })
}
