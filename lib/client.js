// dsh-proxy-config — browser half (web bundle, ModuleLoader CJS format).
//
// Registers the "出站代理" settings section. The page edits the profile loader
// entry `proxy-config` through the settings domain's ConfigForm: a save lands in
// the profile's cordis.patch.yml (comments preserved) and the Host reconciles
// the Loader, which commits volatile fields into the running fiber and
// re-installs the proxy policy — so a change takes effect without restarting dsh.
//
// Several proxies are configured as a catalogue (`profiles`) and exactly one is
// installed at a time (`active`). That is not a UI convention: an outbound HTTP
// proxy policy is a single process-wide dispatcher, so activating a preset means
// writing `active` and nothing else — every other preset is inert by definition.
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
  const { useEffect, useState } = React

  /** Loader entry id this page edits; also the id the bundle registers under. */
  const NS = 'proxy-config'

  /** Optional per-scheme URL fields of one preset, in display order. */
  const OPTIONAL_FIELDS = ['proxy', 'httpProxy', 'httpsProxy', 'allProxy']

  /** Name given to the preset synthesized from the pre-preset top-level fields. */
  const LEGACY_NAME = '默认'

  /** Monotonic key source for draft rows; never written to the config. */
  let keySeed = 0

  /** @returns a fresh draft-row key. */
  function nextKey() {
    keySeed += 1
    return 'row' + keySeed
  }

  const CSS = [
    '.pxc-wrap{font-size:13px;line-height:1.6;display:flex;flex-direction:column;gap:16px;padding:4px 2px;color:inherit;max-width:760px}',
    '.pxc-title{margin:0;font-size:16px;font-weight:600}',
    '.pxc-sub{opacity:.72;font-size:12px}',
    '.pxc-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
    '.pxc-card h3{margin:0;font-size:13px;font-weight:600;opacity:.9}',
    '.pxc-preset{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,background .15s}',
    '.pxc-preset.active{border-color:rgba(88,166,255,.75);background:rgba(88,166,255,.07)}',
    '.pxc-preset.inactive{opacity:.78}',
    '.pxc-preset-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.pxc-radio{width:16px;height:16px;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.6));background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}',
    '.pxc-radio .dot{width:8px;height:8px;border-radius:50%;background:transparent}',
    '.pxc-radio[aria-checked="true"]{border-color:rgba(88,166,255,.9)}',
    '.pxc-radio[aria-checked="true"] .dot{background:rgba(88,166,255,.95)}',
    '.pxc-radio:disabled{opacity:.45;cursor:default}',
    '.pxc-preset-name{font-weight:600;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.pxc-preset-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;opacity:.72;word-break:break-all}',
    '.pxc-spacer{flex:1}',
    '.pxc-row{display:flex;flex-direction:column;gap:4px}',
    '.pxc-row>span{font-size:12px;opacity:.8}',
    '.pxc-row small{font-size:11px;opacity:.6}',
    '.pxc-input{font-size:12px;padding:5px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.pxc-modes{display:flex;gap:8px;flex-wrap:wrap}',
    '.pxc-mode{font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;cursor:pointer}',
    '.pxc-mode:disabled{opacity:.45;cursor:default}',
    '.pxc-mode.active{border-color:rgba(88,166,255,.8);background:rgba(88,166,255,.15)}',
    '.pxc-inactive{opacity:.6}',
    '.pxc-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.pxc-chip{font-size:11px;padding:2px 6px 2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.pxc-chip button{border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;line-height:1;padding:0 2px}',
    '.pxc-chip button:hover{opacity:1}',
    '.pxc-chip.on{background:rgba(46,160,67,.14);border-color:rgba(46,160,67,.5);padding:2px 8px}',
    '.pxc-chip.off{opacity:.6;padding:2px 8px}',
    '.pxc-add{display:flex;gap:8px}',
    '.pxc-btn{font-size:12px;padding:4px 12px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));background:transparent;color:inherit;cursor:pointer;white-space:nowrap}',
    '.pxc-btn:disabled{opacity:.45;cursor:default}',
    '.pxc-btn.tiny{padding:2px 8px;font-size:11px}',
    '.pxc-btn.primary{border-color:rgba(88,166,255,.7)}',
    '.pxc-btn.danger{border-color:rgba(248,81,73,.6);color:rgba(248,81,73,.95)}',
    '.pxc-msg{padding:8px 10px;border-radius:6px;font-size:12px;white-space:pre-wrap}',
    '.pxc-msg.ok{background:rgba(46,160,67,.15);border:1px solid rgba(46,160,67,.4)}',
    '.pxc-msg.err{background:rgba(248,81,73,.15);border:1px solid rgba(248,81,73,.4)}',
    '.pxc-msg.info{background:rgba(88,166,255,.13);border:1px solid rgba(88,166,255,.45)}',
    '.pxc-policy{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;opacity:.85;word-break:break-all;display:flex;flex-direction:column;gap:2px}',
    '.pxc-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.pxc-editor{display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));padding-top:10px}',
    '.pxc-empty{border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.45));border-radius:8px;padding:16px;text-align:center;opacity:.7;font-size:12px}',
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
   * Accept the `host:port` spelling the Host accepts, for the same reason:
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

  /** @returns the value when it is a string, else an empty string. */
  function text(value) {
    return typeof value === 'string' ? value : ''
  }

  /** @returns whether the value is a plain record the page can read fields from. */
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
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
   * Preset entries of one resolved config section.
   *
   * @param section - resolved plugin config.
   * @returns the entries that are records.
   */
  function profileList(section) {
    const raw = isRecord(section) && Array.isArray(section.profiles) ? section.profiles : []
    return raw.filter(isRecord)
  }

  /**
   * Effective proxy URL for one scheme, mirroring lib/index.js exactly so the
   * preview on this page cannot disagree with what the Host will install.
   *
   * @param fields - the preset (or legacy) field set.
   * @param scheme - `http` or `https`.
   * @returns the URL that will be used, or an empty string for a direct route.
   */
  function effectiveProxy(fields, scheme) {
    const all = normalizeProxyUrl(fields.allProxy)
    const shared = normalizeProxyUrl(fields.proxy)
    const http = normalizeProxyUrl(fields.httpProxy) || shared || all
    const https = normalizeProxyUrl(fields.httpsProxy) || shared || all || http
    return scheme === 'https' ? https : http
  }

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
    const value = isRecord(section) ? section : {}
    if (value.mode === 'proxy' || value.mode === 'direct' || value.mode === 'off') return value.mode
    return value.enabled === false ? 'off' : 'proxy'
  }

  /** One profile entry normalized for comparison, without internal keys. */
  function compactProfile(entry) {
    const out = { name: text(entry.name).trim() }
    for (const field of OPTIONAL_FIELDS) {
      const value = text(entry[field]).trim()
      if (value !== '') out[field] = value
    }
    out.bypass = entry.bypass.map((item) => String(item).trim()).filter((item) => item !== '')
    return out
  }

  /** One stored profile entry normalized for comparison. */
  function normalizeProfile(entry) {
    return compactProfile({
      name: text(entry.name),
      proxy: text(entry.proxy),
      httpProxy: text(entry.httpProxy),
      httpsProxy: text(entry.httpsProxy),
      allProxy: text(entry.allProxy),
      bypass: bypassList(entry.bypass),
    })
  }

  /**
   * Whether a section still carries the pre-preset top-level fields.
   *
   * @param section - resolved plugin config.
   * @returns whether those fields are worth migrating into a preset.
   */
  function legacyPresent(section) {
    if (profileList(section).length > 0) return false
    if (OPTIONAL_FIELDS.some((field) => text(section?.[field]).trim() !== '')) return true
    return bypassList(section?.bypass).length > 0
  }

  /** Editable mirror of one resolved config section. */
  function toDraft(value) {
    const section = isRecord(value) ? value : {}
    let profiles = profileList(section).map((entry) => ({
      key: nextKey(),
      name: text(entry.name).trim(),
      proxy: text(entry.proxy),
      httpProxy: text(entry.httpProxy),
      httpsProxy: text(entry.httpsProxy),
      allProxy: text(entry.allProxy),
      bypass: bypassList(entry.bypass),
    }))
    let active = text(section.active).trim()

    // The pre-preset format is still what routes traffic, so surface it as one
    // preset: saving from here migrates it into `profiles` and clears the old
    // fields in the same write.
    if (profiles.length === 0 && legacyPresent(section)) {
      profiles = [
        {
          key: nextKey(),
          name: LEGACY_NAME,
          proxy: text(section.proxy),
          httpProxy: text(section.httpProxy),
          httpsProxy: text(section.httpsProxy),
          allProxy: text(section.allProxy),
          bypass: bypassList(section.bypass),
        },
      ]
      active = LEGACY_NAME
    }

    // The active preset is tracked by draft-row key, not by name: a rename
    // (and the transient duplicate names it can create) must never move the
    // activation to whichever row happens to share the name.
    const selected = profiles.find((entry) => entry.name === active) ?? profiles[0]
    return { mode: effectiveMode(section), activeKey: selected === undefined ? null : selected.key, profiles }
  }

  /** Name of the preset routing would install. */
  function activeName(draft) {
    const entry = draft.profiles.find((profile) => profile.key === draft.activeKey) ?? draft.profiles[0]
    return entry === undefined ? '' : entry.name.trim()
  }

  /** The preset routing would install, or null. */
  function activeProfile(draft) {
    const entry = draft.profiles.find((profile) => profile.key === draft.activeKey) ?? draft.profiles[0]
    return entry ?? null
  }

  /**
   * The ordered writes that turn the stored section into the draft.
   *
   * `profiles` is compared as a whole list; a first save that adopts the legacy
   * fields also clears them so the patch keeps a single source of truth.
   *
   * @param draft - edited page state.
   * @param values - resolved config currently stored.
   * @returns path operations for one atomic settings write.
   */
  function buildOps(draft, values) {
    const section = isRecord(values) ? values : {}
    const ops = []
    if (draft.mode !== effectiveMode(section)) {
      ops.push({ op: 'set', path: ['mode'], value: draft.mode })
    }

    const nextProfiles = draft.profiles.map(compactProfile)
    const storedProfiles = profileList(section).map(normalizeProfile)
    if (JSON.stringify(nextProfiles) !== JSON.stringify(storedProfiles)) {
      ops.push(
        nextProfiles.length === 0
          ? { op: 'unset', path: ['profiles'] }
          : { op: 'set', path: ['profiles'], value: nextProfiles },
      )
    }

    const active = activeName(draft)
    const storedActive = text(section.active).trim()
    if (active !== storedActive) {
      ops.push(active === '' ? { op: 'unset', path: ['active'] } : { op: 'set', path: ['active'], value: active })
    }

    if (nextProfiles.length > 0) {
      for (const field of OPTIONAL_FIELDS) {
        if (text(section[field]).trim() !== '') ops.push({ op: 'unset', path: [field] })
      }
      if (bypassList(section.bypass).length > 0) ops.push({ op: 'unset', path: ['bypass'] })
    }
    return ops
  }

  /**
   * Reject a save the Host would accept but that leaves the page ambiguous.
   *
   * @param draft - edited page state.
   * @returns a message, or null when the draft is savable.
   */
  function validate(draft) {
    if (draft.profiles.length === 0) return null
    const names = draft.profiles.map((entry) => entry.name.trim())
    if (names.some((name) => name === '')) return '每套代理都需要一个名称。'
    if (new Set(names).size !== names.length) return '代理名称不能重复，激活项按名称定位。'
    const active = activeName(draft)
    if (active === '') return '至少要激活一套代理。'
    if (draft.mode === 'proxy') {
      const profile = draft.profiles.find((entry) => entry.name.trim() === active)
      if (profile === undefined) return '激活的代理不存在。'
      if (!OPTIONAL_FIELDS.some((field) => profile[field].trim() !== '')) {
        return '被激活的代理还没有地址：填一个 proxy 地址，或切到「全部直连」。'
      }
    }
    return null
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
    const [snapshot, setSnapshot] = useState(() =>
      form === undefined ? { status: 'unavailable' } : form.getSnapshot(),
    )
    useEffect(() => {
      if (form === undefined) return undefined
      setSnapshot(form.getSnapshot())
      return form.subscribe(() => setSnapshot(form.getSnapshot()))
    }, [form])
    return { form, snapshot }
  }

  /** Routing modes the page offers, in display order. */
  const MODE_OPTIONS = [
    { id: 'proxy', label: '走代理', hint: '安装「激活」的那一套代理；其余配置保留但不生效。' },
    { id: 'direct', label: '全部直连', hint: '覆盖启动 dsh 时从 HTTP(S)_PROXY 装的策略，所有出站请求直连。' },
    { id: 'off', label: '不干预', hint: '不安装任何策略，保留 launcher 从启动环境变量装的那一套。' },
  ]

  /**
   * One preset card: radio to activate, summary when idle, inline editor.
   *
   * @param props - entry, active flag, editor state, and callbacks.
   * @returns the card element.
   */
  function PresetCard(props) {
    const { entry, active, editing, writable, busy, onActivate, onToggleEdit, onChange, onDelete } = props
    const [pendingEntry, setPendingEntry] = useState('')
    const [advanced, setAdvanced] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)

    const address = redactProxy(normalizeProxyUrl(entry.proxy)) || '（未设置地址）'

    const addBypass = () => {
      const value = pendingEntry.trim()
      if (value === '' || entry.bypass.includes(value)) {
        setPendingEntry('')
        return
      }
      onChange('bypass', [...entry.bypass, value])
      setPendingEntry('')
    }

    const field = (name, label, hint) =>
      h(
        'label',
        { className: 'pxc-row', key: name },
        h('span', null, label),
        h('input', {
          className: 'pxc-input',
          value: entry[name],
          placeholder: name === 'proxy' ? 'http://127.0.0.1:7890 或 proxy.example:8080' : '留空则回落到上一级',
          spellCheck: false,
          disabled: !writable,
          onChange: (event) => onChange(name, event.target.value),
        }),
        hint !== undefined ? h('small', null, hint) : null,
      )

    return h(
      'div',
      { className: 'pxc-preset ' + (active ? 'active' : 'inactive') },
      h(
        'div',
        { className: 'pxc-preset-head' },
        h('button', {
          type: 'button',
          className: 'pxc-radio',
          role: 'radio',
          'aria-checked': active,
          'aria-label': '激活 ' + (entry.name || '未命名代理'),
          title: active ? '当前生效' : '点击切换为这套代理（立即写入并生效）',
          disabled: !writable || busy,
          onClick: () => onActivate(entry.key),
        }, h('span', { className: 'dot' })),
        h('span', { className: 'pxc-preset-name' }, entry.name || '（未命名）'),
        h('span', { className: 'pxc-chip ' + (active ? 'on' : 'off') }, active ? '生效中' : '未启用'),
        h('span', { className: 'pxc-preset-url' }, address),
        h('span', { className: 'pxc-spacer' }),
        h('button', {
          type: 'button',
          className: 'pxc-btn tiny',
          disabled: !writable,
          onClick: () => {
            setConfirmDelete(false)
            onToggleEdit(editing ? null : entry.key)
          },
        }, editing ? '完成' : '编辑'),
        h('button', {
          type: 'button',
          className: 'pxc-btn tiny danger',
          disabled: !writable || busy,
          onClick: () => {
            if (!confirmDelete) {
              setConfirmDelete(true)
              return
            }
            setConfirmDelete(false)
            onDelete(entry.key)
          },
        }, confirmDelete ? '确认删除' : '删除'),
      ),

      !editing
        ? null
        : h(
            'div',
            { className: 'pxc-editor' },
            field('name', '名称', '激活项按名称定位；改名会同步改 active'),
            field('proxy', 'proxy', '同时作用于 http 和 https；不带 scheme 时自动补 http://'),
            h('button', {
              type: 'button',
              className: 'pxc-btn tiny',
              disabled: !writable,
              onClick: () => setAdvanced((open) => !open),
            }, advanced ? '收起分协议配置' : '分协议配置…'),
            advanced
              ? h(
                  'div',
                  { className: 'pxc-row', style: { gap: '10px' } },
                  field('httpProxy', 'httpProxy', '覆盖 proxy，仅 http:'),
                  field('httpsProxy', 'httpsProxy', '覆盖 proxy，仅 https:'),
                  field('allProxy', 'allProxy', '两种 scheme 的兜底（等价 ALL_PROXY）'),
                )
              : null,
            h(
              'div',
              { className: 'pxc-row' },
              h('span', null, 'bypass（不走代理的域名）'),
              h('div', { className: 'pxc-sub' }, '按子域后缀匹配：.example 同时放行 wiki.example.com；不影响回环地址。'),
              h(
                'div',
                { className: 'pxc-chips' },
                entry.bypass.length === 0
                  ? h('span', { className: 'pxc-sub' }, '（空：只有回环地址直连）')
                  : entry.bypass.map((item) =>
                      h('span', { className: 'pxc-chip', key: item },
                        item,
                        h('button', {
                          type: 'button',
                          title: '删除',
                          disabled: !writable,
                          onClick: () => onChange('bypass', entry.bypass.filter((value) => value !== item)),
                        }, '×'),
                      ),
                    ),
              ),
              h(
                'div',
                { className: 'pxc-add' },
                h('input', {
                  className: 'pxc-input',
                  value: pendingEntry,
                  placeholder: '.example.com 或 example.com:8443，回车添加',
                  spellCheck: false,
                  disabled: !writable,
                  onChange: (event) => setPendingEntry(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addBypass()
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'pxc-btn',
                  disabled: !writable || pendingEntry.trim() === '',
                  onClick: addBypass,
                }, '添加'),
              ),
            ),
          ),
    )
  }

  /** The settings page for this plugin's profile entry. */
  function ProxyPage(props) {
    const ctx = props.ctx
    const { form, snapshot } = useEntryForm(ctx)
    const [draft, setDraft] = useState(null)
    const [draftRevision, setDraftRevision] = useState(null)
    const [editingKey, setEditingKey] = useState(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState(null)

    const revision = snapshot.revision
    const values = isRecord(snapshot.value) ? snapshot.value : null
    const pendingOps = draft === null || values === null ? [] : buildOps(draft, values)

    // Adopt a fresh Host value whenever the revision changes (first read and
    // after every accepted write), unless the local draft still has unwritten
    // edits — an unrelated external write must not swallow them.
    useEffect(() => {
      if (values === null || revision === undefined) return
      if (draftRevision === revision) return
      if (pendingOps.length > 0) return
      setDraft(toDraft(values))
      setDraftRevision(revision)
    }, [revision, values, draftRevision, pendingOps.length])

    /**
     * Write one atomic operation list and report the outcome.
     *
     * @param ops - path operations to submit.
     * @param okText - success message.
     */
    const submit = async (ops, okText) => {
      if (ops.length === 0 || busy || form === undefined) return
      setBusy(true)
      setMessage(null)
      try {
        const accepted = await form.mutate(ops, snapshot.revision)
        setMessage(
          accepted
            ? { kind: 'ok', text: okText }
            : { kind: 'err', text: 'Host 拒绝了这次写入，页面已回读最新配置。' },
        )
      } catch (error) {
        setMessage({ kind: 'err', text: '写入失败：' + String((error && error.message) || error) })
      } finally {
        setBusy(false)
      }
    }

    const setMode = (mode) => () => {
      setDraft((current) => (current === null ? current : { ...current, mode }))
      setMessage(null)
    }

    const setProfileField = (key, field, value) => {
      setDraft((current) => {
        if (current === null) return current
        const profiles = current.profiles.map((entry) => (entry.key === key ? { ...entry, [field]: value } : entry))
        return { ...current, profiles }
      })
      setMessage(null)
    }

    /**
     * Activate one preset: the only write is `active` (plus any staged edits),
     * so switching is one click and one revision.
     *
     * @param key - draft-row key of the preset to install.
     */
    const activate = (key) => {
      if (draft === null || busy) return
      const entry = draft.profiles.find((profile) => profile.key === key)
      if (entry === undefined) return
      const next = { ...draft, activeKey: key, mode: 'proxy' }
      const problem = validate(next)
      if (problem !== null) {
        setMessage({ kind: 'err', text: problem })
        return
      }
      // Adopt the switch locally before writing: otherwise the draft still
      // names the previous preset, the page counts the difference as a pending
      // edit, and the adoption effect refuses the freshly accepted snapshot
      // (leaving a stale card highlighted and a phantom "1 项修改").
      setDraft(next)
      submit(buildOps(next, values), '已切换到「' + entry.name.trim() + '」，代理策略已实时应用（无需重启）。')
    }

    const addProfile = () => {
      if (draft === null) return
      const taken = new Set(draft.profiles.map((entry) => entry.name.trim()))
      let index = draft.profiles.length + 1
      while (taken.has('代理' + index)) index += 1
      const entry = {
        key: nextKey(),
        name: '代理' + index,
        proxy: '',
        httpProxy: '',
        httpsProxy: '',
        allProxy: '',
        bypass: [],
      }
      setDraft({
        ...draft,
        profiles: [...draft.profiles, entry],
        activeKey: draft.activeKey ?? entry.key,
      })
      setEditingKey(entry.key)
      setMessage(null)
    }

    const removeProfile = (key) => {
      setDraft((current) => {
        if (current === null) return current
        const profiles = current.profiles.filter((entry) => entry.key !== key)
        const activeKey = profiles.some((entry) => entry.key === current.activeKey)
          ? current.activeKey
          : profiles.length > 0
            ? profiles[0].key
            : null
        return { ...current, profiles, activeKey }
      })
      setMessage(null)
    }

    const save = () => {
      if (draft === null) return
      const problem = validate(draft)
      if (problem !== null) {
        setMessage({ kind: 'err', text: problem })
        return
      }
      submit(buildOps(draft, values), '已写入 profile patch，策略已实时应用（无需重启）。')
    }

    const reset = () => {
      setDraft(toDraft(values))
      setEditingKey(null)
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
    const writable = snapshot.writable === true
    const active = activeProfile(draft)
    const legacy = values !== null && legacyPresent(values)
    const policy = active === null
      ? null
      : {
          http: redactProxy(effectiveProxy(active, 'http')) || '直连',
          https: redactProxy(effectiveProxy(active, 'https')) || '直连',
          bypass: active.bypass.length,
        }

    return h(
      'div',
      { className: 'pxc-wrap' },
      h('div', null,
        h('h2', { className: 'pxc-title' }, '出站代理'),
        h(
          'div',
          { className: 'pxc-sub' },
          '这里维护多套代理，但同一时间只有一套生效（出站代理是进程级单一路由）。点卡片左侧单选即切换并立即写入，无需重启。',
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
            ? policy === null
              ? [
                  h('span', { key: 'none' }, '没有激活的代理 → 不安装策略（保留启动环境变量装的那一套）'),
                  h('span', { key: 'hint' }, '在下面的列表里点一张卡片的单选钮即可激活'),
                ]
              : [
                  h('span', { key: 'profile' }, '激活 → ' + active.name),
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
        h('h3', null, '代理列表'),
        h('div', { className: 'pxc-sub' },
          '点击卡片左侧的单选钮 = 立即切换（若同时有未保存的修改，会一并提交）。「全部直连 / 不干预」模式下列表仍可编辑，激活任意一套会切回「走代理」。',
        ),
        legacy
          ? h('div', { className: 'pxc-msg info' },
              '检测到旧的顶层 proxy/bypass 配置，已显示为「' + LEGACY_NAME + '」这一套。保存后会把旧字段迁移进代理列表并清掉旧字段。')
          : null,
        draft.profiles.length === 0
          ? h('div', { className: 'pxc-empty' }, '还没有代理配置。点下面的「新增代理」添加第一套。')
          : draft.profiles.map((entry) =>
              h(PresetCard, {
                key: entry.key,
                entry,
                active: proxyActive && (activeProfile(draft) ?? {}).key === entry.key,
                editing: editingKey === entry.key,
                writable,
                busy,
                onActivate: activate,
                onToggleEdit: setEditingKey,
                onChange: (field, value) => setProfileField(entry.key, field, value),
                onDelete: removeProfile,
              }),
            ),
        h('div', { className: 'pxc-actions' },
          h('button', { type: 'button', className: 'pxc-btn', disabled: !writable || busy, onClick: addProfile }, '＋ 新增代理'),
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
