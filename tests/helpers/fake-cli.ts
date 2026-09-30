/** Per-test executable CLI fixture; all state is confined to its temporary directory. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

export async function fakeCli(scenario: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-cli-'))
  const command = join(root, 'lark-cli')
  await writeFile(command, `#!${process.execPath}
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs'
const script = process.argv[1]
const config = JSON.parse(readFileSync(script + '.json', 'utf8'))
const args = process.argv.slice(2)
appendFileSync(script + '.calls', JSON.stringify(args) + '\\n')
if (args[0] === '--version') {
  process.stdout.write('fixture-cli\\n')
} else if (args[0] === 'api') {
  process.stdout.write(JSON.stringify(config.botInfo ?? { code: 0, bot: { app_name: 'Fixture bot' } }))
} else if (args[0] === 'im') {
  if (config.failure) { process.stderr.write('fixture request failed'); process.exit(3) }
  process.stdout.write(config.rawOutput ?? JSON.stringify(config.envelope ?? { ok: true }))
} else if (args[0] === 'event') {
  process.stdin.resume()
  process.stdin.once('end', () => {
    writeFileSync(script + '.eof', 'closed')
    const finish = () => { writeFileSync(script + '.closed', 'unsubscribed'); process.exit(0) }
    if (!config.gateShutdown) finish()
    else {
      const timer = setInterval(() => { if (existsSync(script + '.release')) { clearInterval(timer); finish() } }, 5)
    }
  })
  if (config.startupFailure) { process.stderr.write('fixture subscription refused'); process.exit(4) }
  process.stderr.write('[event] ready event_key=im.message.receive_v1\\n')
  for (const event of config.events ?? []) process.stdout.write(JSON.stringify(event) + '\\n')
}
`, { mode: 0o700 })
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(`${command}.json`, JSON.stringify(scenario))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return { command, root }
}
