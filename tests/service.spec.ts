import { readFile, writeFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import LarkService from '../src/index.ts'
import { fakeCli } from './helpers/fake-cli.ts'

class StartedService extends LarkService {
  start(): Promise<void> { return this[Service.init]() }
}

describe.skipIf(process.platform === 'win32')('service lifecycle with an owned CLI fixture', () => {
  it('waits for consumer unsubscribe before the Cordis effect finishes unloading', async () => {
    const { command } = await fakeCli({ gateShutdown: true })
    const ctx = new Context()
    const service = new StartedService(ctx, { allowedSenders: ['ou_owner'], larkCliPath: command, workspacePath: `${command}.workspace` })
    onTestFinished(async () => { await writeFile(`${command}.release`, ''); await ctx.fiber.dispose() })
    await service.start()
    let finished = false
    const stopping = ctx.fiber.dispose().then(() => { finished = true })
    await expect.poll(() => readFile(`${command}.eof`, 'utf8')).toBe('closed')
    expect(finished).toBe(false)
    await writeFile(`${command}.release`, '')
    await stopping
    expect(await readFile(`${command}.closed`, 'utf8')).toBe('unsubscribed')
  })

  it('fails startup when group mention identity cannot be established', async () => {
    const { command } = await fakeCli({ botInfo: { code: 1 } })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const service = new StartedService(ctx, { allowedSenders: ['ou_owner'], larkCliPath: command, workspacePath: `${command}.workspace` })
    await expect(service.start()).rejects.toThrow(/botName.*groupPolicy/)
    expect(await readFile(`${command}.calls`, 'utf8')).not.toContain('consume')
  })

  it('surfaces initial subscription errors instead of silently restarting forever', async () => {
    const { command } = await fakeCli({ startupFailure: true })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const service = new StartedService(ctx, { allowedSenders: ['ou_owner'], larkCliPath: command, workspacePath: `${command}.workspace`, botName: 'Fixture bot' })
    await expect(service.start()).rejects.toThrow('fixture subscription refused')
  })
})
