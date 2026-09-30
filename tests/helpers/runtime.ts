/** Published harness runtime with a scripted model and in-memory host services. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { vi } from 'vitest'
import { ChatRouter } from '../../src/bridge.ts'
import { resolveLarkConfig, type Config } from '../../src/config.ts'
import type { Egress } from '../../src/egress.ts'
import { toChatId, toEventId, toMessageId, toOpenId } from '../../src/brand.ts'
import type { LarkMessageEvent } from '../../src/types.ts'

export type Script = string | ((options: GenerateOptions) => AsyncIterable<StreamChunk>)

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly scripts: Script[]) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const script = this.scripts.shift()
    if (script === undefined) throw new Error('test model script exhausted')
    yield* typeof script === 'string' ? textResponse(script) : script(options)
  }
}

/** A stream that records progress before waiting for cancellation. */
export function blockedStream() {
  const started = Promise.withResolvers<void>()
  const ended = Promise.withResolvers<void>()
  const script = async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial answer' }
      started.resolve()
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => { reject(new Error('test stream canceled')) }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    } finally { ended.resolve() }
  }
  return { started: started.promise, ended: ended.promise, script }
}

export class RecordingEgress implements Egress {
  readonly calls: Array<{ kind: 'reply' | 'send'; target: string; text: string }> = []
  failReply = false
  onReply: ((text: string) => void) | undefined
  async reply(target: string, text: string): Promise<void> {
    if (this.failReply) throw new Error('reply transport unavailable')
    this.calls.push({ kind: 'reply', target, text })
    this.onReply?.(text)
  }
  async send(target: string, text: string): Promise<void> {
    this.calls.push({ kind: 'send', target, text })
  }
}

export function event(id = 'one', content = 'run tests', chat = 'oc_test'): LarkMessageEvent {
  return {
    eventId: toEventId(`ev_${id}`), messageId: toMessageId(`om_${id}`), chatId: toChatId(chat),
    chatType: 'p2p', messageType: 'text', senderId: toOpenId('ou_owner'), content, createTimeMs: '1',
  }
}

/** Creates only in-memory runtime resources; callers register close immediately. */
export async function runtime(scripts: Script[], config: Config = {}) {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    const model = new ScriptedModel(scripts)
    ctx.llm.registerAdapter(['mock'], model)
    const handles: AgentHandle[] = []
    const agents: Agent[] = []
    const created = vi.fn(async (options: CreateAgentOptions) => {
      const handle = await ctx.agents.create(options)
      handles.push(handle)
      agents.push(handle.agent)
      return handle
    })
    const mount = vi.fn(async () => {})
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'standard' }))
    const workspace = { path: '/workspace', attachSession: vi.fn(async () => {}), detachSession: vi.fn(async () => {}) }
    const logger = { warn: vi.fn(), info: vi.fn() }
    // Only host provisioning is substituted; sessions, inboxes, turns and cancellation use the published runtime.
    const host = {
      agents: { create: created }, agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
      agentPresets: { resolve, mount }, permissionPresets: { resolve: vi.fn(), set: vi.fn() },
      sessionTitle: { rename: vi.fn() }, workspaceRegistry: { create: vi.fn(async () => workspace) }, logger,
    } as unknown as Context
    const egress = new RecordingEgress()
    const router = new ChatRouter(host, resolveLarkConfig({ allowedSenders: ['ou_owner'], workspacePath: '/workspace', ...config }), egress)
    return {
      ctx, host, router, egress, model, agents, handles, created, mount, resolve, workspace, logger,
      async close() { try { await router.dispose() } finally { await ctx.fiber.dispose() } },
    }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}
