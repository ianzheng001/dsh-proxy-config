/**
 * Link the two runtime peers from the installed dsh profile into this project's
 * `node_modules`, so `npm test` runs without a separate install.
 *
 * The plugin resolves `@deepseek-ai/dsh-http-proxy` through the profile's shared
 * node_modules at runtime; the test needs the same resolution root to import the
 * very same module instance (the proxy policy is module-level state).
 *
 * @module test/link-deps
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const PEERS = ['@deepseek-ai/dsh-http-proxy', '@deepseek-ai/schemastery']

/**
 * Create `node_modules/<peer>` symlinks when the peers are not already present.
 *
 * @returns the profile package.json used as the resolution anchor.
 */
export function ensureDeps() {
  const profile = process.env.DSH_PROFILE ?? 'web'
  const anchor = join(os.homedir(), '.dsh', 'profiles', profile, 'package.json')
  const require = createRequire(anchor)
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))

  for (const peer of PEERS) {
    const packageDir = dirname(require.resolve(`${peer}/package.json`))
    const linkPath = join(projectRoot, 'node_modules', peer)
    if (existsSync(linkPath)) continue
    mkdirSync(dirname(linkPath), { recursive: true })
    symlinkSync(packageDir, linkPath, 'dir')
  }

  return anchor
}
