/** Verify the packed entry imports with only this checkout's installed dependencies. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const output = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30_000,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const [{ files }] = JSON.parse(output)
const shipped = new Set(files.map(file => file.path))
assert(shipped.has(manifest.main.replace(/^\.\//u, '')), 'Package must contain its executable entry')
assert(shipped.has(manifest.dsh.bundle.patch.replace(/^\.\//u, '')), 'Package must contain the bundle patch')
assert(shipped.has('LICENSE'), 'Package must contain its license')
assert(!files.some(file => /^(?:src|tests|node_modules)\//u.test(file.path)), 'Package must ship built code only')

const packedRoot = await mkdtemp(join(tmpdir(), 'dsh-lark-package-'))
try {
  for (const { path } of files) {
    const target = join(packedRoot, path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(root, path), target)
  }
  await symlink(join(root, 'node_modules'), join(packedRoot, 'node_modules'), 'junction')
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict'
    const { default: LarkService } = await import(${JSON.stringify(resolve(packedRoot, manifest.main))})
    assert.equal(typeof LarkService, 'function')
    assert(LarkService.inject.includes('agents'))
    assert(LarkService.inject.includes('agentPresets'))
    assert(LarkService.Config)
  `], { cwd: packedRoot, stdio: 'pipe', timeout: 30_000 })
} finally {
  await rm(packedRoot, { recursive: true, force: true })
}
console.log(`Package smoke passed: ${files.length} files, built ESM entry imports outside the checkout.`)
