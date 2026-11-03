/** A small lexical reader for literal module specifiers; comments and quoted fixture code are data. */
export const importSpecifiers = (source) => {
  const tokens = []
  let at = 0
  const tokenize = (expression = false) => {
    let braces = 0
    while (at < source.length) {
      const c = source[at]
      if (expression && c === '}' && braces === 0) { at++; return }
      if (c === '{') braces++
      if (c === '}') braces--
      if (/\s/.test(c)) { at++; continue }
      if (source.startsWith('//', at)) { at = source.indexOf('\n', at); if (at < 0) break; continue }
      if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue }
      if (c === '/' && (!tokens.length || /^(=|\(|\[|,|:|;|!|\?|\{|return|case)$/.test(tokens.at(-1).value))) {
        at++; let bracket = false
        while (at < source.length) {
          if (source[at] === '\\') { at += 2; continue }
          if (source[at] === '[') bracket = true
          if (source[at] === ']') bracket = false
          if (source[at++] === '/' && !bracket) break
        }
        while (/[a-z]/i.test(source[at] ?? '') && at < source.length) at++
        tokens.push({ type: 'regexp', value: '' }); continue
      }
      if (['"', "'", '`'].includes(c)) {
        const quote = c; let value = ''; let dynamic = false; at++
        while (at < source.length && source[at] !== quote) {
          if (quote === '`' && source.startsWith('${', at)) { dynamic = true; at += 2; tokenize(true); continue }
          if (source[at] !== '\\') { value += source[at++]; continue }
          at++; const escape = source[at++]
          if (escape === '\n') continue
          if (escape === 'u' || escape === 'x') {
            const length = escape === 'u' ? 4 : 2
            const match = escape === 'u' && source[at] === '{' ? /^\{([0-9a-f]+)\}/i.exec(source.slice(at)) : new RegExp(`^([0-9a-f]{${length}})`, 'i').exec(source.slice(at))
            if (match) { value += String.fromCodePoint(parseInt(match[1], 16)); at += match[0].length; continue }
          }
          value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[escape] ?? escape
        }
        at++; tokens.push({ type: dynamic ? 'dynamic' : 'string', value }); continue
      }
      const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(at))
      if (word) { tokens.push({ type: 'word', value: word[0] }); at += word[0].length; continue }
      tokens.push({ type: 'punctuation', value: c }); at++
    }
  }
  tokenize()
  const specs = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (tokens[i - 1]?.value === '.') continue
    if (token.type !== 'word' || !['import', 'export', 'require'].includes(token.value)) continue
    const next = tokens[i + 1]
    if (token.value === 'import' && next?.type === 'string') { specs.push(next.value); continue }
    if (next?.value === '(' && ['import', 'require'].includes(token.value)) {
      const arg = tokens[i + 2]
      specs.push(arg?.type === 'string' && [')', ','].includes(tokens[i + 3]?.value) ? arg.value : null)
      continue
    }
    if (token.value === 'require' || next?.value === '.') continue
    for (let j = i + 1; j < tokens.length && tokens[j].value !== ';'; j++) {
      if (tokens[j].value === 'from' && tokens[j + 1]?.type === 'string') { specs.push(tokens[j + 1].value); break }
    }
  }
  return [...new Set(specs)]
}
