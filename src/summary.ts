/**
 * Turn outcome extraction from the durable session log. The last assistant
 * text block and the turn-end reason summarize one driven turn for the Feishu
 * reply; the log itself stays the record of truth.
 * @module
 */

import { SessionSeq, type Session, type SessionEvent, type SessionLogOffset } from '@deepseek-ai/dsh-session'

/** Final text and end reason of one owned turn interval. */
export interface TurnOutcome {
  /** Joined text of the last non-empty assistant message; empty when none. */
  text: string
  /** Turn-end reason payload; `undefined` when no turn boundary was observed. */
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/**
 * Aggregate the last assistant text and turn outcome over one owned interval.
 * @param session - the driven agent's session.
 * @param firstSeq - log offset captured before the followup was queued.
 * @returns the outcome facts.
 * @throws when the interval reads past the captured log length.
 */
export function summarizeTurn(session: Session, firstSeq: SessionLogOffset): TurnOutcome {
  let started = false
  let text = ''
  let reason: TurnOutcome['reason']
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) {
      throw new Error(`dsh-lark: cannot read seq ${String(seq)} below captured length ${String(length)}`)
    }
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}
