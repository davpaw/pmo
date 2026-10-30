/**
 * HTML escaping for surfaces that render with innerHTML.
 *
 * Every web surface builds its DOM from template literals assigned to
 * innerHTML. That is fine, but it means any value that originated outside the
 * code — a form field, an uploaded file's name, a parsed CSV cell — is markup
 * until it is escaped. Import from here rather than re-implementing per app.
 */

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape a value for interpolation into element *content* or an *attribute*.
 * Quotes are escaped too, so a single function is correct in both positions.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const escapeHtml = (value = '') => {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char])
}

/**
 * Escape a value used as a URL in href/src. Blocks the script-bearing schemes
 * so a stored `javascript:` or `data:text/html` URL cannot execute on click.
 *
 * @param {unknown} value
 * @param {{ allowedSchemes?: string[] }} [options]
 * @returns {string} a safe URL, or '' when the value is not one
 */
export const escapeUrl = (value = '', { allowedSchemes = ['http:', 'https:', 'mailto:', 'tel:'] } = {}) => {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }
  // protocol-relative and root-relative URLs carry no scheme and are safe
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) {
    return escapeHtml(raw)
  }
  let parsed
  try {
    parsed = new URL(raw, 'https://placeholder.invalid')
  } catch {
    return ''
  }
  if (!allowedSchemes.includes(parsed.protocol)) {
    return ''
  }
  return escapeHtml(raw)
}

/**
 * Escape every value in an object one level deep. Useful when handing a parsed
 * record straight to a template.
 *
 * @param {Record<string, unknown>} record
 * @returns {Record<string, string>}
 */
export const escapeRecord = (record = {}) => {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, escapeHtml(value)]))
}
