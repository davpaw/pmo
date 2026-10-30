/**
 * `html` — an auto-escaping tagged template for innerHTML rendering.
 *
 * Escaping every interpolation by hand works until someone adds the 72nd one
 * and forgets. This inverts the default: values are escaped unless explicitly
 * marked trusted, and nested templates compose without double-escaping.
 *
 *   element.innerHTML = toHtml(html`<td>${record.fileName}</td>`)
 *
 * Arrays flatten, so a list needs no `.join('')`:
 *
 *   html`<tbody>${rows.map((row) => html`<tr><td>${row.name}</td></tr>`)}</tbody>`
 *
 * null / undefined / false render as nothing, which makes conditionals read
 * cleanly:
 *
 *   html`${record.duplicate && html`<span class="flag">duplicate</span>`}`
 */

import { escapeHtml } from './escape.js'

const RAW = Symbol('marketcircle.raw')

/**
 * Mark a string as already-safe markup. Only use this for markup you built,
 * never for a value that came from a file, a form, or storage.
 *
 * @param {unknown} value
 * @returns {{[RAW]: string}}
 */
export const raw = (value) => ({ [RAW]: value === null || value === undefined ? '' : String(value) })

/** @param {unknown} value */
const renderValue = (value) => {
  if (value === null || value === undefined || value === false || value === true) {
    return ''
  }
  if (Array.isArray(value)) {
    return value.map(renderValue).join('')
  }
  if (typeof value === 'object' && RAW in value) {
    return value[RAW]
  }
  return escapeHtml(value)
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {{[RAW]: string}} a trusted-markup marker, not a string — pass it
 *   to `toHtml` (or interpolate it into another `html` template)
 */
export const html = (strings, ...values) => {
  let out = ''
  strings.forEach((chunk, index) => {
    out += chunk
    if (index < values.length) {
      out += renderValue(values[index])
    }
  })
  return raw(out)
}

/**
 * Unwrap an `html` result into a string for innerHTML. Throws on a bare string
 * so an unescaped template cannot be assigned by accident.
 *
 * @param {{[RAW]: string}} value
 * @returns {string}
 */
export const toHtml = (value) => {
  if (value && typeof value === 'object' && RAW in value) {
    return value[RAW]
  }
  throw new TypeError('toHtml expects an html`` template result. Wrap the template in html`` so its values are escaped.')
}

/** True when `value` is trusted markup produced by `html` or `raw`. */
export const isRaw = (value) => Boolean(value && typeof value === 'object' && RAW in value)
