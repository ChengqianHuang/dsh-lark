/**
 * Opaque Lark/Feishu wire identifiers crossing the `lark-cli` subprocess
 * boundary. Values arrive from Feishu events and return in CLI argv, so they
 * stay branded instead of bare strings.
 * @module
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Feishu chat identifier (`oc_…`), P2P or group. */
export type LarkChatId = Branded<'LarkChatId'>

/** Feishu sender open identifier (`ou_…`). */
export type LarkOpenId = Branded<'LarkOpenId'>

/** Feishu message identifier (`om_…`). */
export type LarkMessageId = Branded<'LarkMessageId'>

/** Feishu event identifier; globally unique and safe for redelivery deduplication. */
export type LarkEventId = Branded<'LarkEventId'>

/**
 * Apply the {@link LarkChatId} brand to a validated wire value.
 * @param value - chat id from a Feishu event or profile config.
 * @returns the same string carrying the chat-id brand.
 */
export function toChatId(value: string): LarkChatId {
  return brandString<LarkChatId>(value)
}

/**
 * Apply the {@link LarkOpenId} brand to a validated wire value.
 * @param value - sender open id from a Feishu event or profile config.
 * @returns the same string carrying the open-id brand.
 */
export function toOpenId(value: string): LarkOpenId {
  return brandString<LarkOpenId>(value)
}

/**
 * Apply the {@link LarkMessageId} brand to a validated wire value.
 * @param value - message id from a Feishu event.
 * @returns the same string carrying the message-id brand.
 */
export function toMessageId(value: string): LarkMessageId {
  return brandString<LarkMessageId>(value)
}

/**
 * Apply the {@link LarkEventId} brand to a validated wire value.
 * @param value - event id from a Feishu event.
 * @returns the same string carrying the event-id brand.
 */
export function toEventId(value: string): LarkEventId {
  return brandString<LarkEventId>(value)
}
