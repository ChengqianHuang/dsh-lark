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

/** Egress invocation wall clock bound. */
const EGRESS_TIMEOUT_MS = 30_000

/** Deterministic Lark bridge over the `lark-cli` subprocess boundary. */
export class LarkService extends Service {
  /** Required services for driving sessions: the same set webhook creation uses. */
  static inject = ['agentDefaultModel', 'agentPresets', 'agents', 'permissionPresets', 'sessionTitle', 'workspaceRegistry']

  /** Schemastery validation for the plugin config; defaults live in the resolver. */
  static Config: z<Config> = z.object({
    larkCliPath: z.string(),
    identity: z.string(),
    allowedSenders: z.array(z.string()),
    allowedChats: z.array(z.string()),
    workspacePath: z.string(),
    sessionIdleMinutes: z.number(),
    restartDelayMs: z.number(),
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

  /**
   * Validate config; the workspace, the CLI preflight, and the ingress start in init.
   * @param ctx - the plugin fiber's context carrying the agent-side services.
   * @param config - loader-validated plugin config.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'lark')
    this.rawConfig = config
  }

  /**
   * Resolve settings, preflight the workspace directory and the CLI binary,
   * start the ingress consumer, and arm the disposal effect. A missing
   * workspace directory is created; a missing CLI fails the plugin load.
   */
  protected async [Service.init](): Promise<void> {
    const settings = resolveLarkConfig(this.rawConfig)
    let botName = settings.botName
    if (botName === undefined) {
      try {
        botName = await fetchBotName(settings.larkCliPath, settings.identity)
      } catch (error: unknown) {
        this.ctx.logger.warn(`dsh-lark: bot name auto-detection failed (mention stripping falls back to the first-token heuristic): ${errorChain(error)}`)
      }
    }
    const effectiveSettings = settings.botName === botName ? settings : { ...settings, botName }
    this.settings = effectiveSettings
    await mkdir(effectiveSettings.workspacePath, { recursive: true })
    await assertLarkCliAvailable(effectiveSettings.larkCliPath)
    const egress = new LarkEgress(effectiveSettings.larkCliPath, EGRESS_TIMEOUT_MS)
    const router = new ChatRouter(this.ctx, effectiveSettings, egress)
    const ingest = new LarkIngest(
      effectiveSettings.larkCliPath,
      ['event', 'consume', effectiveSettings.eventKey, '--as', effectiveSettings.identity],
      {
        logger: this.ctx.logger,
        onEvent: event => {
          if (!shouldAccept(event, effectiveSettings)) return
          this.ctx.logger.info(`dsh-lark: accepted ${event.chatType} message ${event.messageId} from ${event.senderId}`)
          router.handle(event)
        },
        onUnexpectedExit: reason => this.scheduleRestart(reason),
      },
    )
    this.ingest = ingest
    this.router = router
    ingest.start()
    this.ctx.effect(() => () => { this.stop() }, 'dsh-lark: stop ingress and dispose chat sessions')
  }

  /** Report one crashed consumer and restart it after the configured delay. */
  private scheduleRestart(reason: string): void {
    if (this.stopped || this.settings === undefined) return
    this.ctx.logger.warn(`dsh-lark: ingress exited (${reason}); restarting in ${String(this.settings.restartDelayMs)}ms`)
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      if (!this.stopped) this.ingest?.start()
    }, this.settings.restartDelayMs)
  }

  /** Stop the ingress for good and dispose every live chat session. */
  private stop(): void {
    this.stopped = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    void this.ingest?.dispose().then(() => this.router?.dispose())
  }
}

export default LarkService
