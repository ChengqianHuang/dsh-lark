/**
 * `dsh-lark`: the Lark/Feishu bridge plugin. It owns one long-running
 * `lark-cli event consume` child process, routes accepted chat messages into
 * dsh sessions through the core agent registry, and replies with each turn's
 * final assistant text. The plugin is self-contained: disabling or removing
 * it leaves the harness and every other plugin untouched, and no durable
 * state beyond the driven sessions themselves.
 *
 * The Service class is declared in this entry file (the Loader and the config
 * catalog both read it here); the subprocess, routing, and messaging halves
 * live in `src/ingress.ts`, `src/bridge.ts`, and `src/egress.ts`.
 * @module @deepseek-ai/dsh-lark
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Lark bridge service: ingress supervision and chat routing. */
    lark: LarkService
  }
}

// Empty type imports carry the loader Context merges for the injected services.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'

import { mkdir } from 'node:fs/promises'
import { Service, type Context } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { ChatRouter } from './bridge.ts'
import { resolveLarkConfig, type Config } from './config.ts'
import { assertLarkCliAvailable, fetchBotName, LarkEgress } from './egress.ts'
import { shouldAccept } from './filter.ts'
import { LarkIngest } from './ingress.ts'

/** Deterministic Lark bridge over the `lark-cli` subprocess boundary. */
export class LarkService extends Service {
  /** Required services for driving sessions: the same set webhook creation uses. */
  static inject = ['agentDefaultModel', 'agentPresets', 'agents', 'permissionPresets', 'sessionTitle', 'workspaceRegistry']

  /** Schemastery validation for the plugin config; defaults live in the resolver. */
  static Config: z<Config> = z.object({
    larkCliPath: z.string(),
    identity: z.string(),
    locale: z.union(['zh-CN', 'en'] as const),
    groupPolicy: z.union(['mentions', 'disabled'] as const),
    allowAllSenders: z.boolean(),
    allowedSenders: z.array(z.string()),
    allowedChats: z.array(z.string()),
    workspacePath: z.string(),
    sessionIdleMinutes: z.number(),
    restartDelayMs: z.number(),
    ingressReadyTimeoutMs: z.number(),
    egressTimeoutMs: z.number(),
    dedupCapacity: z.number(),
    maxPendingMessagesPerChat: z.number(),
    maxActiveChats: z.number(),
    maxReplyChars: z.number(),
    titlePrefix: z.string(),
    agentPreset: z.string(),
    permissionPreset: z.string(),
    botName: z.string(),
  })

  private readonly rawConfig: Config
  private settings: ReturnType<typeof resolveLarkConfig> | undefined
  private ingest: LarkIngest | undefined
  private router: ChatRouter | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private initialization: Promise<void> | undefined
  private disposal: Promise<void> | undefined

  /**
   * Validate config; the workspace, the CLI preflight, and the ingress start in init.
   * @param ctx - the plugin fiber's context carrying the agent-side services.
   * @param config - loader-validated plugin config.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'lark')
    this.rawConfig = config
  }

  /** Start the CLI transport and wait for a subscribed consumer before activation. */
  protected async [Service.init](): Promise<void> {
    this.initialization = this.initialize()
    this.ctx.effect(() => () => this.stop(), 'dsh-lark: stop ingress and dispose chat sessions')
    await this.initialization
  }

  /** Prepare the workspace and CLI, then acquire the router and subscribed child. */
  private async initialize(): Promise<void> {
    const settings = resolveLarkConfig(this.rawConfig)
    await assertLarkCliAvailable(settings.larkCliPath, settings.egressTimeoutMs)
    if (this.stopped) return
    let botName = settings.botName
    if (botName === undefined) {
      try {
        botName = await fetchBotName(settings.larkCliPath, settings.egressTimeoutMs)
        if (botName === undefined) this.ctx.logger.warn('dsh-lark: bot name unavailable; configure botName for exact mention matching')
      } catch (error: unknown) {
        this.ctx.logger.warn(`dsh-lark: bot name auto-detection failed: ${errorChain(error)}`)
      }
    }
    if (this.stopped) return
    if (settings.groupPolicy === 'mentions' && botName === undefined) {
      throw new Error('dsh-lark: bot name could not be detected; configure botName or set groupPolicy: disabled')
    }
    const effectiveSettings = settings.botName === botName ? settings : { ...settings, botName }
    this.settings = effectiveSettings
    await mkdir(effectiveSettings.workspacePath, { recursive: true })
    if (this.stopped) return
    const egress = new LarkEgress(effectiveSettings.larkCliPath, effectiveSettings.egressTimeoutMs)
    const router = new ChatRouter(this.ctx, effectiveSettings, egress)
    const ingest = new LarkIngest(
      effectiveSettings.larkCliPath,
      ['event', 'consume', effectiveSettings.eventKey, '--as', 'bot'],
      {
        logger: this.ctx.logger,
        onEvent: event => {
          if (this.stopped || !shouldAccept(event, effectiveSettings)) return
          router.handle(event)
        },
        onUnexpectedExit: reason => this.scheduleRestart(reason),
      },
      {
        eventKey: effectiveSettings.eventKey,
        readyTimeoutMs: effectiveSettings.ingressReadyTimeoutMs,
        dedupCapacity: effectiveSettings.dedupCapacity,
      },
    )
    this.ingest = ingest
    this.router = router
    try {
      await ingest.start()
    } catch (error: unknown) {
      await this.closeResources()
      throw error
    }
  }

  /** Report one failed consumer and retry only after that child has closed. */
  private scheduleRestart(reason: string): void {
    if (this.stopped || this.settings === undefined) return
    this.ctx.logger.warn(`dsh-lark: ingress exited (${reason}); restarting in ${String(this.settings.restartDelayMs)}ms`)
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.stopped) return
      void this.ingest?.start().catch((error: unknown) => this.scheduleRestart(errorChain(error)))
    }, this.settings.restartDelayMs)
  }

  /** Close message admission and await both session cancellation and consumer exit. */
  private async closeResources(): Promise<void> {
    const results = await Promise.allSettled([this.router?.dispose(), this.ingest?.dispose()])
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'dsh-lark: resource cleanup failed')
  }

  /** Stop admission synchronously and keep the effect alive until owned work settles. */
  private stop(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.stopped = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    const resources = this.closeResources()
    this.disposal = Promise.all([
      resources,
      // Initialization reports its failure to Cordis; teardown still waits for its subprocesses.
      this.initialization?.catch(() => {}),
    ]).then(() => {})
    return this.disposal
  }
}

export default LarkService
