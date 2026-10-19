import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Resolve a Host-owned module at load time.
 *
 * The plugin ships with no dependencies: a colleague clones the repository and
 * adds the directory to a profile, and pnpm links it — it does not install
 * anything for a linked directory. `schemastery` therefore has to come from the
 * dsh installation itself, exactly like `@deepseek-ai/dsh-http-proxy` does later
 * from `ctx`. Resolution order: this package's own tree (when it happens to be a
 * registry install), the dsh bin path the process was started from, `DSH_ANCHOR`,
 * then `which dsh`.
 *
 * @param specifier - bare module name.
 * @returns the module namespace.
 * @throws when no candidate resolves it.
 */
function hostRequire(specifier) {
  const anchors = []
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1.endsWith(join('lib', 'bin.js'))) {
    anchors.push(join(dirname(argv1), '..', 'package.json'))
  }
  if (typeof process.env.DSH_ANCHOR === 'string' && process.env.DSH_ANCHOR !== '') anchors.push(process.env.DSH_ANCHOR)
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (bin !== '') anchors.push(join(dirname(realpathSync(bin)), '..', 'package.json'))
  } catch {
    // No dsh on PATH: the remaining anchors still work inside a Host.
  }
  const failures = []
  for (const anchor of [...anchors, join(process.cwd(), 'package.json')]) {
    try {
      return createRequire(anchor)(specifier)
    } catch (error) {
      failures.push(String(error.message ?? error))
    }
  }
  try {
    return createRequire(import.meta.url)(specifier)
  } catch (error) {
    failures.push(String(error.message ?? error))
  }
  throw new Error(`proxy-config: cannot resolve “${specifier}” from the dsh installation or this package: ${failures.join('; ')}`)
}

const z = hostRequire('@deepseek-ai/schemastery')

/**
 * Proxy policy for DeepSeek Harness, configured in the profile patch instead of
 * the launch environment.
 *
 * The launcher resolves a proxy policy from `HTTP(S)_PROXY` before any plugin
 * mounts. This plugin layers a second policy on top from its own config, using
 * the same library the launcher uses, so all `fetch()` traffic (LLM, web search,
 * HTTP MCP) is routed identically. Disposing the plugin restores the launcher's
 * policy, which is what makes the config hot-reloadable.
 *
 * Every field is declared `volatile`: the loader then commits a config edit into
 * the running fiber's references instead of remounting the plugin, emits
 * `loader/volatile-update`, and this plugin reinstalls the policy in place. That
 * is also the precondition for the field to appear in the browser settings
 * domain — `SettingsForms` projects only fields under a volatile ancestor, so a
 * non-volatile schema would leave the plugin with no editable page at all.
 *
 * @module dsh-proxy-config
 */

/** Cordis plugin name used by loader diagnostics. */
const name = 'proxy-config'

/** No services are required: the proxy policy is process-wide, not a seam. */
const inject = []

/**
 * One named proxy preset listed in Settings.
 *
 * Presets are a catalogue, not a stack: an HTTP proxy policy is process-wide,
 * so exactly one preset can be routed through at a time. `active` below names
 * which one; the others are inert by construction, and switching is a single
 * field write rather than toggling several entries.
 */
const Preset = z.object({
  /** Unique, human-readable name; `active` refers to a preset by this name. */
  name: z.string().default(''),
  proxy: z.string().default(''),
  httpProxy: z.string().default(''),
  httpsProxy: z.string().default(''),
  allProxy: z.string().default(''),
  bypass: z.union([z.string(), z.array(String)]).default(''),
})

/**
 * Plugin configuration.
 *
 * `proxy` is the common shorthand for both schemes; the per-scheme fields win.
 * `bypass` accepts either a comma/space separated string or a YAML list and is
 * merged with the loopback entries the library always appends.
 *
 * The top-level proxy fields remain the pre-preset format: when `profiles` is
 * empty they are still what routes traffic, so an existing patch keeps working
 * until the settings page migrates it into the first preset.
 */
const Config = z.object({
  /**
   * What this plugin does with the process's outbound routing: tunnel through
   * the configured proxy, force every request direct, or leave the launcher's
   * launch-environment policy alone. Absent falls back to `proxy`, unless the
   * deprecated `enabled: false` below says otherwise.
   */
  mode: z.union([z.const('proxy'), z.const('direct'), z.const('off')]).volatile(),
  /** Deprecated: `false` meant "leave the launcher policy alone" (now `mode: off`). */
  enabled: z.boolean().default(true).volatile(),
  /** Name of the preset that is installed; empty means no preset is active. */
  active: z.string().default('').volatile(),
  /** Named proxy presets; the settings page edits this list. */
  profiles: z.array(Preset).default([]).volatile(),
  proxy: z.string().default('').volatile(),
  httpProxy: z.string().default('').volatile(),
  httpsProxy: z.string().default('').volatile(),
  allProxy: z.string().default('').volatile(),
  bypass: z.union([z.string(), z.array(String)]).default('').volatile(),
  log: z.boolean().default(true).volatile(),
})

/**
 * Read one config field, whatever shape the loader handed over.
 *
 * A volatile field arrives as a reference object the loader updates in place
 * (`config.proxy.get()`), while unit tests and every unary helper here pass a
 * plain value. Accepting both keeps the pure helpers (and their tests) free of
 * loader details.
 *
 * @param node - a config field, volatile reference, or undefined.
 * @returns the plain value.
 */
function unwrap(node) {
  if (node !== null && typeof node === 'object' && typeof node.get === 'function') {
    try {
      return node.get()
    } catch {
      return undefined
    }
  }
  return node
}

/**
 * Detach the live config into plain values.
 *
 * @param config - the plugin config handed to {@link apply}.
 * @returns a plain object with every declared field resolved.
 */
export function readConfig(config) {
  const source = config ?? {}
  return {
    mode: unwrap(source.mode),
    enabled: unwrap(source.enabled),
    active: unwrap(source.active),
    profiles: unwrap(source.profiles),
    proxy: unwrap(source.proxy),
    httpProxy: unwrap(source.httpProxy),
    httpsProxy: unwrap(source.httpsProxy),
    allProxy: unwrap(source.allProxy),
    bypass: unwrap(source.bypass),
    log: unwrap(source.log),
  }
}

/**
 * Which routing mode the config asks for.
 *
 * `mode` wins; a legacy patch that only carries `enabled: false` still means
 * "do nothing" instead of silently switching the proxy back on.
 *
 * @param config - plugin config, plain or volatile-wrapped.
 * @returns `proxy`, `direct`, or `off`.
 */
export function effectiveMode(config) {
  const source = config ?? {}
  const mode = unwrap(source.mode)
  if (mode === 'proxy' || mode === 'direct' || mode === 'off') return mode
  return unwrap(source.enabled) === false ? 'off' : 'proxy'
}

/**
 * Trimmed name of one preset entry.
 *
 * @param profile - one entry of `profiles`, plain or partially filled.
 * @returns the name, or an empty string when absent.
 */
export function profileName(profile) {
  if (profile === null || typeof profile !== 'object') return ''
  const name = unwrap(profile.name)
  return typeof name === 'string' ? name.trim() : ''
}

/**
 * The preset entries of a config, whether plain or volatile-wrapped.
 *
 * @param config - plugin config.
 * @returns the entries that are objects; anything else is ignored.
 */
export function profileList(config) {
  const raw = unwrap(config?.profiles)
  if (!Array.isArray(raw)) return []
  return raw.filter((entry) => entry !== null && typeof entry === 'object')
}

/**
 * Which routing source the config selects.
 *
 * `profiles` is authoritative once it holds entries: an empty `active` then
 * means "nothing installed" rather than silently falling back to the legacy
 * top-level fields, which is the only way a user can see that no preset is
 * active. The legacy fields still route while the list is empty, so a patch
 * written before presets existed keeps working unchanged.
 *
 * @param config - plugin config.
 * @returns the source kind, the referenced name, and the matched preset.
 */
export function selectRouting(config) {
  const profiles = profileList(config)
  const declared = unwrap(config?.active)
  const active = typeof declared === 'string' ? declared.trim() : ''
  if (profiles.length === 0) return { source: 'legacy', name: '', profile: null }
  if (active === '') return { source: 'none', name: '', profile: null }
  const found = profiles.find((entry) => profileName(entry) === active)
  return found === undefined
    ? { source: 'missing', name: active, profile: null }
    : { source: 'profile', name: active, profile: found }
}

/**
 * The proxy fields routing actually reads.
 *
 * A preset supplies them when one is active; otherwise the legacy top-level
 * fields do, and an unresolved preset yields blanks so the caller reports
 * "nothing configured" instead of inventing a route.
 *
 * @param config - plugin config, plain or volatile-wrapped.
 * @returns `{ proxy, httpProxy, httpsProxy, allProxy, bypass }`.
 */
export function routingFields(config) {
  const routing = selectRouting(config)
  const from = routing.profile ?? (routing.source === 'legacy' ? (config ?? {}) : {})
  return {
    proxy: unwrap(from.proxy),
    httpProxy: unwrap(from.httpProxy),
    httpsProxy: unwrap(from.httpsProxy),
    allProxy: unwrap(from.allProxy),
    bypass: unwrap(from.bypass),
  }
}

/**
 * The environment view that resolves to the library's no-proxy policy.
 *
 * Installing it replaces the global dispatcher with a direct agent, which is
 * what makes "force direct" able to override a policy the launcher already
 * installed from `HTTP(S)_PROXY`. The library restores the launch environment
 * itself, so a spawned child still sees the variables the launcher inherited.
 *
 * @returns an empty `get()`-shaped view.
 */
export function directEnv() {
  return { get: () => undefined, hasProxy: false }
}

/**
 * Accept the `host:port` spelling people actually type and give it a scheme.
 *
 * The library rejects anything that is not an `http:` / `https:` URL, and a
 * bare `proxy.example:8080` parses as the scheme `proxy.example:`, which would
 * silently leave every request direct.
 *
 * @param raw - configured proxy value.
 * @returns the value with `http://` prepended when it carries no `://`.
 */
export function normalizeProxyUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

/**
 * Build the environment view {@link installProxyFromEnvironment} reads.
 *
 * The library reads each name lowercase-first with the uppercase name as a
 * fallback, so both casings are published together and a blank value stays
 * absent rather than shadowing anything.
 *
 * @param config - resolved plugin config, plain or volatile-wrapped.
 * @returns a `get()`-shaped view plus whether any proxy is configured.
 */
export function buildProxyEnv(config) {
  const values = new Map()

  const put = (lower, upper, raw) => {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') return
    values.set(lower, { value })
    values.set(upper, { value })
  }

  const fields = routingFields(config)
  const shared = normalizeProxyUrl(fields.proxy)
  put('http_proxy', 'HTTP_PROXY', normalizeProxyUrl(fields.httpProxy) || shared)
  put('https_proxy', 'HTTPS_PROXY', normalizeProxyUrl(fields.httpsProxy) || shared)
  put('all_proxy', 'ALL_PROXY', normalizeProxyUrl(fields.allProxy))

  put('no_proxy', 'NO_PROXY', Array.isArray(fields.bypass) ? fields.bypass.join(',') : fields.bypass)

  return {
    get: (key) => values.get(key),
    hasProxy: ['http_proxy', 'https_proxy', 'all_proxy'].some((key) => values.has(key)),
  }
}

/**
 * Hide proxy credentials before a URL reaches the log.
 *
 * @param raw - the configured proxy URL.
 * @returns the URL with userinfo masked, or the input when it is not a URL.
 */
export function redactProxy(raw) {
  if (typeof raw !== 'string' || raw === '') return raw
  try {
    const url = new URL(raw)
    if (url.username !== '' || url.password !== '') {
      url.username = '***'
      url.password = ''
    }
    return url.toString()
  } catch {
    return raw
  }
}

/**
 * Effective proxy URL for one scheme, mirroring the library's fallback order.
 *
 * @param config - resolved plugin config, plain or volatile-wrapped.
 * @param scheme - `http` or `https`.
 * @returns the URL that will be used, or an empty string for a direct route.
 */
function effectiveProxy(config, scheme) {
  const fields = routingFields(config)
  const all = normalizeProxyUrl(fields.allProxy)
  const shared = normalizeProxyUrl(fields.proxy)
  const http = normalizeProxyUrl(fields.httpProxy) || shared || all
  // The library resolves https as: its own name, ALL_PROXY, then the HTTP proxy.
  const https = normalizeProxyUrl(fields.httpsProxy) || shared || all || http
  return scheme === 'https' ? https : http
}

/**
 * Describe the installed policy without ever printing credentials.
 *
 * @param config - resolved plugin config, plain or volatile-wrapped.
 * @returns one line naming the source, both schemes, and the bypass list.
 */
export function describePolicy(config) {
  const fields = routingFields(config)
  const routing = selectRouting(config)
  const http = effectiveProxy(config, 'http')
  const https = effectiveProxy(config, 'https')
  const entries = fields.bypass
  const bypass = Array.isArray(entries) ? entries.join(',') : typeof entries === 'string' ? entries : ''
  const shown = (url) => (url === '' ? 'direct' : redactProxy(url))
  const source =
    routing.source === 'profile'
      ? `profile=${routing.name}`
      : routing.source === 'legacy'
        ? 'profile=(legacy)'
        : 'profile=(none)'
  return `${source} http=${shown(http)} https=${shown(https)} bypass=${bypass === '' ? '(loopback only)' : bypass}`
}

/**
 * Load the proxy library from the host's own installation.
 *
 * The policy is module-level state: installing it through a different copy of
 * `@deepseek-ai/dsh-http-proxy` than the launcher used would still route
 * fetches, but `proxyEnvironmentForChild()` would answer from an untouched
 * copy and spawned children would lose the policy. DeepSeek Harness Desktop
 * ships its own dsh under `app.asar`, at a different version from the CLI, so
 * resolving the bare package name from the profile would pick the wrong tree.
 *
 * `require()` of an ES module shares the ESM module map, so a resolved path
 * yields the very instance the launcher imported.
 *
 * @param ctx - plugin context; `profileContext.installAnchor` names the host's
 *   own `package.json` and is absent when no launcher booted the tree.
 * @returns the library namespace.
 */
async function loadProxyLibrary(ctx) {
  const anchor = ctx.get?.('profileContext')?.installAnchor
  if (typeof anchor === 'string' && anchor !== '') {
    try {
      return createRequire(anchor)('@deepseek-ai/dsh-http-proxy')
    } catch (error) {
      ctx.logger?.warn?.(`proxy-config: cannot load @deepseek-ai/dsh-http-proxy from ${anchor}; falling back to the profile copy: ${String(error)}`)
    }
  }
  return import('@deepseek-ai/dsh-http-proxy')
}

/**
 * Install the configured policy for the rest of this process.
 *
 * A volatile config edit does not remount the plugin, so the policy is
 * reinstalled in place: the previous install is disposed first (restoring the
 * launcher's policy) and the new one is layered on top. Reinstalls are
 * serialized so a rapid pair of settings writes cannot interleave two
 * disposers or leave the process on a stale policy.
 *
 * @param ctx - plugin context; owns the logger and the effect scope.
 * @param config - validated plugin config, volatile-wrapped.
 * @returns nothing; the install is registered as an effect and rolled back on dispose.
 */
async function apply(ctx, config) {
  /** Disposer of the currently installed policy, if any. */
  let installed = null
  /** Whether dispose already ran, so a later volatile update installs nothing. */
  let closed = false

  const reinstall = async () => {
    const dispose = installed
    installed = null
    if (dispose !== null) await dispose()
    if (closed) return

    const value = readConfig(config)
    const mode = effectiveMode(config)
    if (mode === 'off') {
      if (value.log) ctx.logger.info('proxy-config: off; launcher proxy policy left unchanged')
      return
    }

    // Direct mode installs the library's no-proxy policy, which replaces the
    // dispatcher the launcher may have installed from the environment. It has
    // no proxy URL by design, so the "nothing configured" guard below is a
    // proxy-mode rule only.
    const env = mode === 'direct' ? directEnv() : buildProxyEnv(value)
    if (mode === 'proxy' && !env.hasProxy) {
      const routing = selectRouting(value)
      const reason =
        routing.source === 'none'
          ? 'no preset is active (active is empty)'
          : routing.source === 'missing'
            ? `active preset "${routing.name}" is not defined in profiles`
            : 'no proxy URL configured (proxy / httpProxy / httpsProxy / allProxy)'
      if (value.log) ctx.logger.warn(`proxy-config: ${reason}`)
      return
    }

    const { installProxyFromEnvironment } = await loadProxyLibrary(ctx)
    const disposeNew = await installProxyFromEnvironment(env, (message) => {
      ctx.logger.warn(`proxy-config: ${message}`)
    })
    if (closed) {
      await disposeNew()
      return
    }
    installed = disposeNew
    if (value.log) {
      ctx.logger.info(
        mode === 'direct'
          ? 'proxy-config: installed direct (every outbound request bypasses the proxy)'
          : `proxy-config: installed ${describePolicy(value)}`,
      )
    }
  }

  let tail = Promise.resolve()
  const schedule = () => {
    tail = tail.then(reinstall).catch((error) => {
      ctx.logger.warn(`proxy-config: reinstalling the policy failed: ${String(error)}`)
    })
    return tail
  }

  await schedule()

  ctx.effect(() => () => {
    closed = true
    const dispose = installed
    installed = null
    return dispose === null ? undefined : dispose()
  }, 'proxy-config.install')

  ctx.on('loader/volatile-update', () => {
    schedule().catch(() => {})
  })
}

export { Config, apply, inject, loadProxyLibrary, name }
