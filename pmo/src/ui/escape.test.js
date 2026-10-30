import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, escapeUrl, escapeRecord } from './escape.js'
import { html, raw, toHtml, isRaw } from './html.js'

test('escapeHtml neutralises the five markup characters', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(escapeHtml(`" onfocus="alert(1)`), '&quot; onfocus=&quot;alert(1)')
  assert.equal(escapeHtml("it's"), 'it&#39;s')
  assert.equal(escapeHtml('a & b'), 'a &amp; b')
})

test('escapeHtml escapes ampersands once, not twice', () => {
  // a naive chain of replaceAll calls that runs & last double-encodes
  assert.equal(escapeHtml('<'), '&lt;')
  assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

test('escapeHtml renders nullish as empty, not "undefined"', () => {
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(0), '0')
})

test('escapeUrl blocks script-bearing schemes', () => {
  assert.equal(escapeUrl('javascript:alert(1)'), '')
  assert.equal(escapeUrl('JaVaScRiPt:alert(1)'), '')
  assert.equal(escapeUrl('data:text/html,<script>alert(1)</script>'), '')
  assert.equal(escapeUrl('vbscript:msgbox'), '')
  assert.equal(escapeUrl('  javascript:alert(1)  '), '')
})

test('escapeUrl keeps ordinary URLs', () => {
  assert.equal(escapeUrl('https://example.edu/a?b=1'), 'https://example.edu/a?b=1')
  assert.equal(escapeUrl('mailto:advisor@example.edu'), 'mailto:advisor@example.edu')
  assert.equal(escapeUrl('/local/path'), '/local/path')
  assert.equal(escapeUrl('#section'), '#section')
})

test('escapeRecord escapes every field', () => {
  assert.deepEqual(escapeRecord({ a: '<b>', n: 2 }), { a: '&lt;b&gt;', n: '2' })
})

test('html escapes interpolated values by default', () => {
  const name = '<img src=x onerror=alert(1)>.csv'
  assert.equal(toHtml(html`<td>${name}</td>`),
    '<td>&lt;img src=x onerror=alert(1)&gt;.csv</td>')
})

test('html escapes values in attribute position', () => {
  const search = '" onfocus="alert(1)'
  assert.equal(toHtml(html`<input value="${search}" />`),
    '<input value="&quot; onfocus=&quot;alert(1)" />')
})

test('html composes nested templates without double-escaping', () => {
  const cell = (v) => html`<td>${v}</td>`
  assert.equal(toHtml(html`<tr>${cell('<x>')}</tr>`), '<tr><td>&lt;x&gt;</td></tr>')
})

test('html flattens arrays so lists need no join', () => {
  const rows = ['a', '<b>']
  assert.equal(toHtml(html`<ul>${rows.map((r) => html`<li>${r}</li>`)}</ul>`),
    '<ul><li>a</li><li>&lt;b&gt;</li></ul>')
})

test('html renders nullish and false as nothing', () => {
  assert.equal(toHtml(html`a${null}${undefined}${false}b`), 'ab')
  assert.equal(toHtml(html`${0}`), '0')
})

test('raw opts a trusted fragment out of escaping', () => {
  assert.equal(toHtml(html`${raw('<hr />')}`), '<hr />')
  assert.ok(isRaw(html`x`))
  assert.ok(!isRaw('x'))
})

test('toHtml refuses a bare string so an unescaped template cannot slip through', () => {
  assert.throws(() => toHtml('<b>raw</b>'), TypeError)
})
