/** Parsing of bot mentions and bridge commands. @module */

import type { Locale } from './config.ts'
import { copy } from './i18n.ts'

/** A slash command and its optional argument. */
export interface BridgeCommand {
  readonly name: string
  readonly argument: string
}

/** Supported commands in help order. */
export const BRIDGE_COMMANDS = ['new', 'stop', 'status', 'help'] as const

/**
 * Match the exact bot mention at the start of a rendered message.
 * @param content - Text rendered by lark-cli.
 * @param botName - Verified display name, including any spaces.
 * @returns Whether the name is followed by whitespace or the end of text.
 */
export function hasBotMention(content: string, botName: string | undefined): boolean {
  if (botName === undefined) return false
  const text = content.trimStart()
  const prefix = `@${botName}`
  return text.startsWith(prefix) && (text.length === prefix.length || /\s/.test(text.charAt(prefix.length)))
}

/**
 * Remove only a verified leading bot mention; preserve other @ text.
 * @param content - Rendered message text.
 * @param botName - Verified bot display name, if available.
 * @returns Trimmed message text.
 */
export function stripMention(content: string, botName: string | undefined): string {
  const text = content.trim()
  return hasBotMention(text, botName) ? text.slice(`@${botName}`.length).trim() : text
}

/**
 * Parse slash-prefixed input so unknown commands cannot trigger agent work.
 * @param text - Text after optional bot mention removal.
 * @returns Command token and argument, or undefined for ordinary text.
 */
export function parseBridgeCommand(text: string): BridgeCommand | undefined {
  const match = /^\/([^\s]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match === null ? undefined : { name: (match[1] ?? '').toLowerCase(), argument: match[2] ?? '' }
}

/**
 * Check whether the command is supported.
 * @param name - Lowercase command name.
 * @returns True for one of the four bridge commands.
 */
export function isKnownCommand(name: string): name is (typeof BRIDGE_COMMANDS)[number] {
  return (BRIDGE_COMMANDS as readonly string[]).includes(name)
}

/**
 * Render localized command help.
 * @param locale - Language of bridge replies.
 * @returns Help text ready for a chat reply.
 */
export function describeBridgeCommands(locale: Locale = 'zh-CN'): string {
  return copy[locale].help
}
