/**
 * One supervised `lark-cli event consume` child. Readiness comes from stderr;
 * closing its piped stdin requests graceful server-side unsubscribe.
 * @module
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseLarkMessageEvent, type LarkMessageEvent } from './types.ts'

/** Prefix of the stderr line that marks a ready consumer. */
export const READY_MARKER_PREFIX = '[event] ready event_key='

/** Host callbacks for accepted events and consumer failures. */
export interface LarkIngestHost {
  /** Accepted, deduplicated receive-message events in arrival order. */
  onEvent(event: LarkMessageEvent): void
  /** A ready consumer exited while the bridge was still accepting messages. */
  onUnexpectedExit(reason: string): void
  /** Diagnostics from the consumer and event dispatcher. */
  logger: { info(message: string): void; warn(message: string): void }
}

/** Resolved limits and protocol selection for a consumer. */
export interface LarkIngestOptions {
  /** Event key required in the ready marker. */
  eventKey: 'im.message.receive_v1'
  /** Maximum wait for the consumer's ready marker. */
  readyTimeoutMs: number
  /** Maximum retained event ids across consumer restarts. */
  dedupCapacity: number
}

/** One child generation and its owned completion signals. */
interface ConsumerRun {
  child: ReturnType<typeof spawn>
  closed: Promise<void>
  rejectReady(error: Error): void
  ready: boolean
  closing: boolean
}

/** A restartable consumer whose disposal waits for the child and pipes to close. */
export class LarkIngest {
  private run: ConsumerRun | undefined
  private disposed = false
  private disposal: Promise<void> | undefined
  private readonly seenEvents = new Set<string>()

  /**
   * Store resolved launch parameters without starting a subprocess.
   * @param command - `lark-cli` executable path.
   * @param args - full argv, including exactly one event key.
   * @param host - event, exit, and diagnostic callbacks.
   * @param options - resolved readiness and deduplication limits.
   */
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly host: LarkIngestHost,
    private readonly options: LarkIngestOptions,
  ) {}

  /**
   * Start one consumer and wait for its exact ready marker.
   * @returns readiness, or a rejection after startup failure and child cleanup.
   * @throws if already running or permanently disposed.
   */
  start(): Promise<void> {
    if (this.disposed) throw new Error('dsh-lark: ingest is disposed and cannot restart')
    if (this.run !== undefined) throw new Error('dsh-lark: ingest is already running')
    const child = spawn(this.command, [...this.args], { stdio: ['pipe', 'pipe', 'pipe'] })
    const readiness = Promise.withResolvers<void>()
    const completion = Promise.withResolvers<void>()
    const run: ConsumerRun = {
      child,
      closed: completion.promise,
      rejectReady: readiness.reject,
      ready: false,
      closing: false,
    }
    this.run = run
    let failure: string | undefined
    let lastDiagnostic = ''
    const stdout = createInterface(child.stdout)
    stdout.pause()
    const stderr = createInterface(child.stderr)
    const timer = setTimeout(() => {
      failure = `ready marker was not received within ${String(this.options.readyTimeoutMs)}ms`
      readiness.reject(new Error(`dsh-lark: ${failure}`))
      this.closeRun(run)
    }, this.options.readyTimeoutMs)

    child.stdin.on('error', error => {
      if (!run.closing) this.host.logger.warn(`dsh-lark: consumer stdin failed: ${String(error)}`)
    })
    child.once('error', error => {
      failure = `spawn failed: ${String(error)}`
      readiness.reject(new Error(`dsh-lark: ${failure}`))
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      stdout.close()
      stderr.close()
      this.run = undefined
      completion.resolve()
      const reason = failure ?? `${run.ready ? 'consumer exited' : 'exited before ready marker'} (code=${String(code)} signal=${String(signal)})${lastDiagnostic === '' ? '' : `: ${lastDiagnostic}`}`
      if (!run.ready) readiness.reject(new Error(`dsh-lark: ${reason}`))
      if (!this.disposed && run.ready && !run.closing) {
        try {
          this.host.onUnexpectedExit(reason)
        } catch (error: unknown) {
          this.host.logger.warn(`dsh-lark: exit callback failed: ${String(error)}`)
        }
      }
    })
    stderr.on('line', (line: string) => {
      if (this.disposed || run.closing) return
      const trimmed = line.trim()
      if (trimmed === '') return
      if (!run.ready && trimmed === `${READY_MARKER_PREFIX}${this.options.eventKey}`) {
        run.ready = true
        clearTimeout(timer)
        this.host.logger.info(`dsh-lark: ingress ready (${this.options.eventKey})`)
        readiness.resolve()
        stdout.resume()
        return
      }
      lastDiagnostic = trimmed.slice(0, 1_024)
      this.host.logger.info(`dsh-lark: ingest: ${lastDiagnostic}`)
    })
    stdout.on('line', (line: string) => {
      if (!this.disposed && !run.closing && run.ready) this.onEventLine(line)
    })
    return readiness.promise.catch(async (error: unknown) => {
      clearTimeout(timer)
      this.closeRun(run)
      await run.closed
      throw error
    })
  }

  /**
   * Close admission, request graceful unsubscribe with stdin EOF, and wait for exit.
   * @returns the shared completion promise, including when called repeatedly.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    const run = this.run
    if (run !== undefined) {
      run.rejectReady(new Error('dsh-lark: ingest disposed before readiness'))
      this.closeRun(run)
    }
    // TODO: escalate to SIGKILL after a grace period when the child ignores
    // stdin EOF; an unresponsive consumer currently delays teardown.
    this.disposal = run?.closed ?? Promise.resolve()
    return this.disposal
  }

  /** Ask this generation to unsubscribe; stdin remains open until this call. */
  private closeRun(run: ConsumerRun): void {
    if (run.closing) return
    run.closing = true
    run.child.stdin?.end()
  }

  /** Validate one NDJSON event and contain consumer callback failures. */
  private onEventLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (error: unknown) {
      this.host.logger.warn(`dsh-lark: ingest skipped an unparseable line (${String(error)})`)
      return
    }
    const event = parseLarkMessageEvent(parsed)
    if (event === undefined) {
      this.host.logger.warn('dsh-lark: ingest skipped a line that is not a receive-message event')
      return
    }
    if (this.seenEvents.has(event.eventId)) return
    this.seenEvents.add(event.eventId)
    if (this.seenEvents.size > this.options.dedupCapacity) {
      const oldest = this.seenEvents.values().next().value
      if (oldest !== undefined) this.seenEvents.delete(oldest)
    }
    try {
      this.host.onEvent(event)
    } catch (error: unknown) {
      this.host.logger.warn(`dsh-lark: event callback failed: ${String(error)}`)
    }
  }
}
