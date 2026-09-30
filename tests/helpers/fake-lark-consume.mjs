// Each child receives its own scenario through argv; stdin EOF releases its subscription.
import { existsSync, watch } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const options = JSON.parse(process.argv[2] ?? '{}')
const emit = values => { for (const value of values) process.stdout.write(JSON.stringify(value) + '\n') }

async function waitForFile(path) {
  if (path === undefined) return
  let check
  const pending = new Promise(resolve => { check = resolve })
  const watcher = watch(dirname(path), () => {
    if (existsSync(path)) check()
  })
  try {
    if (existsSync(path)) check()
    await pending
  } finally {
    watcher.close()
  }
}

process.stdin.resume()
process.stdin.once('end', async () => {
  if (options.eofPath) await writeFile(options.eofPath, 'stdin closed')
  process.stderr.write('fixture: stdin closed\n')
  emit(options.lateEvents ?? [])
  await waitForFile(options.shutdownGate)
  if (options.closedPath) await writeFile(options.closedPath, 'unsubscribed')
  process.exit(0)
})
if (options.crashBeforeReady) process.exit(3)
if (options.junk) {
  process.stdout.write('not json at all\n')
  emit([{ type: 'im.message.message_read_v1' }, { type: 'im.message.receive_v1', event_id: 'incomplete' }])
}
emit(options.beforeReady ?? [])
process.stderr.write('fixture: before ready\n')
await waitForFile(options.readyGate)
process.stderr.write('[event] ready event_key=' + (options.eventKey ?? 'im.message.receive_v1') + '\n')
emit(options.events ?? [])
if (options.exitAfterEvents) process.exitCode = 7
if (options.exitAfterEvents) process.stdin.destroy()
