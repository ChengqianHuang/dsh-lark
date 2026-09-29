/**
 * Plugin config resolution for `dsh-lark`. Every deployment-varying choice is
 * a validated config field; the resolve step computes defaults and fails loud
 * on invalid values. The listened event key stays a fixed protocol constant.
 * @module
 */

import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

/** Loader-facing plugin config; every field is optional with a default. */
export interface Config {
  /** `lark-cli` executable; resolved through PATH when bare. */
  larkCliPath?: string
  /** Identity for `event consume` (`bot` or `user`); `bot` needs no login. */
  identity?: string
  /** Sender open_id allowlist; empty admits every sender the bot can hear. */
  allowedSenders?: string[]
  /** Chat id allowlist; empty admits every chat the bot is in. */
  allowedChats?: string[]
  /** Absolute workspace directory the driven sessions run in. */
  workspacePath?: string
  /** Chat idle minutes after which the next message starts a fresh session. */
  sessionIdleMinutes?: number
  /** Delay before restarting a crashed ingress consumer. */
  restartDelayMs?: number
  /** Reply length bound; longer answers truncate with an ellipsis. */
  maxReplyChars?: number
  /** Session title prefix shown in the web UI. */
  titlePrefix?: string
  /** Optional agent preset mounted into every driven session. */
  agentPreset?: string
  /** Optional permission preset applied to every driven session. */
  permissionPreset?: string
  /** Bot display name for exact @mention stripping; auto-detected when absent. */
  botName?: string
}

/** Resolved deployment settings; defaults were computed once at resolve. */
export interface LarkSettings {
  larkCliPath: string
  identity: string
  /** Fixed ingress protocol key; not configurable. */
  eventKey: 'im.message.receive_v1'
  allowedSenders: readonly string[]
  allowedChats: readonly string[]
  workspacePath: string
  sessionIdleMs: number
  restartDelayMs: number
  maxReplyChars: number
  titlePrefix: string
  agentPreset: string | undefined
  permissionPreset: string | undefined
  botName: string | undefined
}

/** Validate one optional non-empty string, returning the default when absent. */
function optionalString(value: string | undefined, fallback: string, label: string): string {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`dsh-lark: ${label} must not be blank`)
  return trimmed
}

/** Validate one optional preset name, keeping absence as `undefined`. */
function optionalPreset(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`dsh-lark: ${label} must not be blank when set`)
  return trimmed
}

/** Validate one optional allowlist; entries must be non-empty after trim. */
function allowlist(value: string[] | undefined, label: string): readonly string[] {
  if (value === undefined) return []
  return value.map(entry => {
    const trimmed = entry.trim()
    if (trimmed === '') throw new Error(`dsh-lark: ${label} must not contain blank entries`)
    return trimmed
  })
}

/** Validate one optional positive integer. */
function positiveInt(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`dsh-lark: ${label} must be a positive integer, got ${String(value)}`)
  }
  return value
}

/** Validate one optional positive finite number; fractional values are allowed. */
function positiveNumber(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`dsh-lark: ${label} must be a positive finite number, got ${String(value)}`)
  }
  return value
}

/** Expand a leading `~` to the home directory and require an absolute path. */
function resolveWorkspacePath(value: string | undefined): string {
  const raw = value === undefined ? '~/.dsh/lark/workspace' : value.trim()
  if (raw === '') throw new Error('dsh-lark: workspacePath must not be blank')
  const expanded = raw === '~' || raw.startsWith('~/')
    ? homedir() + raw.slice(1)
    : raw
  const absolute = resolve(expanded)
  if (!isAbsolute(absolute)) throw new Error(`dsh-lark: workspacePath must be absolute, got ${JSON.stringify(value)}`)
  return absolute
}

/**
 * Validate the loader config and compute defaults.
 * @param config - loader-validated plugin config.
 * @returns the resolved settings used by the service.
 * @throws on blank strings, non-positive numbers, or a relative workspace path.
 */
export function resolveLarkConfig(config: Config): LarkSettings {
  const identity = optionalString(config.identity, 'bot', 'identity')
  if (identity !== 'bot' && identity !== 'user' && identity !== 'auto') {
    throw new Error(`dsh-lark: identity must be bot, user, or auto, got ${JSON.stringify(identity)}`)
  }
  return {
    larkCliPath: optionalString(config.larkCliPath, 'lark-cli', 'larkCliPath'),
    identity,
    eventKey: 'im.message.receive_v1',
    allowedSenders: allowlist(config.allowedSenders, 'allowedSenders'),
    allowedChats: allowlist(config.allowedChats, 'allowedChats'),
    workspacePath: resolveWorkspacePath(config.workspacePath),
    sessionIdleMs: positiveNumber(config.sessionIdleMinutes, 30, 'sessionIdleMinutes') * 60_000,
    restartDelayMs: positiveInt(config.restartDelayMs, 3_000, 'restartDelayMs'),
    maxReplyChars: positiveInt(config.maxReplyChars, 4_000, 'maxReplyChars'),
    titlePrefix: optionalString(config.titlePrefix, '[lark] ', 'titlePrefix'),
    agentPreset: optionalPreset(config.agentPreset, 'agentPreset'),
    permissionPreset: optionalPreset(config.permissionPreset, 'permissionPreset'),
    botName: optionalPreset(config.botName, 'botName'),
  }
}
