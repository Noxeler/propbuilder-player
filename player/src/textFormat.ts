interface Formatted {
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export function konvaFontStyle(src: Formatted): string {
  const parts: string[] = []
  if (src.italic) parts.push('italic')
  if (src.bold) parts.push('bold')
  return parts.length ? parts.join(' ') : 'normal'
}

export function konvaTextDecoration(src: Formatted): string {
  return src.underline ? 'underline' : ''
}
