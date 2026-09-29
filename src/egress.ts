/**
 * Egress: sends messages back to Feishu through `lark-cli` shortcuts, always
 * as an argv array (never a shell string). Reply anchors the answer to the
 * triggering message; send targets the chat and backs the reply up.
 * @module
 */

import { execFile } from 'node:child_process'
import type { LarkChatId, LarkMessageId } from './brand.ts'

/** One `lark-cli` JSON envelope; `ok` is the CLI's own success flag. */
interface LarkCliEnvelope {
  ok: boolean
  error?: { message?: string }
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
  let envelope: LarkCliEnvelope
  try {
    envelope = JSON.parse(stdout) as LarkCliEnvelope
  } catch {
    throw new Error(`lark-cli ${String(args[0])} ${String(args[1])} printed unparseable output: ${stdout.slice(0, 200)}`)
  }
  if (envelope.ok !== true) {
    throw new Error(`lark-cli ${String(args[0])} ${String(args[1])} reported failure: ${envelope.error?.message ?? 'unknown error'}`)
  }
}

/**
 * Fail loud at load when the configured CLI binary is missing or not runnable.
 * @param command - `lark-cli` executable path.
 * @returns when `--version` exits successfully.
 * @throws with the spawn or exit failure.
 */
export async function assertLarkCliAvailable(command: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(command, ['--version'], { timeout: 10_000 }, error => {
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
 * stripped exactly. Best-effort: callers treat any failure as "name unknown"
 * and fall back to the first-token heuristic.
 * @param command - `lark-cli` executable path.
 * @param identity - `--as` identity for the API call.
 * @returns the trimmed app name, or `undefined` when unavailable.
 */
export async function fetchBotName(command: string, identity: string): Promise<string | undefined> {
  const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(command, ['api', 'GET', '/open-apis/bot/v3/info', '--as', identity], { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, out, stderr) => {
      if (error === null) {
        resolvePromise(out)
        return
      }
      const detail = stderr.trim()
      rejectPromise(new Error(`lark-cli bot info failed: ${error.message}${detail === '' ? '' : ` — ${detail}`}`))
    })
  })
  try {
    const parsed = JSON.parse(stdout) as { code?: number; bot?: { app_name?: unknown } }
    const name = parsed.bot?.app_name
    if (parsed.code !== 0 || typeof name !== 'string' || name.trim() === '') return undefined
    return name.trim()
  } catch {
    // The CLI printed something other than the expected JSON envelope;
    // auto-detection is best-effort, so report the name as unknown.
    return undefined
  }
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
    await runLarkCli(this.command, ['im', '+messages-reply', '--message-id', messageId, '--text', text], this.timeoutMs)
  }

  /** @inheritDoc */
  async send(chatId: LarkChatId, text: string): Promise<void> {
    await runLarkCli(this.command, ['im', '+messages-send', '--chat-id', chatId, '--text', text], this.timeoutMs)
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
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`
}
