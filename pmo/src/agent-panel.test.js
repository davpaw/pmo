test('panel: selected context and delayed answers retain separate escaped pinned identities', () => {
  const out = render({ open: true, entityContext: { entityId: 'person:new', snapshotIdentity: 'b'.repeat(64) }, messages: [{ role: 'agent', text: 'older answer', entityPin: { entityId: 'person:old', variant: '<unsafe>', snapshotIdentity: 'a'.repeat(64) }, unverified: true }] })
  assert.match(out, /Selected schema context: person:new/)
  assert.match(out, /Answer pinned to person:old/)
  assert.match(out, /&lt;unsafe&gt;/)
  assert.match(out, /data-agent-context-clear/)
  assert.match(out, /citations are not automatic truth/)
})
import test from 'node:test'
import assert from 'node:assert/strict'
import { toHtml } from './ui/index.js'
import { SUGGESTIONS, initialState, renderPanel } from './agent-panel.js'

const render = (patch = {}) => toHtml(renderPanel({ ...initialState(), ...patch }))

const ok = { configured: true, ready: true, usable: true, state: 'ready', model: 'm', issues: [] }

test('panel: a collapsed bar at the bottom with a toggle that reports its state', () => {
  const out = render({ status: ok })
  assert.match(out, /aria-label="Ask the PMO Agent"/)
  assert.match(out, /aria-expanded="false"/)
  assert.match(out, /data-agent-toggle/)
  assert.match(out, /id="agent-body"[^>]*hidden/)
  assert.match(render({ open: true, status: ok }), /aria-expanded="true"/)
})

test('panel: without a model it explains setup and allows local architecture commands', () => {
  const out = render({ open: true, status: { configured: false, issues: ['No model is set. Run: npm run pmo -- agent setup'] } })
  assert.match(out, /npm run pmo -- agent setup/)
  assert.match(out, /Not set up/)
  assert.doesNotMatch(out, /data-agent-input[^>]*disabled/)
})

test('panel: with a ready model it offers starter questions and nothing is disabled', () => {
  const out = render({ open: true, status: { ...ok, model: 'gpt-x' } })
  assert.match(out, /chip-ok">Ready/)
  for (const text of SUGGESTIONS) assert.ok(out.includes(`data-agent-suggest="${text}"`), text)
  assert.ok(!/data-agent-input[^>]*disabled/.test(out))
  assert.match(out, /Nothing typed here can change them/)
})

test('panel: a rejected key is not Ready but local commands remain available', () => {
  const out = render({ open: true, status: { configured: true, ready: false, usable: false, state: 'rejected', model: 'm', issues: ['The model rejected the key or token. Run: npm run pmo -- agent setup'] } })
  assert.match(out, /Key rejected/)
  assert.ok(!/chip-ok/.test(out))
  assert.match(out, /did not accept these settings/)
  assert.match(out, /npm run pmo -- agent setup/)
  assert.doesNotMatch(out, /data-agent-input[^>]*disabled/)
  assert.match(render({ status: { configured: true, ready: false, usable: false, state: 'not_found', model: 'm', issues: [] } }), /Model not found/)
})

test('panel: an unclear check says Not verified but still allows a question', () => {
  const out = render({ open: true, status: { configured: true, ready: false, usable: true, state: 'unverified', model: 'm', issues: ['The model could not be reached.'] } })
  assert.match(out, /Not verified/)
  assert.ok(!/chip-ok/.test(out))
  assert.ok(!/data-agent-input[^>]*disabled/.test(out))
  assert.match(out, /could not be reached/)
})

test('panel: messages and drafts are escaped, never interpreted', () => {
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>'
  const out = render({
    open: true,
    status: ok,
    draft: hostile,
    messages: [{ role: 'user', text: hostile }, { role: 'agent', text: hostile, flagged: true }],
  })
  assert.ok(!out.includes('<img src=x'))
  assert.ok(!out.includes('<script>'))
  assert.ok(out.includes('&lt;img src=x'))
  assert.match(out, /Rules unchanged/)
})

test('panel: the minimize control is an icon button with an accessible name and no visible text', () => {
  const out = render({ status: ok })
  const button = out.match(/<button[^>]*data-agent-minimize[^>]*>([\s\S]*?)<\/button>/)
  assert.ok(button, 'minimize button rendered')
  assert.match(button[0], /aria-label="Minimize the PMO Agent"/)
  assert.match(button[0], /title="Minimize"/)
  assert.match(button[1], /^<svg[^>]*aria-hidden="true"/)
  assert.match(button[1], /stroke="currentColor"/)
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(button[1]), 'no literal colours')
  assert.equal(button[1].replace(/<svg[\s\S]*<\/svg>/, '').trim(), '')
})

test('panel: minimizing leaves a small restore button and no bar, body or form', () => {
  const full = render({ status: ok })
  assert.match(full, /data-agent-minimize/)
  assert.ok(!/data-agent-restore/.test(full))
  const min = render({ status: ok, minimized: true, open: true })
  assert.match(min, /data-agent-restore/)
  assert.match(min, /aria-label="Ask the PMO Agent"/)
  assert.ok(!/data-agent-input|data-agent-minimize|agent-body/.test(min))
})
