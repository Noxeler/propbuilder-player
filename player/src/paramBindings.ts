import type { CanvasElement, Page } from './types'

// Map { elementId → { fieldName → valeur saisie dans l'aperçu } }.
// Le tab Édition collecte ces valeurs en session locale ; l'aperçu les
// applique sur les éléments avant rendu via `applyParamOverrides`.
export type ParamOverrides = Record<string, Record<string, unknown>>

// Renvoie les bindings effectifs d'un élément OU d'une page, en migrant
// au vol l'ancien système (runtimeEditable + runtimeLabel sur élément
// text) vers le nouveau paramBindings['content'] = { name: runtimeLabel }.
// Ne mutate pas l'item : renvoie une Map lisible seulement. Utilisé côté
// UI Édition pour lister les paramètres exposés.
export function getEffectiveParamBindings(
  item: CanvasElement | Page
): Record<string, { name: string }> {
  const out: Record<string, { name: string }> = {
    ...(item.paramBindings ?? {}),
  }
  // Migration : ancien flag runtimeEditable sur text → binding 'content'.
  // Uniquement pertinent pour CanvasElement type='text'. Les pages n'ont
  // jamais eu de runtimeEditable, ce code est no-op pour elles.
  const el = item as CanvasElement
  if (el.type === 'text' && el.runtimeEditable && out.content === undefined) {
    out.content = { name: el.runtimeLabel || 'Texte' }
  }
  return out
}

// Applique les overrides saisis par l'utilisateur sur un élément avant
// rendu. Retourne l'élément inchangé si aucun override. Ne copie que les
// champs qui ont effectivement un override, pour que l'identité
// référentielle soit préservée tant qu'aucune valeur n'est saisie.
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

// Version pour une Page. Même logique que applyParamOverrides, typée
// pour Page afin d'accepter l'override sur entryDuration / entryEasing
// / entryAnimation au niveau page.
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

// Catégorie du champ, utilisée par le tab Édition pour choisir le type
// d'input (textarea vs number + "ms" vs single-char).
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

// Valeur "originale" d'un champ sur un élément — sert d'initial value dans
// l'input Édition et de valeur de reset.
export function originalParamValue(
  el: CanvasElement | Page,
  field: string
): unknown {
  return (el as unknown as Record<string, unknown>)[field]
}

// Indique si le binding sur ce field doit être exposé dans le tab Édition.
// Couvre les bindings orphelins : l'auteur a coché "paramétrable" sur un
// champ, puis a désactivé la fonctionnalité qui pilote ce champ — le
// binding reste silencieusement dans `paramBindings` et continue d'apparaître
// dans le tab Édition avec une valeur 0 / vide qui ne sert à rien.
//
// Centralise ici les règles "champ inactif" plutôt que de les sprinkler
// dans chaque consommateur (PreviewShell, player), pour que toutes les
// surfaces de rendu (web preview, player web, player natif) filtrent
// identiquement.
export function isBindingFieldActive(
  item: CanvasElement | Page,
  field: string
): boolean {
  const v = (item as unknown as Record<string, unknown>)[field]
  switch (field) {
    case 'appearDelay':
      // 0 ou undefined = "Apparaît après un délai" est sur Non côté éditeur.
      return typeof v === 'number' && v > 0
    case 'entryDuration':
      // 0 ou undefined = pas d'animation d'entrée configurée (ou type 'none').
      // entryAnimation 'none' fait qu'entryDuration n'a aucun effet visuel.
      return (
        typeof v === 'number' &&
        v > 0 &&
        (item as CanvasElement | Page).entryAnimation !== undefined &&
        (item as CanvasElement | Page).entryAnimation !== 'none'
      )
    case 'shortcutKey':
      // Champ vide = pas de raccourci configuré.
      return typeof v === 'string' && v.length > 0
    case 'toastDurationMs':
      // Une notif infinie ignore toastDurationMs (toastInfinite=true override).
      // Exposer ce binding induit l'auteur en erreur — la valeur saisie
      // n'aura aucun effet.
      if ((item as CanvasElement).toastInfinite) return false
      return typeof v === 'number' && v > 0
    default:
      return true
  }
}
