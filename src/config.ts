/** Validated deployment settings for the Lark bot bridge. @module */

import { homedir } from 'node:os'
import { isAbsolute, normalize } from 'node:path'

/** Languages supported by bridge commands and diagnostics sent to chats. */
export type Locale = 'zh-CN' | 'en'

/** Loader configuration. At least one allowed sender is required unless access is explicitly open. */
export interface Config {
  /** CLI executable, resolved through PATH when bare. */
  larkCliPath?: string
  /** The receive-message event supports bot identity only. */
  identity?: string
  /** Sender open IDs allowed to drive local sessions. */
  allowedSenders?: string[]
  /** Explicitly allow every sender visible to the bot. */
  allowAllSenders?: boolean
  /** Restrict accepted chat IDs; empty permits any chat for an allowed sender. */
  allowedChats?: string[]
  /** Require an exact leading bot mention in groups, or disable groups. */
  groupPolicy?: 'mentions' | 'disabled'
  /** Language of bridge replies; model answers retain their original language. */
  locale?: Locale
  /** Absolute working directory; a leading ~/ expands to the home directory. */
  workspacePath?: string
  /** Idle lifetime before the next request replaces a session. */
  sessionIdleMinutes?: number
  /** Delay before restarting a consumer that exits after becoming ready. */
  restartDelayMs?: number
  /** Deadline for the consumer's ready marker. */
  ingressReadyTimeoutMs?: number
  /** Deadline for each outbound CLI invocation. */
  egressTimeoutMs?: number
  /** Maximum remembered event IDs across consumer restarts. */
  dedupCapacity?: number
  /** Maximum waiting messages per chat, excluding the running message. */
  maxPendingMessagesPerChat?: number
  /** Maximum chat sessions held by this plugin. */
  maxActiveChats?: number
  /** Maximum Unicode code points in one reply, including its ellipsis. */
  maxReplyChars?: number
  /** Prefix of session titles in the web UI; spaces are preserved. */
  titlePrefix?: string
  /** Agent preset; absence uses the host's configured default. */
  agentPreset?: string
  /** Permission preset; absence preserves host defaults. */
  permissionPreset?: string
  /** Exact bot display name; absence triggers discovery through bot/v3/info. */
  botName?: string
}

/** Fully resolved settings shared by transport and chat routing. */
export interface LarkSettings {
  larkCliPath: string
  identity: 'bot'
  eventKey: 'im.message.receive_v1'
  allowedSenders: readonly string[]
  allowAllSenders: boolean
  allowedChats: readonly string[]
  groupPolicy: 'mentions' | 'disabled'
  locale: Locale
  workspacePath: string
  sessionIdleMs: number
  restartDelayMs: number
  ingressReadyTimeoutMs: number
  egressTimeoutMs: number
  dedupCapacity: number
  maxPendingMessagesPerChat: number
  maxActiveChats: number
  maxReplyChars: number
  titlePrefix: string
  agentPreset: string | undefined
  permissionPreset: string | undefined
  botName: string | undefined
}

/** Validate a nonblank optional string. */
function optionalString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  if (value.trim() === '') throw new Error(`dsh-lark: ${label} must not be blank`)
  return value.trim()
}

/** Validate and deduplicate wire identifiers in an allowlist. */
function allowlist(value: string[] | undefined, prefix: string, label: string): readonly string[] {
  return [...new Set((value ?? []).map(entry => {
    const trimmed = entry.trim()
    if (!trimmed.startsWith(prefix) || trimmed.length === prefix.length || /\s/.test(trimmed)) {
      throw new Error(`dsh-lark: ${label} must contain ${prefix}… identifiers`)
    }
    return trimmed
  }))]
}

/** Validate a deployment integer, bounding values used by Node timers when requested. */
function positiveInt(value: number | undefined, fallback: number, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > max) {
    throw new Error(`dsh-lark: ${label} must be a positive integer no greater than ${String(max)}`)
  }
  return resolved
}

/** Expand a home prefix before checking the configured path. */
function workspacePath(value: string | undefined): string {
  const raw = optionalString(value, 'workspacePath') ?? '~/.dsh/lark/workspace'
  const expanded = raw === '~' || raw.startsWith('~/') ? homedir() + raw.slice(1) : raw
  if (!isAbsolute(expanded)) throw new Error('dsh-lark: workspacePath must be absolute or start with ~/')
  return normalize(expanded)
}

/**
 * Validate configuration and compute defaults before starting a subscription.
 * @param config - Loader-validated settings.
 * @returns Settings with explicit access policy and bounded timers.
 * @throws For invalid values or an unspecified sender policy.
 */
export function resolveLarkConfig(config: Config): LarkSettings {
  const identity = optionalString(config.identity, 'identity') ?? 'bot'
  if (identity !== 'bot') throw new Error('dsh-lark: identity must be bot; im.message.receive_v1 supports bot identity only')
  const allowedSenders = allowlist(config.allowedSenders, 'ou_', 'allowedSenders')
  const allowAllSenders = config.allowAllSenders ?? false
  if (!allowAllSenders && allowedSenders.length === 0) {
    throw new Error('dsh-lark: configure allowedSenders with your open ID, or explicitly set allowAllSenders: true')
  }
  if (allowAllSenders && allowedSenders.length > 0) {
    throw new Error('dsh-lark: choose allowedSenders or allowAllSenders, not both')
  }
  const locale = config.locale ?? 'zh-CN'
  if (locale !== 'zh-CN' && locale !== 'en') throw new Error('dsh-lark: locale must be zh-CN or en')
  const groupPolicy = config.groupPolicy ?? 'mentions'
  if (groupPolicy !== 'mentions' && groupPolicy !== 'disabled') throw new Error('dsh-lark: groupPolicy must be mentions or disabled')
  const sessionIdleMs = (config.sessionIdleMinutes ?? 30) * 60_000
  if (!Number.isFinite(sessionIdleMs) || sessionIdleMs < 1 || sessionIdleMs > Number.MAX_SAFE_INTEGER) {
    throw new Error('dsh-lark: sessionIdleMinutes must describe a finite positive duration of at least one millisecond')
  }
  return {
    larkCliPath: optionalString(config.larkCliPath, 'larkCliPath') ?? 'lark-cli',
    identity,
    eventKey: 'im.message.receive_v1',
    allowedSenders,
    allowAllSenders,
    allowedChats: allowlist(config.allowedChats, 'oc_', 'allowedChats'),
    groupPolicy,
    locale,
    workspacePath: workspacePath(config.workspacePath),
    sessionIdleMs,
    restartDelayMs: positiveInt(config.restartDelayMs, 3_000, 'restartDelayMs', 2_147_483_647),
    ingressReadyTimeoutMs: positiveInt(config.ingressReadyTimeoutMs, 30_000, 'ingressReadyTimeoutMs', 2_147_483_647),
    egressTimeoutMs: positiveInt(config.egressTimeoutMs, 30_000, 'egressTimeoutMs', 2_147_483_647),
    dedupCapacity: positiveInt(config.dedupCapacity, 1_000, 'dedupCapacity'),
    maxPendingMessagesPerChat: positiveInt(config.maxPendingMessagesPerChat, 8, 'maxPendingMessagesPerChat'),
    maxActiveChats: positiveInt(config.maxActiveChats, 32, 'maxActiveChats'),
    maxReplyChars: positiveInt(config.maxReplyChars, 4_000, 'maxReplyChars'),
    titlePrefix: config.titlePrefix ?? '[lark] ',
    agentPreset: optionalString(config.agentPreset, 'agentPreset'),
    permissionPreset: optionalString(config.permissionPreset, 'permissionPreset'),
    botName: optionalString(config.botName, 'botName'),
  }
}
