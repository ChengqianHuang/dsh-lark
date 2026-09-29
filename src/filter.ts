/**
 * Ingress acceptance policy. P2P messages are commands; group messages count
 * only when addressed to the bot (`@` first in the rendered text), because
 * Feishu already restricts group delivery to @bot messages. Allowlists further
 * narrow senders and chats; empty allowlists admit everything the bot hears.
 * @module
 */

import type { LarkSettings } from './config.ts'
import type { LarkMessageEvent } from './types.ts'

/**
 * Decide whether one received Feishu message should drive a session.
 * @param event - the received message event.
 * @param settings - resolved deployment settings carrying the allowlists.
 * @returns `true` when the message is an accepted command.
 */
export function shouldAccept(event: LarkMessageEvent, settings: LarkSettings): boolean {
  if (event.messageType !== 'text') return false
  if (settings.allowedChats.length > 0 && !settings.allowedChats.includes(event.chatId)) return false
  if (settings.allowedSenders.length > 0 && !settings.allowedSenders.includes(event.senderId)) return false
  if (event.chatType === 'group' && !event.content.trimStart().startsWith('@')) return false
  return true
}
