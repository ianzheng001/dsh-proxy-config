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

const {
  apply,
  buildProxyEnv,
  describePolicy,
  directEnv,
  effectiveMode,
  loadProxyLibrary,
  normalizeProxyUrl,
  profileList,
  redactProxy,
  routingFields,
  selectRouting,
} = await import('../lib/index.js')
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

/** Requests seen by the second upstream proxy, used to prove preset switching. */
const altObserved = []

const altProxy = http.createServer((request, response) => {
  altObserved.push(`${request.method ?? 'GET'} ${request.url ?? ''}`)
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('proxied-ok-alt')
})

altProxy.on('connect', (request, socket) => {
  altObserved.push(`CONNECT ${request.url ?? ''}`)
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  socket.destroy()
})

await new Promise((resolve) => altProxy.listen(0, '127.0.0.1', resolve))
const altProxyUrl = `http://127.0.0.1:${altProxy.address().port}`

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
  'profile=(legacy) http=http://p:1/ https=http://p:1/ bypass=(loopback only)',
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

// 13. Presets: `profiles` + `active` decide the route. Switching the active
//     name is what makes another upstream proxy receive traffic, and the
//     previously active preset stops receiving anything without being touched.
const presetConfig = (name) => ({
  enabled: true,
  mode: 'proxy',
  active: name,
  profiles: [
    { name: 'first', proxy: proxyUrl, httpProxy: '', httpsProxy: '', allProxy: '', bypass: [] },
    { name: 'second', proxy: altProxyUrl, httpProxy: '', httpsProxy: '', allProxy: '', bypass: [] },
  ],
  proxy: '',
  httpProxy: '',
  httpsProxy: '',
  allProxy: '',
  bypass: '',
  log: true,
})

observed.length = 0
altObserved.length = 0
let presetDispose = await install(presetConfig('first'))
await attempt('https://example.invalid/active-first')
assert.ok(observed.includes('CONNECT example.invalid:443'), 'the active preset must route traffic')
assert.deepEqual(altObserved, [], 'inactive presets must stay inert')
await presetDispose()

observed.length = 0
altObserved.length = 0
presetDispose = await install(presetConfig('second'))
await attempt('https://example.invalid/active-second')
assert.ok(altObserved.includes('CONNECT example.invalid:443'), 'switching active must move traffic to the other upstream')
assert.deepEqual(observed, [], 'the previous preset must receive nothing after the switch')
await presetDispose()

// 14. Preset selection rules: the list wins over the legacy fields once it has
//     entries; an empty or dangling `active` installs nothing instead of
//     silently falling back to stale top-level fields.
assert.equal(selectRouting(presetConfig('second')).source, 'profile')
assert.equal(selectRouting(presetConfig('second')).name, 'second')
assert.equal(routingFields(presetConfig('second')).proxy, altProxyUrl)
assert.equal(selectRouting({ profiles: [], active: 'x', proxy: proxyUrl }).source, 'legacy')
assert.equal(routingFields({ profiles: [], active: 'x', proxy: proxyUrl }).proxy, proxyUrl)
assert.equal(selectRouting({ profiles: [{ name: 'a' }], active: '' }).source, 'none')
assert.equal(selectRouting({ profiles: [{ name: 'a' }], active: 'b' }).source, 'missing')
assert.equal(selectRouting({ profiles: [{ name: 'a' }], active: ' b ' }).source, 'missing')
assert.equal(selectRouting({ profiles: [{ name: '  a  ' }], active: 'a' }).source, 'profile')
assert.equal(buildProxyEnv({ profiles: [{ name: 'a', proxy: proxyUrl }], active: '' }).hasProxy, false)
assert.equal(buildProxyEnv({ profiles: [{ name: 'a', proxy: '' }], active: 'a', proxy: proxyUrl }).hasProxy, false)
assert.equal(profileList({ profiles: [{ name: 'a' }, null, 3] }).length, 1)
assert.equal(
  describePolicy(presetConfig('first')),
  `profile=first http=${proxyUrl}/ https=${proxyUrl}/ bypass=(loopback only)`,
)
assert.equal(
  describePolicy({ profiles: [{ name: 'a' }], active: 'a', bypass: '' }),
  'profile=a http=direct https=direct bypass=(loopback only)',
)

// 15. The plugin's own apply() reinstalls the dispatcher when the loader commits
//     a volatile update, so switching `active` moves traffic without a restart.
//     Config fields arrive as references from the loader; a mutable stand-in
//     with the same `get()` shape drives the same code path.
const fakeState = {
  mode: 'proxy',
  enabled: true,
  active: 'first',
  profiles: [
    { name: 'first', proxy: proxyUrl, httpProxy: '', httpsProxy: '', allProxy: '', bypass: [] },
    { name: 'second', proxy: altProxyUrl, httpProxy: '', httpsProxy: '', allProxy: '', bypass: [] },
  ],
  proxy: '',
  httpProxy: '',
  httpsProxy: '',
  allProxy: '',
  bypass: '',
  log: true,
}
const fakeConfig = new Proxy({}, {
  get: (_target, key) =>
    typeof key === 'string' && key in fakeState ? { get: () => fakeState[key] } : undefined,
})
const warnings = []
const listeners = new Map()
let disposePlugin = () => {}
const fakeCtx = {
  get: (key) => (key === 'profileContext' ? { installAnchor } : undefined),
  logger: { info: () => {}, debug: () => {}, warn: (message) => warnings.push(String(message)) },
  effect: (fn) => {
    disposePlugin = fn() ?? (() => {})
  },
  on: (event, handler) => listeners.set(event, handler),
}
await apply(fakeCtx, fakeConfig)

observed.length = 0
altObserved.length = 0
await attempt('https://example.invalid/apply-active-first')
assert.ok(observed.includes('CONNECT example.invalid:443'), `apply() did not install the active preset: ${JSON.stringify(observed)}`)
assert.deepEqual(altObserved, [])

fakeState.active = 'second'
listeners.get('loader/volatile-update')([['active']])
let switched = false
for (let index = 0; index < 40 && !switched; index += 1) {
  await attempt('https://example.invalid/apply-active-second')
  switched = altObserved.length > 0
  if (!switched) await new Promise((resolve) => setTimeout(resolve, 50))
}
assert.ok(switched, 'a volatile active change must reinstall the policy on the new preset')
observed.length = 0
await attempt('https://example.invalid/apply-after-switch')
assert.deepEqual(observed, [], 'the previously active preset must stop receiving traffic')

// An `active` name with no matching preset installs nothing and explains why.
fakeState.active = 'missing-name'
listeners.get('loader/volatile-update')([['active']])
await new Promise((resolve) => setTimeout(resolve, 100))
assert.ok(
  warnings.some((message) => message.includes('missing-name')),
  `expected a diagnostic for a dangling active name, got ${JSON.stringify(warnings)}`,
)
await disposePlugin()

proxy.close()
altProxy.close()

console.log('proxy-config e2e: all assertions passed')
