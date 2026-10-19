/**
 * Link the runtime peers from the installed dsh profile into this project's
 * `node_modules`, so `npm test` runs without a separate install.
 *
 * The plugin resolves `@deepseek-ai/dsh-http-proxy` through the profile's shared
 * node_modules at runtime; the test needs the same resolution root to import the
 * very same module instance (the proxy policy is module-level state). `react` is
 * the one module the browser bundle asks the Host's platform table for, and the
 * smoke test supplies the profile's own copy.
 *
 * @module test/link-deps
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const PEERS = ['@deepseek-ai/dsh-http-proxy', '@deepseek-ai/schemastery', 'react']

/**
 * Create `node_modules/<peer>` symlinks when the peers are not already present.
 *
 * The active profile usually resolves every peer; the Desktop profile pins only
 * the two linked plugins into `node_modules`, so the Web profile — which carries
 * the hoisted runtime the browser bundles import — is the fallback anchor.
 *
 * @returns the profile package.json used as the primary resolution anchor.
 */
export function ensureDeps() {
  const profile = process.env.DSH_PROFILE ?? 'web'
  const homedir = os.homedir()
  const anchors = [
    join(homedir, '.dsh', 'profiles', profile, 'package.json'),
    join(homedir, '.dsh', 'profiles', 'web', 'package.json'),
  ]
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))

  for (const peer of PEERS) {
    const linkPath = join(projectRoot, 'node_modules', peer)
    if (existsSync(linkPath)) continue
    let packageDir
    const failures = []
    for (const anchor of anchors) {
      try {
        packageDir = dirname(createRequire(anchor).resolve(`${peer}/package.json`))
        break
      } catch (error) {
        failures.push(String(error.message ?? error))
      }
    }
    if (packageDir === undefined) {
      throw new Error(`test/link-deps: cannot resolve “${peer}” from any profile: ${failures.join('; ')}`)
    }
    mkdirSync(dirname(linkPath), { recursive: true })
    symlinkSync(packageDir, linkPath, 'dir')
  }

  return anchors[0]
}
