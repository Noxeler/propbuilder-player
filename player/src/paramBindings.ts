import type { CanvasElement, Page } from './types'

// Mirror de src/utils/paramBindings.ts — dupliqué pour garder le Player
// indépendant de l'éditeur (pas d'import cross-package).

export type ParamOverrides = Record<string, Record<string, unknown>>

export function getEffectiveParamBindings(
  item: CanvasElement | Page
): Record<string, { name: string }> {
  const out: Record<string, { name: string }> = {
    ...(item.paramBindings ?? {}),
  }
  const el = item as CanvasElement
  if (el.type === 'text' && el.runtimeEditable && out.content === undefined) {
    out.content = { name: el.runtimeLabel || 'Texte' }
  }
  return out
}

export function applyParamOverrides(
  el: CanvasElement,
  overrides: ParamOverrides
): CanvasElement {
  const fieldOverrides = overrides[el.id]
  if (!fieldOverrides) return el
  const keys = Object.keys(fieldOverrides)
  if (keys.length === 0) return el
  return { ...el, ...fieldOverrides }
}

export function applyPageParamOverrides(
  page: Page,
  overrides: ParamOverrides
): Page {
  const fieldOverrides = overrides[page.id]
  if (!fieldOverrides) return page
  const keys = Object.keys(fieldOverrides)
  if (keys.length === 0) return page
  return { ...page, ...fieldOverrides }
}

export type ParamFieldKind = 'text' | 'duration' | 'key'

export function paramFieldKind(field: string): ParamFieldKind {
  if (field === 'shortcutKey') return 'key'
  if (
    field === 'entryDuration' ||
    field === 'appearDelay' ||
    field === 'toastDurationMs'
  )
    return 'duration'
  return 'text'
}

export function originalParamValue(
  item: CanvasElement | Page,
  field: string
): unknown {
  return (item as unknown as Record<string, unknown>)[field]
}
