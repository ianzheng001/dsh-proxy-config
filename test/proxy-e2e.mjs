/**
 * End-to-end proof that the configured policy actually routes outbound fetches.
 *
 * A fake HTTP proxy records every request it receives. Targets use the reserved
 * `.invalid` TLD, so a request that accidentally skips the proxy fails at DNS
 * instead of reaching the real internet — the proxy log alone decides the test.
 *
 * @module test/proxy-e2e
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import { join } from 'node:path'
import { ensureDeps } from './link-deps.mjs'

ensureDeps()

const { buildProxyEnv, describePolicy, directEnv, effectiveMode, loadProxyLibrary, normalizeProxyUrl, redactProxy } = await import('../lib/index.js')
const { installProxyFromEnvironment } = await import('@deepseek-ai/dsh-http-proxy')

/** Every request the fake proxy observed, in arrival order. */
const observed = []
/** Diagnostics the policy reported for unusable values. */
const diagnostics = []

const proxy = http.createServer((request, response) => {
  observed.push(`${request.method ?? 'GET'} ${request.url ?? ''}`)
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('proxied-ok')
})

proxy.on('connect', (request, socket) => {
  observed.push(`CONNECT ${request.url ?? ''}`)
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  socket.destroy()
})

await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
const proxyPort = proxy.address().port
const proxyUrl = `http://127.0.0.1:${proxyPort}`

/**
 * Install a policy from the plugin's own env builder.
 *
 * @param config - partial plugin config; unset fields fall back to the schema defaults.
 * @returns the disposer restoring the previous policy.
 */
async function install(config) {
  const full = {
    enabled: true,
    proxy: '',
    httpProxy: '',
    httpsProxy: '',
    allProxy: '',
    bypass: '',
    log: true,
    ...config,
  }
  return installProxyFromEnvironment(buildProxyEnv(full), (message) => diagnostics.push(message))
}

/**
 * Fetch and swallow transport failures; the proxy log is the assertion target.
 *
 * @param url - synthetic target that only the proxy can answer for.
 */
async function attempt(url) {
  await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => {})
}

let dispose = await install({ proxy: proxyUrl })

// 1. A plain http request reaches the proxy in absolute form.
await attempt('http://example.invalid/plain')
assert.ok(
  observed.includes('GET http://example.invalid/plain'),
  `http request did not reach the proxy: ${JSON.stringify(observed)}`,
)

// 2. An https request reaches the proxy as a CONNECT tunnel.
await attempt('https://example.invalid/secure')
assert.ok(
  observed.includes('CONNECT example.invalid:443'),
  `https request did not reach the proxy: ${JSON.stringify(observed)}`,
)

// 3. A bypassed host is never handed to the proxy.
await dispose()
observed.length = 0
dispose = await install({ proxy: proxyUrl, bypass: ['example.invalid'] })
await attempt('http://example.invalid/bypassed')
await attempt('https://example.invalid/bypassed')
assert.deepEqual(observed, [], `bypass was ignored: ${JSON.stringify(observed)}`)

// 4. Bypass entries match subdomains, and a leading dot means the same thing.
await dispose()
observed.length = 0
dispose = await install({ proxy: proxyUrl, bypass: ['.invalid'] })
await attempt('https://api.example.invalid/')
assert.deepEqual(observed, [], `suffix bypass was ignored: ${JSON.stringify(observed)}`)

// 5. Per-scheme fields override the shared shorthand.
await dispose()
observed.length = 0
dispose = await install({ proxy: 'http://127.0.0.1:1', httpsProxy: proxyUrl })
await attempt('https://example.invalid/override')
assert.ok(observed.includes('CONNECT example.invalid:443'), 'httpsProxy did not override proxy')

// 6. A SOCKS URL is reported and that scheme stays direct.
await dispose()
observed.length = 0
diagnostics.length = 0
dispose = await install({ proxy: 'socks5://127.0.0.1:1080' })
await attempt('https://example.invalid/socks')
assert.deepEqual(observed, [], 'a SOCKS proxy must not be used')
assert.ok(
  diagnostics.some((message) => message.includes('SOCKS proxy')),
  `expected a SOCKS diagnostic, got ${JSON.stringify(diagnostics)}`,
)
await dispose()

// 7. Schema defaults and credential masking.
assert.equal(buildProxyEnv({ proxy: '', httpProxy: '', httpsProxy: '', allProxy: '', bypass: '' }).hasProxy, false)
assert.equal(redactProxy('http://user:secret@127.0.0.1:7890'), 'http://***@127.0.0.1:7890/')
assert.ok(
  describePolicy({ proxy: 'http://user:secret@127.0.0.1:7890', httpProxy: '', httpsProxy: '', allProxy: '', bypass: '' }).includes('***'),
)
assert.ok(!describePolicy({ proxy: 'http://user:secret@127.0.0.1:7890', httpProxy: '', httpsProxy: '', allProxy: '', bypass: '' }).includes('secret'))

// 8. The described policy mirrors the library: https falls back to the HTTP proxy.
assert.equal(
  describePolicy({ proxy: '', httpProxy: 'http://p:1', httpsProxy: '', allProxy: '', bypass: '' }),
  'http=http://p:1/ https=http://p:1/ bypass=(loopback only)',
)

// 9. Loading through the host's install anchor returns the launcher's own module
//    instance, which is what keeps child-process proxy inheritance working.
const profile = process.env.DSH_PROFILE ?? 'web'
const requireFromProfile = createRequire(join(os.homedir(), '.dsh', 'profiles', profile, 'package.json'))
const installAnchor = requireFromProfile.resolve('@deepseek-ai/dsh/package.json')
const viaAnchor = await loadProxyLibrary({ get: (key) => (key === 'profileContext' ? { installAnchor } : undefined) })
const viaBareImport = await import('@deepseek-ai/dsh-http-proxy')
assert.equal(viaAnchor, viaBareImport, 'anchor resolution returned a different module instance')

// 10. A scheme-less host:port is normalized instead of being rejected as an unknown scheme.
assert.equal(normalizeProxyUrl('proxy.example.com:8080'), 'http://proxy.example.com:8080')
assert.equal(normalizeProxyUrl('http://p:1'), 'http://p:1')
assert.equal(
  buildProxyEnv({ proxy: 'proxy.example.com:8080', httpProxy: '', httpsProxy: '', allProxy: '', bypass: '' }).get('https_proxy').value,
  'http://proxy.example.com:8080',
)

// 11. Direct mode overrides a policy the launcher already installed: the fake
//     proxy keeps receiving every request until the direct policy replaces the
//     dispatcher, and nothing reaches it afterwards.
await dispose()
observed.length = 0
const proxiedDispose = await install({ proxy: proxyUrl })
await attempt('https://example.invalid/through-proxy')
assert.ok(observed.includes('CONNECT example.invalid:443'), 'setup: the proxy policy did not apply')
const directDispose = await installProxyFromEnvironment(directEnv(), (message) => diagnostics.push(message))
observed.length = 0
await attempt('https://example.invalid/forced-direct')
assert.deepEqual(observed, [], `direct mode must not reach the proxy: ${JSON.stringify(observed)}`)
await directDispose()
await proxiedDispose()

// 12. Mode resolution: an explicit mode wins, and a legacy `enabled: false` still
//     means "leave the launcher policy alone" instead of switching the proxy on.
assert.equal(effectiveMode({ mode: 'direct' }), 'direct')
assert.equal(effectiveMode({ mode: 'off', enabled: true }), 'off')
assert.equal(effectiveMode({ mode: 'proxy', enabled: false }), 'proxy')
assert.equal(effectiveMode({ enabled: false }), 'off')
assert.equal(effectiveMode({}), 'proxy')
assert.equal(effectiveMode({ enabled: true }), 'proxy')
assert.equal(directEnv().hasProxy, false)
assert.equal(directEnv().get('https_proxy'), undefined)

proxy.close()

console.log('proxy-config e2e: all assertions passed')
