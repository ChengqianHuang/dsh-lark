/**
 * Egress: sends messages back to Feishu through `lark-cli` shortcuts, always
 * as an argv array (never a shell string). Reply anchors the answer to the
 * triggering message; send targets the chat and backs the reply up.
 * @module
 */

import { execFile } from 'node:child_process'
import type { LarkChatId, LarkMessageId } from './brand.ts'

/** Narrow a process JSON value to a non-array record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Run one `lark-cli` invocation and require a successful JSON envelope. */
async function runLarkCli(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, out, stderr) => {
      if (error === null) {
        resolvePromise(out)
        return
      }
      const detail = stderr.trim()
      rejectPromise(new Error(`lark-cli ${String(args[0])} ${String(args[1])} failed: ${error.message}${detail === '' ? '' : ` — ${detail}`}`))
    })
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`lark-cli ${String(args[0])} ${String(args[1])} printed unparseable output: ${stdout.slice(0, 200)}`)
  }
  const envelope = asRecord(parsed)
  if (envelope?.['ok'] !== true) {
    const message = asRecord(envelope?.['error'])?.['message']
    throw new Error(`lark-cli ${String(args[0])} ${String(args[1])} reported failure: ${typeof message === 'string' ? message : 'missing successful response envelope'}`)
  }
}

/**
 * Fail loud at load when the configured CLI binary is missing or not runnable.
 * @param command - `lark-cli` executable path.
 * @param timeoutMs - maximum wait for the CLI process.
 * @returns when `--version` exits successfully.
 * @throws with the spawn or exit failure.
 */
export async function assertLarkCliAvailable(command: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(command, ['--version'], { timeout: timeoutMs }, error => {
      if (error === null) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(`dsh-lark: ${command} is not runnable: ${error.message}`))
    })
  })
}

/**
 * Detect the bot's own display name so rendered `@{name}` prefixes can be
 * stripped exactly. The service requires a name when group handling is enabled.
 * @param command - `lark-cli` executable path.
 * @param timeoutMs - maximum wait for the CLI process.
 * @returns the trimmed app name, or `undefined` when unavailable.
 */
export async function fetchBotName(command: string, timeoutMs: number): Promise<string | undefined> {
  const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(command, ['api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot'], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, out, stderr) => {
      if (error === null) {
        resolvePromise(out)
        return
      }
      const detail = stderr.trim()
      rejectPromise(new Error(`lark-cli bot info failed: ${error.message}${detail === '' ? '' : ` — ${detail}`}`))
    })
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    // Bot-name lookup is optional; non-JSON output cannot supply a display name.
    return undefined
  }
  const result = asRecord(parsed)
  const name = asRecord(result?.['bot'])?.['app_name']
  if (result?.['code'] !== 0 || typeof name !== 'string' || name.trim() === '') return undefined
  return name.trim()
}

/** Outbound Feishu messaging used by the bridge. */
export interface Egress {
  /** Reply to the exact triggering message. */
  reply(messageId: LarkMessageId, text: string): Promise<void>
  /** Send to the chat without anchoring to a message. */
  send(chatId: LarkChatId, text: string): Promise<void>
}

/** Real {@link Egress} backed by the `lark-cli` process. */
export class LarkEgress implements Egress {
  /**
   * Store the launch parameters.
   * @param command - `lark-cli` executable path.
   * @param timeoutMs - per-invocation wall clock bound.
   */
  constructor(private readonly command: string, private readonly timeoutMs: number) {}

  /** @inheritDoc */
  async reply(messageId: LarkMessageId, text: string): Promise<void> {
    await runLarkCli(this.command, ['im', '+messages-reply', '--as', 'bot', '--message-id', messageId, '--text', text], this.timeoutMs)
  }

  /** @inheritDoc */
  async send(chatId: LarkChatId, text: string): Promise<void> {
    await runLarkCli(this.command, ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--text', text], this.timeoutMs)
  }
}

/**
 * Bound one reply to the configured length so Feishu-length limits cannot
 * reject the whole message.
 * @param text - reply text of any length.
 * @param maxChars - inclusive character bound.
 * @returns the original text, or the head plus an ellipsis.
 */
export function truncateReply(text: string, maxChars: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text
  return `${characters.slice(0, maxChars - 1).join('')}…`
}
