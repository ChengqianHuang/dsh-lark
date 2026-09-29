/**
 * In-chat bridge commands: messages whose text is a `/name` token control the
 * bridge itself instead of driving an agent turn. Mention prefixes are
 * stripped first, so `@bot /new` in a group and `/new` in a P2P chat behave
 * identically. Unknown commands are rejected with the command list rather
 * than forwarded to the agent.
 * @module
 */

/** One parsed bridge command. */
export interface BridgeCommand {
  /** Command name without the leading slash, lowercased. */
  readonly name: string
  /** Raw remainder after the name; empty when absent. */
  readonly argument: string
}

/** Bridge commands recognized by the router, in help order. */
export const BRIDGE_COMMANDS = ['new', 'stop', 'status', 'help'] as const

/** One-line description per bridge command, in help order. */
const COMMAND_HELP: Readonly<Record<(typeof BRIDGE_COMMANDS)[number], string>> = {
  new: '结束当前会话，下一条消息开始新会话',
  stop: '停止正在运行的回合',
  status: '查看当前会话状态',
  help: '显示可用命令',
}

/**
 * Strip a leading @mention from rendered message text. An exact
 * `@{botName}` prefix is preferred; without a known name the first
 * whitespace-bounded token is removed as a heuristic.
 * @param content - rendered Feishu message text.
 * @param botName - the bot display name, or `undefined` when unknown.
 * @returns the text after the mention, trimmed.
 */
export function stripMention(content: string, botName: string | undefined): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith('@')) return trimmed
  if (botName !== undefined) {
    const withName = `@${botName}`
    if (trimmed.startsWith(withName)) return trimmed.slice(withName.length).trim()
  }
  const tokenEnd = trimmed.search(/\s/)
  if (tokenEnd <= 1) return ''
  return trimmed.slice(tokenEnd + 1).trim()
}

/**
 * Parse one bridge command from prepared message text.
 * @param text - message text with any mention already stripped.
 * @returns the command, or `undefined` when the text is not a command.
 */
export function parseBridgeCommand(text: string): BridgeCommand | undefined {
  const match = /^\/([a-z][a-z0-9]*)(?:\s+([\s\S]+))?$/i.exec(text.trim())
  if (match === null) return undefined
  return { name: match[1]?.toLowerCase() ?? '', argument: match[2] ?? '' }
}

/**
 * Whether a parsed command name is one the router implements.
 * @param name - lowercased command name.
 * @returns `true` for a known bridge command.
 */
export function isKnownCommand(name: string): boolean {
  return (BRIDGE_COMMANDS as readonly string[]).includes(name)
}

/**
 * Render the command list for /help and unknown-command replies.
 * @returns the multi-line help text.
 */
export function describeBridgeCommands(): string {
  const lines = BRIDGE_COMMANDS.map(name => `/${name} — ${COMMAND_HELP[name]}`)
  return ['可用命令：', ...lines].join('\n')
}
