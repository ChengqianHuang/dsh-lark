/** Sender, chat, and explicit group-mention admission policy. @module */

import type { LarkSettings } from './config.ts'
import { hasBotMention } from './command.ts'
import type { LarkMessageEvent } from './types.ts'

/**
 * Check whether a wire message may control a local session.
 * @param event - Validated received message.
 * @param settings - Resolved access policy and verified bot name.
 * @returns True for admitted text messages only.
 */
export function shouldAccept(event: LarkMessageEvent, settings: LarkSettings): boolean {
  if (event.messageType !== 'text' || event.content.trim() === '') return false
  if (!settings.allowAllSenders && !settings.allowedSenders.includes(event.senderId)) return false
  if (settings.allowedChats.length > 0 && !settings.allowedChats.includes(event.chatId)) return false
  if (event.chatType === 'group') return settings.groupPolicy === 'mentions' && hasBotMention(event.content, settings.botName)
  return true
}
