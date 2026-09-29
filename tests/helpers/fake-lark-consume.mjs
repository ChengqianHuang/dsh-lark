// Fake `lark-cli event consume` for dsh-lark ingress tests. Emits the ready
// marker on stderr, then streams to stdout: FAKE_JUNK=1 adds unparseable and
// non-event lines first, then FAKE_EVENTS (a JSON array) as NDJSON, then
// idles until SIGTERM. FAKE_CRASH=1 exits before the marker with code 3.
if (process.env.FAKE_CRASH === '1') process.exit(3)
process.stderr.write('[event] ready event_key=im.message.receive_v1\n')
if (process.env.FAKE_JUNK === '1') {
  process.stdout.write('not json at all\n')
  process.stdout.write(JSON.stringify({ type: 'im.message.message_read_v1' }) + '\n')
  process.stdout.write(JSON.stringify({ type: 'im.message.receive_v1', event_id: 'incomplete' }) + '\n')
}
const events = JSON.parse(process.env.FAKE_EVENTS ?? '[]')
for (const line of events) process.stdout.write(JSON.stringify(line) + '\n')
process.stdin.resume()
process.on('SIGTERM', () => process.exit(0))
