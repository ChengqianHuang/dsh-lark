/**
 * Wire types for the `lark-cli event consume` NDJSON stream and the `lark`
 * message-source contribution. The event payload is the flat custom schema of
 * `im.message.receive_v1` (no V2 envelope); `content` is pre-rendered by
 * lark-cli, so @mentions appear as plain text.
 * @module
 */

import { toChatId, toEventId, toMessageId, toOpenId, type LarkChatId, type LarkEventId, type LarkMessageId, type LarkOpenId } from './brand.ts'

/** One received Feishu chat message, already narrowed to the fields the bridge uses. */
export interface LarkMessageEvent {
  /** Globally unique event id for redelivery deduplication. */
  readonly eventId: LarkEventId
  /** Received message id (`om_…`); the reply anchor. */
  readonly messageId: LarkMessageId
  /** Chat the message arrived in (`oc_…`). */
  readonly chatId: LarkChatId
  /** P2P chats deliver every message; groups deliver only @bot messages. */
  readonly chatType: 'p2p' | 'group'
  /** Feishu message type; the bridge only forwards `text`. */
  readonly messageType: string
  /** Sender open id (`ou_…`); no display name is carried. */
  readonly senderId: LarkOpenId
  /** Pre-rendered message text; card messages keep raw JSON here. */
  readonly content: string
  /** Message creation time as a millisecond-epoch string. */
  readonly createTimeMs: string
}

/**
 * Narrow one parsed NDJSON line to {@link LarkMessageEvent}.
 * @param raw - the JSON-decoded line from the ingress stream.
 * @returns the event, or `undefined` when the line is not a receive-message event.
 */
export function parseLarkMessageEvent(raw: unknown): LarkMessageEvent | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (record['type'] !== 'im.message.receive_v1') return undefined
  const eventId = record['event_id']
  const messageId = record['message_id']
  const chatId = record['chat_id']
  const chatType = record['chat_type']
  const messageType = record['message_type']
  const senderId = record['sender_id']
  const content = record['content']
  const createTimeMs = record['create_time']
  if (typeof eventId !== 'string' || eventId === ''
    || typeof messageId !== 'string' || messageId === ''
    || typeof chatId !== 'string' || chatId === ''
    || (chatType !== 'p2p' && chatType !== 'group')
    || typeof messageType !== 'string'
    || typeof senderId !== 'string' || senderId === ''
    || typeof content !== 'string'
    || typeof createTimeMs !== 'string') return undefined
  return {
    eventId: toEventId(eventId),
    messageId: toMessageId(messageId),
    chatId: toChatId(chatId),
    chatType,
    messageType,
    senderId: toOpenId(senderId),
    content,
    createTimeMs,
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** User input delivered from one Lark/Feishu chat message. */
    lark: {
      readonly kind: 'lark'
      readonly chatId: LarkChatId
      readonly chatType: 'p2p' | 'group'
      readonly senderId: LarkOpenId
      readonly messageId: LarkMessageId
    }
  }
}
