/**
 * Ingress: owns one `lark-cli event consume` child process. The child prints
 * events to stdout as NDJSON and follows the lark-cli subprocess contract: a
 * `[event] ready event_key=…` marker on stderr gates stdout reading, stdin
 * must never EOF while running, graceful shutdown is SIGTERM (never SIGKILL,
 * which leaks server-side subscriptions), and one process listens to exactly
 * one event key.
 * @module
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseLarkMessageEvent, type LarkMessageEvent } from './types.ts'

/** Prefix of the stderr line that marks a ready consumer. */
export const READY_MARKER_PREFIX = '[event] ready event_key='

/** Bounded redelivery-deduplication memory before the oldest ids are dropped. */
const DEDUP_CAPACITY = 1_000

/** Drop a whole batch from the dedup set once capacity overflows. */
const DEDUP_DROP_BATCH = 200

/** Host callbacks the ingest process drives. */
export interface LarkIngestHost {
  /** Accepted, deduplicated receive-message events in arrival order. */
  onEvent(event: LarkMessageEvent): void
  /** The consumer exited on its own (crash or protocol failure) while not disposed. */
  onUnexpectedExit(reason: string): void
  /** Diagnostic sink for protocol lines and skipped payloads. */
  logger: { info(message: string): void; warn(message: string): void }
}

/**
 * Spawn, supervise, and gracefully stop one bounded consumer process. The
 * caller owns restart policy: unexpected exits are reported, and a healthy
 * restart is a fresh {@link LarkIngest.start} on the same instance.
 */
export class LarkIngest {
  private child: ReturnType<typeof spawn> | undefined
  private disposed = false
  private ready = false
  private reported = false
  private readonly pendingLines: string[] = []
  private readonly seenEvents = new Set<string>()
  private readonly seenOrder: string[] = []

  /**
   * Store the fixed spawn parameters; nothing runs until {@link start}.
   * @param command - `lark-cli` executable path.
   * @param args - full argv, including the single event key.
   * @param host - event and exit callbacks.
   */
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly host: LarkIngestHost,
  ) {}

  /** Spawn the consumer; a previous instance must have exited or been disposed. */
  start(): void {
    if (this.disposed) throw new Error('dsh-lark: ingest is disposed and cannot restart')
    if (this.child !== undefined) throw new Error('dsh-lark: ingest is already running')
    this.ready = false
    this.reported = false
    const child = spawn(this.command, [...this.args], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    // The piped stdin is never written or closed, so it never EOFs — exactly
    // the lark-cli contract for an unbounded subscriber.
    child.on('error', error => {
      this.child = undefined
      if (this.disposed || this.reported) return
      this.reported = true
      this.host.onUnexpectedExit(`spawn failed: ${String(error)}`)
    })
    child.on('exit', (code, signal) => {
      this.child = undefined
      if (this.disposed || this.reported) return
      this.reported = true
      this.host.onUnexpectedExit(this.ready
        ? `consumer exited (code=${String(code)} signal=${String(signal)})`
        : `exited before ready marker (code=${String(code)} signal=${String(signal)})`)
    })
    createInterface(child.stderr).on('line', line => this.onProtocolLine(line))
    createInterface(child.stdout).on('line', line => this.onEventLine(line))
  }

  /**
   * Stop the consumer with SIGTERM and resolve on exit; a consumer still
   * running after the grace period gets SIGKILL.
   * @param graceMs - SIGTERM-to-SIGKILL grace; defaults to 5000.
   */
  async dispose(graceMs = 5_000): Promise<void> {
    const child = this.child
    this.disposed = true
    if (child === undefined) return
    child.kill('SIGTERM')
    await new Promise<void>(resolveSettle => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolveSettle()
      }, graceMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolveSettle()
      })
    })
    this.child = undefined
  }

  /** One stderr protocol line: the ready marker flips reading on; the rest is diagnostics. */
  private onProtocolLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    if (!this.ready && trimmed.startsWith(READY_MARKER_PREFIX)) {
      this.ready = true
      this.host.logger.info(`dsh-lark: ingress ready (${trimmed.slice(READY_MARKER_PREFIX.length)})`)
      for (const buffered of this.pendingLines) this.onEventLine(buffered)
      this.pendingLines.length = 0
      return
    }
    this.host.logger.info(`dsh-lark: ingest: ${trimmed}`)
  }

  /** One stdout line: buffered until the ready marker, then parsed, deduplicated, and dispatched. */
  private onEventLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '' || !this.ready) {
      if (trimmed !== '' && !this.ready) this.pendingLines.push(trimmed)
      return
    }
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
    if (!this.rememberEvent(event.eventId)) return
    this.host.onEvent(event)
  }

  /** Record one event id; returns `false` for a redelivery. */
  private rememberEvent(eventId: string): boolean {
    if (this.seenEvents.has(eventId)) return false
    this.seenEvents.add(eventId)
    this.seenOrder.push(eventId)
    if (this.seenOrder.length > DEDUP_CAPACITY) {
      for (const dropped of this.seenOrder.splice(0, DEDUP_DROP_BATCH)) this.seenEvents.delete(dropped)
    }
    return true
  }
}
