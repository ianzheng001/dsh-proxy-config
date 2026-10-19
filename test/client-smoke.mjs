/**
 * Smoke test for the browser half without a browser.
 *
 * Two failure modes are worth pinning down here because both bit this project
 * (and its MCP sibling) before:
 *
 * 1. The Web shell concatenates the missing bundles of one boot batch into a
 *    single script, so a top-level binding (`const factory`) in two hand-written
 *    bundles breaks the whole batch. The file must stay inside an IIFE, and two
 *    concatenated copies must compile.
 * 2. The factory has to register both ids and hand the Loader a plugin object
 *    with the declared `inject` list, or Settings renders nothing.
 *
 * @module test/client-smoke
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { ensureDeps } from './link-deps.mjs'

ensureDeps()

const require = createRequire(import.meta.url)
const React = require('react')
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// 1. The bundle stays a self-contained IIFE: no top-level bindings leak into the
//    combo scope, and the double-registration tail is present.
assert.match(source, /^;\(\(\) => \{$/m, 'lib/client.js must wrap the whole bundle in an IIFE')
assert.ok(source.includes('window.__ModuleLoader__.load({ id: \'proxy-config\', factory })'), 'the Loader entry id must be registered')
assert.ok(source.includes('window.__ModuleLoader__.load({ id: \'dsh-proxy-config\', factory })'), 'the package name must be registered too')

// 2. Two bundles of this shape share one combo script and must still compile.
const combo = source + '\n' + source
new vm.Script(combo, { filename: 'combo.js' })

// 3. Materialize the factory the way the platform table does and check the
//    plugin contract Settings relies on.
const registered = new Map()
const sandbox = {
  window: { __ModuleLoader__: { load: ({ id, factory }) => registered.set(id, factory) } },
  URL,
  console,
}
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

assert.deepEqual(
  [...registered.keys()].sort(),
  ['dsh-proxy-config', 'proxy-config'],
  'both ids must be registered',
)

const plugin = registered.get('proxy-config')((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected platform module ${name}`)
})

assert.equal(plugin.name, 'dsh-proxy-config-client')
assert.deepEqual([...plugin.inject], ['slots', 'configForms'], 'the page reads and writes through configForms')
assert.equal(typeof plugin.apply, 'function')

// 4. Applying it registers exactly one settings section on the slots service.
const sections = []
const ctx = {
  slots: {
    inject: (_name, factory) => factory(),
    register: (spec, render) => {
      sections.push({ spec, render })
      return () => {}
    },
  },
}
plugin.apply(ctx)

assert.equal(sections.length, 1, 'exactly one settings.section registration')
assert.equal(sections[0].spec.name, 'settings.section')
assert.equal(sections[0].spec.id, 'outbound-proxy')
assert.equal(sections[0].spec.label, '出站代理')
assert.equal(typeof sections[0].render, 'function')

console.log('proxy-config client smoke: all assertions passed')
