// dsh-proxy-config — browser half (web bundle, ModuleLoader CJS format).
//
// Registers the "出站代理" settings section. The page edits the profile loader
// entry `proxy-config` through the settings domain's ConfigForm: a save lands in
// the profile's cordis.patch.yml (comments preserved) and the Host reconciles
// the Loader, which disposes and re-applies the plugin's proxy policy — so a
// change takes effect without restarting dsh.
//
// This file is hand-written CJS in the same shape tsdown emits: the loader
// materializes the factory with a `require` bound to the frozen platform module
// table (React, Cordis, static UI libs), so `require('react')` is the only
// cross-bundle request and no build step is involved.
;(() => {
// One IIFE keeps this file's bindings local. The Web shell concatenates the
// missing bundles of a boot batch into a single combo script, so a top-level
// `const factory` here would collide with every other hand-written bundle of the
// same shape and break the whole batch (see tool_dsh_mcp_plugin/test/bundle.test.mjs).
const factory = (require) => {
  var module = { exports: {} }
  var exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const React = require('react')
  const h = React.createElement

  /** Loader entry id this page edits; also the id the bundle registers under. */
  const NS = 'proxy-config'

  /** Scalar fields of the host Config schema, in display order. */
  const SCHEME_FIELDS = ['proxy', 'httpProxy', 'httpsProxy', 'allProxy']

  const CSS = [
    '.pxc-wrap{font-size:13px;line-height:1.6;display:flex;flex-direction:column;gap:16px;padding:4px 2px;color:inherit;max-width:720px}',
    '.pxc-title{margin:0;font-size:16px;font-weight:600}',
    '.pxc-sub{opacity:.72;font-size:12px}',
    '.pxc-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
    '.pxc-card h3{margin:0;font-size:13px;font-weight:600;opacity:.9}',
    '.pxc-row{display:flex;flex-direction:column;gap:4px}',
    '.pxc-row>span{font-size:12px;opacity:.8}',
    '.pxc-row small{font-size:11px;opacity:.6}',
    '.pxc-input{font-size:12px;padding:5px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.pxc-toggle{display:flex;align-items:center;gap:8px;font-size:12px}',
    '.pxc-modes{display:flex;gap:8px;flex-wrap:wrap}',
    '.pxc-mode{font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;cursor:pointer}',
    '.pxc-mode:disabled{opacity:.45;cursor:default}',
    '.pxc-mode.active{border-color:rgba(88,166,255,.8);background:rgba(88,166,255,.15)}',
    '.pxc-inactive{opacity:.5}',
    '.pxc-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.pxc-chip{font-size:11px;padding:2px 6px 2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.pxc-chip button{border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;line-height:1;padding:0 2px}',
    '.pxc-chip button:hover{opacity:1}',
    '.pxc-add{display:flex;gap:8px}',
    '.pxc-btn{font-size:12px;padding:4px 12px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;cursor:pointer;white-space:nowrap}',
    '.pxc-btn:disabled{opacity:.45;cursor:default}',
    '.pxc-btn.primary{border-color:rgba(88,166,255,.7)}',
    '.pxc-msg{padding:8px 10px;border-radius:6px;font-size:12px}',
    '.pxc-msg.ok{background:rgba(46,160,67,.15);border:1px solid rgba(46,160,67,.4)}',
    '.pxc-msg.err{background:rgba(248,81,73,.15);border:1px solid rgba(248,81,73,.4)}',
    '.pxc-msg.info{background:rgba(88,166,255,.13);border:1px solid rgba(88,166,255,.45)}',
    '.pxc-policy{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;opacity:.85;word-break:break-all;display:flex;flex-direction:column;gap:2px}',
    '.pxc-actions{display:flex;align-items:center;gap:10px}',
  ].join('')

  /** Inject the page stylesheet once per document. */
  function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('pxc-css') !== null) return
    const tag = document.createElement('style')
    tag.id = 'pxc-css'
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  /**
   * Accept the `host:port` spelling the host accepts, for the same reason:
   * a scheme-less value would otherwise read as an unknown scheme.
   *
   * @param raw - configured value.
   * @returns the value with `http://` prepended when it carries no `://`.
   */
  function normalizeProxyUrl(raw) {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') return ''
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'http://' + value
  }

  /**
   * Hide proxy credentials before showing a URL.
   *
   * @param raw - configured proxy URL.
   * @returns the URL with userinfo masked, or the input when unparseable.
   */
  function redactProxy(raw) {
    if (typeof raw !== 'string' || raw === '') return ''
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
   * Effective proxy URL for one scheme, mirroring lib/index.js exactly so the
   * preview on this page cannot disagree with what the Host will install.
   *
   * @param value - resolved plugin config.
   * @param scheme - `http` or `https`.
   * @returns the URL that will be used, or an empty string for a direct route.
   */
  function effectiveProxy(value, scheme) {
    const all = normalizeProxyUrl(value.allProxy)
    const shared = normalizeProxyUrl(value.proxy)
    const http = normalizeProxyUrl(value.httpProxy) || shared || all
    const https = normalizeProxyUrl(value.httpsProxy) || shared || all || http
    return scheme === 'https' ? https : http
  }

  /**
   * Bypass entries as a list, accepting both the list and the `NO_PROXY` string.
   *
   * @param value - configured bypass value.
   * @returns trimmed entries without empties.
   */
  function bypassList(value) {
    if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
    if (typeof value !== 'string') return []
    return value.split(/[,\s]+/).map((entry) => entry.trim()).filter((entry) => entry !== '')
  }

  /**
   * Read the entry's shared form and follow every snapshot replacement.
   *
   * The settings provider owns one form per Host entry and folds write answers
   * into it, so this subscription also refreshes the page after a save without
   * a second read of the Host document.
   *
   * @param ctx - the client plugin context.
   * @returns the form (when served) and its current snapshot.
   */
  function useEntryForm(ctx) {
    // `configForms` is declared in `inject`, so the provider is guaranteed
    // present; a property read before injection throws in cordis.
    const form = React.useMemo(() => ctx.configForms.get(NS), [ctx])
    const [snapshot, setSnapshot] = React.useState(() =>
      form === undefined ? { status: 'unavailable' } : form.getSnapshot(),
    )
    React.useEffect(() => {
      if (form === undefined) return undefined
      setSnapshot(form.getSnapshot())
      return form.subscribe(() => setSnapshot(form.getSnapshot()))
    }, [form])
    return { form, snapshot }
  }

  /** Routing modes the page offers, in display order. */
  const MODE_OPTIONS = [
    { id: 'proxy', label: '走代理', hint: '按下面的代理地址和 bypass 列表安装策略。' },
    { id: 'direct', label: '全部直连', hint: '覆盖启动 dsh 时从 HTTP(S)_PROXY 装的策略，所有出站请求直连。' },
    { id: 'off', label: '不干预', hint: '不安装任何策略，保留 launcher 从启动环境变量装的那一套。' },
  ]

  /**
   * Which routing mode a resolved section asks for, mirroring lib/index.js.
   *
   * `mode` wins; a legacy section that only carries `enabled: false` still
   * means "leave the launcher policy alone" rather than switching back on.
   *
   * @param section - resolved plugin config.
   * @returns `proxy`, `direct`, or `off`.
   */
  function effectiveMode(section) {
    const value = section ?? {}
    if (value.mode === 'proxy' || value.mode === 'direct' || value.mode === 'off') return value.mode
    return value.enabled === false ? 'off' : 'proxy'
  }

  /** Editable mirror of one resolved config section. */
  function toDraft(value) {
    const section = value ?? {}
    return {
      mode: effectiveMode(section),
      proxy: typeof section.proxy === 'string' ? section.proxy : '',
      httpProxy: typeof section.httpProxy === 'string' ? section.httpProxy : '',
      httpsProxy: typeof section.httpsProxy === 'string' ? section.httpsProxy : '',
      allProxy: typeof section.allProxy === 'string' ? section.allProxy : '',
      bypass: bypassList(section.bypass),
    }
  }

  /**
   * One line per scheme, describing what the Host will install.
   *
   * @param value - resolved plugin config.
   * @returns the human-readable policy summary.
   */
  function describePolicy(value) {
    const shown = (url) => (url === '' ? '直连' : redactProxy(url))
    return {
      http: shown(effectiveProxy(value, 'http')),
      https: shown(effectiveProxy(value, 'https')),
      bypass: bypassList(value.bypass).length,
    }
  }

  /** The settings page for this plugin's profile entry. */
  function ProxyPage(props) {
    const ctx = props.ctx
    const { form, snapshot } = useEntryForm(ctx)
    const [draft, setDraft] = React.useState(null)
    const [draftRevision, setDraftRevision] = React.useState(null)
    const [advanced, setAdvanced] = React.useState(false)
    const [pendingEntry, setPendingEntry] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [message, setMessage] = React.useState(null)

    // Adopt a fresh Host value whenever the revision changes (first read and
    // after every accepted write). Local edits survive unrelated re-renders.
    const revision = snapshot.revision
    React.useEffect(() => {
      if (snapshot.value === undefined || revision === undefined) return
      if (draftRevision === revision) return
      setDraft(toDraft(snapshot.value))
      setDraftRevision(revision)
    }, [revision, snapshot.value, draftRevision])

    const setField = (field) => (event) => {
      const next = event.target.type === 'checkbox' ? event.target.checked : event.target.value
      setDraft((current) => (current === null ? current : { ...current, [field]: next }))
      setMessage(null)
    }

    const setMode = (mode) => () => {
      setDraft((current) => (current === null ? current : { ...current, mode }))
      setMessage(null)
    }

    const addBypass = () => {
      const entry = pendingEntry.trim()
      if (entry === '') return
      setDraft((current) =>
        current === null || current.bypass.includes(entry) ? current : { ...current, bypass: [...current.bypass, entry] },
      )
      setPendingEntry('')
      setMessage(null)
    }

    const removeBypass = (entry) => () => {
      setDraft((current) => (current === null ? current : { ...current, bypass: current.bypass.filter((item) => item !== entry) }))
      setMessage(null)
    }

    if (snapshot.status === 'loading' || draft === null) {
      return h('div', { className: 'pxc-wrap' }, h('div', { className: 'pxc-sub' }, '正在读取当前代理配置…'))
    }

    if (snapshot.status === 'unavailable' || form === undefined) {
      return h(
        'div',
        { className: 'pxc-wrap' },
        h('h2', { className: 'pxc-title' }, '出站代理'),
        h(
          'div',
          { className: 'pxc-msg err' },
          'Host 没有提供这个配置条目（profile 里缺少 loader entry “proxy-config”，或当前连接不支持写入）。',
        ),
      )
    }

    const mode = draft.mode
    const proxyActive = mode === 'proxy'
    const policy = describePolicy(draft)
    const writable = snapshot.writable === true

    // The write list is derived field by field so an untouched field stays out
    // of the patch; clearing a field unsets it instead of storing an empty
    // string, which also lets the schema default come back.
    const pendingOps = []
    const values = snapshot.value ?? {}
    if (draft.mode !== effectiveMode(values)) {
      pendingOps.push({ op: 'set', path: ['mode'], value: draft.mode })
    }
    for (const field of SCHEME_FIELDS) {
      const next = String(draft[field] ?? '').trim()
      const previous = typeof values[field] === 'string' ? values[field].trim() : ''
      if (next === previous) continue
      pendingOps.push(next === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: next })
    }
    const nextBypass = draft.bypass
    const previousBypass = bypassList(values.bypass)
    if (JSON.stringify(nextBypass) !== JSON.stringify(previousBypass)) {
      pendingOps.push(nextBypass.length === 0 ? { op: 'unset', path: ['bypass'] } : { op: 'set', path: ['bypass'], value: nextBypass })
    }

    const save = async () => {
      if (pendingOps.length === 0 || busy) return
      setBusy(true)
      setMessage(null)
      try {
        const accepted = await form.mutate(pendingOps, snapshot.revision)
        setMessage(
          accepted
            ? { kind: 'ok', text: '已写入 profile patch，策略已实时应用（无需重启）。' }
            : { kind: 'err', text: 'Host 拒绝了这次写入，页面已回读最新配置。' },
        )
      } catch (error) {
        setMessage({ kind: 'err', text: '写入失败：' + String((error && error.message) || error) })
      } finally {
        setBusy(false)
      }
    }

    const reset = () => {
      setDraft(toDraft(snapshot.value))
      setMessage(null)
    }

    const field = (name, label, hint) =>
      h(
        'label',
        { className: 'pxc-row' },
        h('span', null, label),
        h('input', {
          className: 'pxc-input',
          value: draft[name],
          placeholder: name === 'proxy' ? 'http://127.0.0.1:7890 或 proxy.example:8080' : '留空则回落到上一级',
          spellCheck: false,
          disabled: !writable || mode !== 'proxy',
          onChange: setField(name),
        }),
        hint !== undefined ? h('small', null, hint) : null,
      )

    return h(
      'div',
      { className: 'pxc-wrap' },
      h('div', null,
        h('h2', { className: 'pxc-title' }, '出站代理'),
        h(
          'div',
          { className: 'pxc-sub' },
          '编辑当前 profile 的 proxy-config 条目：保存即写入 cordis.patch.yml，并由 Host 立即重新安装代理策略。',
        ),
      ),

      h('div', { className: 'pxc-card' },
        h('h3', null, '模式'),
        h('div', { className: 'pxc-modes' },
          MODE_OPTIONS.map((option) =>
            h('button', {
              key: option.id,
              type: 'button',
              className: 'pxc-mode' + (mode === option.id ? ' active' : ''),
              'aria-pressed': mode === option.id,
              disabled: !writable,
              onClick: setMode(option.id),
            }, option.label),
          ),
        ),
        h('div', { className: 'pxc-sub' }, (MODE_OPTIONS.find((option) => option.id === mode) ?? {}).hint ?? ''),
      ),

      h('div', { className: 'pxc-card' },
        h('h3', null, '将要生效的策略'),
        h('div', { className: 'pxc-policy' },
          mode === 'proxy'
            ? [
                h('span', { key: 'http' }, 'http  → ' + policy.http),
                h('span', { key: 'https' }, 'https → ' + policy.https),
                h('span', { key: 'bypass' }, 'bypass → ' + (policy.bypass === 0 ? '仅回环地址直连' : policy.bypass + ' 条（回环地址始终直连）')),
              ]
            : mode === 'direct'
              ? [
                  h('span', { key: 'direct' }, '所有出站请求 → 直连'),
                  h('span', { key: 'override' }, '覆盖启动环境变量装的那套代理策略'),
                ]
              : [
                  h('span', { key: 'off' }, '不安装策略 → 保留启动环境变量装的那一套'),
                ],
        ),
      ),

      h('div', { className: 'pxc-card' + (proxyActive ? '' : ' pxc-inactive') },
        h('h3', null, '代理地址'),
        !proxyActive ? h('div', { className: 'pxc-sub' }, '当前模式下这一组不生效；配置会保留，切回「走代理」即恢复。') : null,
        field('proxy', 'proxy', '同时作用于 http 和 https；不带 scheme 时自动补 http://'),
        h('button', { className: 'pxc-btn', type: 'button', disabled: !writable || !proxyActive, onClick: () => setAdvanced((open) => !open) },
          advanced ? '收起分协议配置' : '分协议配置…'),
        advanced
          ? h('div', { className: 'pxc-row', style: { gap: '10px' } },
              field('httpProxy', 'httpProxy', '覆盖 proxy，仅 http:'),
              field('httpsProxy', 'httpsProxy', '覆盖 proxy，仅 https:'),
              field('allProxy', 'allProxy', '两种 scheme 的兜底（等价 ALL_PROXY）'),
            )
          : null,
      ),

      h('div', { className: 'pxc-card' + (proxyActive ? '' : ' pxc-inactive') },
        h('h3', null, 'bypass（不走代理的域名）'),
        h('div', { className: 'pxc-sub' },
          '按子域后缀匹配：.example 同时放行 wiki.example.com；不支持 CIDR，也不影响回环地址。'),
        h('div', { className: 'pxc-chips' },
          draft.bypass.length === 0
            ? h('span', { className: 'pxc-sub' }, '（空）')
            : draft.bypass.map((entry) =>
                h('span', { className: 'pxc-chip', key: entry },
                  entry,
                  h('button', { type: 'button', title: '删除', disabled: !writable || !proxyActive, onClick: removeBypass(entry) }, '×'),
                ),
              ),
        ),
        h('div', { className: 'pxc-add' },
          h('input', {
            className: 'pxc-input',
            value: pendingEntry,
            placeholder: '.example.com 或 example.com:8443，回车添加',
            spellCheck: false,
            disabled: !writable || !proxyActive,
            onChange: (event) => setPendingEntry(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addBypass()
              }
            },
          }),
          h('button', { className: 'pxc-btn', type: 'button', disabled: !writable || !proxyActive || pendingEntry.trim() === '', onClick: addBypass }, '添加'),
        ),
      ),

      message !== null ? h('div', { className: 'pxc-msg ' + message.kind }, message.text) : null,

      h('div', { className: 'pxc-actions' },
        h('button', {
          className: 'pxc-btn primary',
          type: 'button',
          disabled: !writable || busy || pendingOps.length === 0,
          onClick: save,
        }, busy ? '保存中…' : pendingOps.length === 0 ? '保存' : '保存 ' + pendingOps.length + ' 项修改'),
        h('button', {
          className: 'pxc-btn',
          type: 'button',
          disabled: !writable || busy || pendingOps.length === 0,
          onClick: reset,
        }, '撤销修改'),
        !writable
          ? h('span', { className: 'pxc-sub' }, '当前连接不可写（非本机页面或 profile 只读）。')
          : h('span', { className: 'pxc-sub' }, revision === undefined ? '' : 'revision ' + revision),
      ),
    )
  }

  module.exports = {
    name: 'dsh-proxy-config-client',
    /** Both services must exist before the page can read or write values. */
    inject: ['slots', 'configForms'],
    apply(ctx) {
      ensureCss()
      const slots = ctx.slots
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'outbound-proxy', order: 18, label: '出站代理' },
        () => h(ProxyPage, { ctx }),
      ))
    },
  }
  return module.exports
}

// The boot graph row is the Loader entry id (`proxy-config`, inserted by this
// package's bundle patch). Registration under the package name is inert here
// and costs nothing; it keeps the bundle usable if it is ever mounted under
// that id instead.
window.__ModuleLoader__.load({ id: 'proxy-config', factory })
window.__ModuleLoader__.load({ id: 'dsh-proxy-config', factory })
})()
