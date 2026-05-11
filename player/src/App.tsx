import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Stage, Layer, Group } from 'react-konva'
import type Konva from 'konva'
import { PreviewElement } from './PreviewElement'
import { playSounds } from './soundRegistry'
import { IosToast, type IosToastData } from './IosToast'
import { ExplanationPopup } from './ExplanationPopup'
import { useEntryAnimation } from './useEntryAnimation'
import type {
  Project,
  App as AppType,
  CanvasElement,
  CustomFont,
  TriggerAction,
} from './types'
import { TEMP_PRESETS, DEFAULT_FILTER, type FilterState } from './filterPresets'
import {
  applyParamOverrides,
  applyPageParamOverrides,
  getEffectiveParamBindings,
  isBindingFieldActive,
  paramFieldKind,
  originalParamValue,
  type ParamOverrides,
} from './paramBindings'
// (App.css désormais redondant avec index.css importé depuis main.tsx,
// qui charge Tailwind + les mêmes resets html/body/#root.)

type Tab = 'infos' | 'filtre' | 'edition'

// Référence à un paramètre exposé dans l'aperçu. Peut cibler un
// élément (scope='element') ou une page (scope='page', ex.
// entryDuration au niveau page).
interface PlayerParamBindingRef {
  pageName: string
  scope: 'element' | 'page'
  ownerId: string
  item: CanvasElement | import('./types').Page
  field: string
  name: string
  kind: 'text' | 'duration' | 'key'
}

// Position "hidden" pour un élément cible d'un swipe en mode 'reveal' :
// translaté hors-écran dans la direction opposée au swipe. Ex. swipe='down'
// (on tire depuis le haut) → target translaté vers le haut de son
// encombrement total, bord inférieur à y=0. Le drag interpole de cet offset
// vers {0,0} (position designée sur le canvas).
function computeHiddenOffset(
  direction: 'left' | 'right' | 'up' | 'down',
  targetEl: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number }
): { x: number; y: number } {
  switch (direction) {
    case 'down':
      return { x: 0, y: -(targetEl.y + targetEl.height) }
    case 'up':
      return { x: 0, y: canvas.height - targetEl.y }
    case 'right':
      return { x: -(targetEl.x + targetEl.width), y: 0 }
    case 'left':
      return { x: canvas.width - targetEl.x, y: 0 }
  }
}

// Polices ABSOLUMENT toujours dispos en natif iOS WKWebView, même quand
// le project.json ne les déclare pas explicitement dans project.fonts.
// Si le fontFamily d'un élément matche un de ces noms, pas besoin de
// charger quoi que ce soit, le navigateur les rendra direct.
const SYSTEM_FONT_NAMES = new Set([
  'Arial',
  'Helvetica',
  'Helvetica Neue',
  'Times New Roman',
  'Times',
  'Georgia',
  'Courier New',
  'Courier',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
  'San Francisco',
  'SF Pro Display',
  'SF Pro Text',
  '-apple-system',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
])

// Track des fonts déjà chargées pour éviter les doubles-loads quand
// le projet a plusieurs éléments avec la même fontFamily.
const loadedFontFamilies = new Set<string>()

function appendGoogleFontLink(family: string, weight?: number): void {
  // Sans poids spécifié → on demande 400 ET 700 dans la même requête CSS.
  // Sinon, le rendu bold (Konva fontStyle='bold' → font-weight 700)
  // tombe sur du faux-bold synthétique léger, sensible sur iOS WKWebView.
  const wghtSpec = weight ? String(weight) : '400;700'
  const key = `g:${family}@${wghtSpec}`
  if (loadedFontFamilies.has(key)) return
  loadedFontFamilies.add(key)
  const encoded = family.replace(/\s+/g, '+')
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${wghtSpec}&display=swap`
  document.head.appendChild(link)
}

async function loadCustomFontFace(
  name: string,
  dataUrl: string,
  weight?: number
): Promise<void> {
  // Cache key DOIT inclure le poids — sinon, quand le bundle contient
  // 2 entries pour la même famille (Inter@400 + Inter@700), la 2ème
  // est skippée à cause du cache, et Konva ne trouve pas le poids 700
  // → faux-bold synthétique sur iOS WKWebView (rendu "moins gras").
  const key = `c:${name}:${weight ?? 'any'}`
  if (loadedFontFamilies.has(key)) return
  loadedFontFamilies.add(key)
  try {
    const face = new FontFace(
      name,
      `url(${dataUrl})`,
      weight ? { weight: String(weight) } : {}
    )
    await face.load()
    document.fonts.add(face)
  } catch (err) {
     
    console.warn('[player] custom font load failed', name, weight, err)
  }
}

// Scanne récursivement le projet pour collecter toutes les fontFamily
// utilisées par les éléments texte/livetext (et les autres types qui
// peuvent en porter une, ex: button label).
function collectUsedFontFamilies(project: Project): Set<string> {
  const out = new Set<string>()
  for (const app of project.apps) {
    for (const page of app.pages) {
      for (const el of page.elements) {
        const ff = (el as { fontFamily?: string }).fontFamily
        if (ff && typeof ff === 'string') {
          // Une fontFamily CSS peut être une chaîne avec fallbacks
          // ("Inter, sans-serif") — on garde juste le premier élément.
          const primary = ff.split(',')[0].trim().replace(/^["']|["']$/g, '')
          if (primary) out.add(primary)
        }
      }
    }
  }
  return out
}

// Charge toutes les fonts requises par le projet AVANT de rendre, pour
// éviter le FOUT (flash of unstyled text). Three-tier strategy :
//   1) Polices système (Arial, Helvetica, etc.) → rien à faire.
//   2) Polices déclarées dans project.fonts[] → load explicite (custom
//      via FontFace, google via <link>).
//   3) Polices référencées par fontFamily mais pas dans project.fonts
//      (cas légacy) → on tente Google Fonts en best-effort. Si le nom
//      ne matche pas un Google Font, le <link> retourne une 404 sans
//      casser l'app.
async function loadAllFonts(project: Project): Promise<void> {
  const declared = new Map<string, CustomFont>()
  for (const f of project.fonts ?? []) {
    declared.set(f.name, f)
  }

  const customLoads: Promise<void>[] = []
  for (const f of declared.values()) {
    if (f.source === 'system' || SYSTEM_FONT_NAMES.has(f.name)) continue
    if (f.source === 'google') {
      appendGoogleFontLink(f.name, f.weight)
    } else if (f.dataUrl) {
      // 'custom' ou source non précisé mais dataUrl présent → custom inline
      customLoads.push(loadCustomFontFace(f.name, f.dataUrl, f.weight))
    } else {
      // Source inconnu sans dataUrl : on tente Google Fonts en fallback.
      appendGoogleFontLink(f.name, f.weight)
    }
  }

  // Tier 3 : fontFamily des éléments non couvertes par project.fonts.
  // On suppose que c'est probablement Google Fonts ; si le nom ne matche
  // rien chez Google, le <link> 404 silencieusement et on retombe sur
  // le fallback générique CSS — pas pire qu'avant.
  const used = collectUsedFontFamilies(project)
  for (const family of used) {
    if (SYSTEM_FONT_NAMES.has(family)) continue
    if (declared.has(family)) continue
    appendGoogleFontLink(family)
  }

  // Attendre que les FontFace inline soient prêts.
  await Promise.all(customLoads)
  // Puis attendre les Google Fonts (chargées via <link>). Konva mesure les
  // textes au draw, mais ne re-render PAS spontanément quand une police
  // arrive plus tard via display=swap → l'horloge / les knobs initiaux
  // sont peints avec un fallback aux métriques différentes, puis la
  // vraie police swap et laisse des pixels orphelins (artefacts noirs
  // visibles sur les chiffres « 9:45 » côté natif). En attendant que
  // document.fonts.ready résolve avant le premier setProject, on garantit
  // un render Konva final avec les bonnes métriques de police d'entrée.
  try {
    await document.fonts.ready
  } catch {
    /* navigateurs très anciens : on ignore et on rend avec le fallback */
  }
}

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Path relatif (pas '/project.json') : le player tourne aussi bien
    // depuis un host HTTP(S) que depuis un file:// URL côté iOS Viewer
    // (loadFileURL d'WKWebView). './' marche dans les deux cas.
    fetch('./project.json')
      .then((r) => r.json())
      .then(async (p: Project) => {
        await loadAllFonts(p)
        setProject(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Sur Tauri Android : enable immersive fullscreen au boot pour cacher
  // status bar + nav bar Android (sinon elles mangent ~150px ET la nav
  // bar masque le bas du Stage — APK testé sur Crosscall Core-X4
  // montrait une zone blanche en bas avec barre Android visible).
  // HTML5 Fullscreen API ne touche pas les barres système sous Tauri ;
  // il faut taper dans WindowInsetsController côté Java via setFullscreen.
  // Gate stricte : runtime Tauri ET Android (web/iOS Safari/desktop pas
  // affectés — tauri.conf.json garde sa config window normale).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('__TAURI_INTERNALS__' in window)) return
    if (!/Android/i.test(navigator.userAgent)) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(true))
      .catch((err) => {
        console.warn('[player] setFullscreen failed', err)
      })
  }, [])

  if (error) return <Centered>Erreur : {error}</Centered>
  if (!project) return <Centered>Chargement…</Centered>
  const app = project.apps[0]
  if (!app) return <Centered>Projet vide.</Centered>

  return <PlayerShell project={project} app={app} />
}

function PlayerShell({
  project,
  app,
}: {
  project: Project
  app: AppType
}) {
  const [mode, setMode] = useState<'menu' | 'playing'>('menu')
  // Bridge JS→iOS : poste le mode courant à l'app native PropBuilder
  // Viewer pour qu'elle cache son bouton Fermer en haut-droite quand
  // le projet tourne. window.webkit.messageHandlers est défini par
  // WKWebView via config.userContentController.add(...). Aucun effet
  // dans la PWA Safari (l'objet est undefined → optional chain).
  useEffect(() => {
    type WebKitWindow = {
      webkit?: {
        messageHandlers?: {
          playerState?: { postMessage: (m: unknown) => void }
        }
      }
    }
    const w = window as unknown as WebKitWindow
    w.webkit?.messageHandlers?.playerState?.postMessage(mode)
  }, [mode])
  const [activeTab, setActiveTab] = useState<Tab>('infos')
  const [showExplanations, setShowExplanations] = useState(false)
  const [explanationDismissed, setExplanationDismissed] = useState(false)
  const handleToggleExplanations = (next: boolean) => {
    setShowExplanations(next)
    if (next) setExplanationDismissed(false)
  }
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  // Overrides saisis dans le tab Édition — { elementId → { fieldName → valeur } }.
  // **Persistance localStorage** : scopé par app.id (chaque app a sa clé
  // séparée), survit à fermeture/réouverture/relance du device. Pas de sync
  // cloud — chaque device-prop garde ses valeurs en local. Les overrides
  // orphelins (ownerId/field qui n'existent plus après republication) sont
  // nettoyés en effet plus bas, dès que paramBindingList est stable.
  const paramStorageKey = `pb:params:${app.id}`
  const [paramOverrides, setParamOverrides] = useState<ParamOverrides>(() => {
    try {
      const raw = localStorage.getItem(paramStorageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ParamOverrides
      }
      return {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      if (Object.keys(paramOverrides).length === 0) {
        localStorage.removeItem(paramStorageKey)
      } else {
        localStorage.setItem(paramStorageKey, JSON.stringify(paramOverrides))
      }
    } catch {
      // Quota atteint ou storage désactivé → on ignore. Les overrides
      // resteront en mémoire pour la session courante mais ne survivront
      // pas au reload.
    }
  }, [paramOverrides, paramStorageKey])
  const [currentPageId, setCurrentPageId] = useState<string | null>(
    app.pages[0]?.id ?? null
  )
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  // Ref tracking : la page-cible d'un swipe slide en cours OU récent.
  // Set par le swipe-end handler avant fireAction(setCurrentPageId), lu
  // ensuite par (1) pageAnim qui force type='none' au mount, (2) le useEffect
  // d'init de visibleIds qui inclut les éléments à appearDelay (déjà visibles
  // pendant le drag), (3) le PreviewElement skipEntryAnimation. Cleared
  // seulement quand currentPage.id change AWAY (effet plus bas) — flippe
  // jamais en cours de stay-on-target.
  const skipPageEntryForRef = useRef<string | null>(null)
  // playKey s'incrémente à chaque entrée (ou re-entrée) en mode 'playing'.
  // Inclus dans les runKey de useEntryAnimation (page + éléments) pour
  // que les animations redémarrent depuis zéro à chaque replay, même si
  // on retombe sur la même page avec la même visibility. Mirror PreviewShell.
  const [playKey, setPlayKey] = useState(0)
  useEffect(() => {
    // Wipe les toasts à TOUT changement de mode (les deux sens). On
    // wipe aussi à l'aller (playing → menu) en plus du retour, pour
    // éviter que des toasts en cours résident dans le state pendant
    // que la page de menu est affichée et se ré-injectent au pire
    // moment (race entre setToasts([]) tardif et l'auto-fire de la
    // page-entry, qui faisait survivre certaines notifs entre deux
    // sessions de Play — symptôme : 'des fois la notif n'est pas
    // reset').
    setToasts([])
    if (mode === 'playing') {
      setPlayKey((k) => k + 1)
      // Reset les artefacts du précédent play pour repartir clean :
      // skipPageEntryForRef pourrait pointer sur la page courante depuis
      // le dernier swipe, ce qui ferait skipper l'animation au replay.
      skipPageEntryForRef.current = null
      // Retourne à la page d'accueil. Sans ça, après un swipe vers une
      // page X puis 3-doigts → menu → Play, on reprenait là où on
      // s'était arrêté au lieu de rejouer le projet depuis le début.
      // Skip les pages overlay pour ne pas tomber sur une page vide.
      const overlayIds = new Set<string>()
      for (const pg of app.pages) {
        if (pg.topOverlayPageId) overlayIds.add(pg.topOverlayPageId)
        if (pg.bottomOverlayPageId) overlayIds.add(pg.bottomOverlayPageId)
      }
      if (app.topOverlayPageId) overlayIds.add(app.topOverlayPageId)
      if (app.bottomOverlayPageId) overlayIds.add(app.bottomOverlayPageId)
      const firstRegular =
        app.pages.find((p) => !overlayIds.has(p.id)) ?? app.pages[0]
      if (firstRegular) setCurrentPageId(firstRegular.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  // Tableau (et non `toast | null`) pour qu'une notif infinie puisse
  // coexister avec une notif éphémère qui apparaît ensuite — sans la
  // remplacer. Chaque entrée a un id unique généré par toastCounterRef.
  const [toasts, setToasts] = useState<Array<{
    data: IosToastData
    durationMs: number
    // onTap : callback déclenché au clic sur la carte du toast. Permet
    // de composer flexiblement (action ET/OU navigation) selon ce que
    // l'élément source définit. Stocké ici plutôt que dans IosToastData
    // pour ne pas polluer le type qui sert aussi au preview/drag.
    onTap?: () => void
    // Id de l'élément source — sert à dédupliquer : si la même notif
    // est rejouée (shortcut, re-trigger), on retire l'instance précédente
    // avant d'ajouter la nouvelle, sinon une notif infinie persisterait
    // en doublon.
    sourceElementId?: string
  }>>([])
  const toastCounterRef = useRef(0)
  const dismissToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.data.id !== id))
  const [liveTexts, setLiveTexts] = useState<Record<string, string>>({})
  const [focusedLiveId, setFocusedLiveId] = useState<string | null>(null)
  const [scrollY, setScrollY] = useState(0)
  const touchStartRef = useRef<{ y: number; scroll: number } | null>(null)

  const currentPage = app.pages.find((p) => p.id === currentPageId) ?? null

  // Ensemble des IDs d'éléments image pilotés par un déclencheur livetext :
  // ils démarrent toujours masqués et n'apparaissent que si leur déclencheur
  // gagne le match de préfixe (voir effet plus bas). Mirror de PreviewShell.
  const triggerTargetIds = useMemo(() => {
    const ids = new Set<string>()
    if (!currentPage) return ids
    for (const el of currentPage.elements) {
      if (el.type !== 'livetext' || !el.imageTriggers) continue
      for (const t of el.imageTriggers) {
        if (t.targetElementId) ids.add(t.targetElementId)
      }
    }
    return ids
  }, [currentPage])

  const pageCanvasHeight = Math.max(
    1,
    currentPage?.canvasHeight ?? app.resolution.height
  )
  const maxScrollY = Math.max(0, pageCanvasHeight - app.resolution.height)
  const isScrollable = currentPage?.canvasHeight !== undefined

  useEffect(() => {
    setScrollY(0)
  }, [mode, currentPageId])

  // Reset reveal state à chaque changement de page (ou sortie/entrée Play) —
  // les éléments révélés précédemment sont à nouveau cachés à l'arrivée sur
  // la page, prêts à être révélés à nouveau par le swipe.
  useEffect(() => {
    setRevealedElementIds(new Set())
  }, [mode, currentPageId])

  useEffect(() => {
    if (mode === 'playing') setExplanationDismissed(false)
  }, [mode])

  useEffect(() => {
    if (mode !== 'playing' || !currentPage) return
    // Quand on arrive sur cette page via un swipe slide, l'utilisateur a
    // déjà vu la page complète glisser devant ses yeux pendant 260ms —
    // les éléments à appearDelay y étaient déjà visibles (pré-poppés par
    // l'effet sur slideIncoming). Re-jouer leur cascade au mount serait
    // redondant et casserait le visuel. Mirror PreviewShell.tsx ligne 415.
    const arrivedViaSlide =
      skipPageEntryForRef.current === currentPage.id
    const initial = new Set<string>()
    for (const el of currentPage.elements) {
      if (el.hidden) continue
      if (el.type === 'toast') continue
      // Les images pilotées par un livetext démarrent toujours masquées ;
      // c'est l'effet de prefix-match qui décidera laquelle s'affiche.
      if (triggerTargetIds.has(el.id)) continue
      if (el.hiddenInitially) continue
      // Cas normal : pas d'appearDelay → visible direct.
      // Cas slide : on inclut les éléments à appearDelay aussi, ils sont
      // déjà visibles depuis le drag.
      if (
        !(el.appearDelay && el.appearDelay > 0) ||
        arrivedViaSlide
      ) {
        initial.add(el.id)
      }
    }
    setVisibleIds(initial)
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const el of currentPage.elements) {
      if (el.hidden) continue
      if (el.type === 'toast') {
        // hiddenInitially : le toast n'apparaît pas tout seul au
        // démarrage de la page — il attend d'être déclenché via un
        // onClickAction, un raccourci clavier ou une TriggerAction
        // depuis un autre élément. Évite le cas frustrant où plusieurs
        // toasts à délai=0 s'empilent à t=0.
        if (el.hiddenInitially) continue
        // En arrivée par slide, on skip les toasts à appearDelay aussi
        // (ils auraient déjà fait leur entrée pendant le drag).
        if (arrivedViaSlide && (el.appearDelay ?? 0) > 0) continue
        const delay = el.appearDelay ?? 0
        const t = setTimeout(() => {
          showToast(
            {
              title: el.toastTitle,
              message: el.content ?? '',
              iconDataUrl: el.toastIconDataUrl,
              timestamp: el.toastTimestamp,
              x: el.width > 0 ? el.x : undefined,
              y: el.width > 0 ? el.y : undefined,
              width: el.width > 0 ? el.width : undefined,
              height: el.width > 0 && el.height > 0 ? el.height : undefined,
              direction: el.toastDirection,
              fontScale: el.toastFontScale ? el.toastFontScale / 100 : undefined,
              infinite: el.toastInfinite || undefined,
            },
            el.toastDurationMs ?? 4500,
            buildToastOnTap(el),
            el.id
          )
        }, delay)
        timers.push(t)
        continue
      }
      if (el.hiddenInitially) continue
      if (!el.appearDelay || el.appearDelay <= 0) continue
      // Skip le timer pour les éléments déjà inclus en initial via le
      // chemin arrivedViaSlide.
      if (arrivedViaSlide) continue
      const t = setTimeout(() => {
        setVisibleIds((s) => {
          const next = new Set(s)
          next.add(el.id)
          return next
        })
      }, el.appearDelay)
      timers.push(t)
    }
    return () => timers.forEach(clearTimeout)
  }, [mode, currentPage?.id, currentPage])

  // Prefix-match : à chaque changement de `liveTexts`, pour chaque livetext
  // avec des imageTriggers, on cherche le déclencheur dont `text` est le plus
  // long préfixe de ce qui est tapé. On affiche sa target et masque les
  // autres targets du même groupe. Mirror de PreviewShell.
  useEffect(() => {
    if (mode !== 'playing' || !currentPage) return
    const livetexts = currentPage.elements.filter(
      (e) => e.type === 'livetext' && (e.imageTriggers?.length ?? 0) > 0
    )
    if (livetexts.length === 0) return
    setVisibleIds((prev) => {
      const next = new Set(prev)
      for (const lt of livetexts) {
        const typed = liveTexts[lt.id] ?? ''
        const triggers = lt.imageTriggers ?? []
        const groupTargets = new Set(
          triggers.map((t) => t.targetElementId).filter(Boolean)
        )
        let winner: string | null = null
        let winnerLen = -1
        for (const t of triggers) {
          if (!t.targetElementId) continue
          if (typed.startsWith(t.text) && t.text.length > winnerLen) {
            winner = t.targetElementId
            winnerLen = t.text.length
          }
        }
        for (const id of groupTargets) {
          if (id === winner) next.add(id)
          else next.delete(id)
        }
      }
      return next
    })
  }, [mode, currentPage, liveTexts])

  const showToast = (
    data: Omit<IosToastData, 'id'>,
    durationMs = 4500,
    onTap?: () => void,
    sourceElementId?: string
  ) => {
    const id = ++toastCounterRef.current
    setToasts((prev) => {
      // Dédup par source : retire l'instance courante si la même notif
      // est rejouée. Sinon une notif infinie déclenchée 2× resterait
      // en doublon visuel.
      const filtered = sourceElementId
        ? prev.filter((t) => t.sourceElementId !== sourceElementId)
        : prev
      return [
        ...filtered,
        { data: { id, ...data }, durationMs, onTap, sourceElementId },
      ]
    })
  }

  // Compose le onTap d'un toast déclenché depuis un élément source
  // (toast élément, ou shortcut sur cet élément, ou appearDelay timer).
  // Mirror PreviewShell : on respecte src.onClickAction puis src.targetPageId
  // en fallback. Renvoie undefined si l'élément n'a aucune action — le
  // toast sera juste dismissable au tap.
  const buildToastOnTap = (src: CanvasElement): (() => void) | undefined => {
    if (src.onClickAction) {
      const a = src.onClickAction
      return () => executeAction(a)
    }
    if (src.targetPageId) {
      const target = src.targetPageId
      return () => {
        if (app.pages.some((p) => p.id === target)) {
          setCurrentPageId(target)
        }
      }
    }
    return undefined
  }

  const executeAction = (action: TriggerAction) => {
    switch (action.type) {
      case 'toast':
        showToast(
          {
            message: action.message,
            title: action.title,
            iconDataUrl: action.iconDataUrl,
            timestamp: action.timestamp,
          },
          action.durationMs ?? 4500
        )
        break
      case 'show':
        setVisibleIds((s) => {
          const next = new Set(s)
          action.targetElementIds.forEach((id) => next.add(id))
          return next
        })
        break
      case 'hide':
        setVisibleIds((s) => {
          const next = new Set(s)
          action.targetElementIds.forEach((id) => next.delete(id))
          return next
        })
        break
      case 'toggle':
        setVisibleIds((s) => {
          const next = new Set(s)
          action.targetElementIds.forEach((id) => {
            if (next.has(id)) next.delete(id)
            else next.add(id)
          })
          return next
        })
        break
      case 'sound':
        playSounds(action.targetElementIds)
        break
    }
  }

  const paramBindingList = useMemo((): PlayerParamBindingRef[] => {
    const out: PlayerParamBindingRef[] = []
    for (const page of app.pages) {
      // Page-level
      const pageBindings = getEffectiveParamBindings(page)
      for (const [field, meta] of Object.entries(pageBindings)) {
        if (!isBindingFieldActive(page, field)) continue
        out.push({
          pageName: page.name,
          scope: 'page',
          ownerId: page.id,
          item: page,
          field,
          name: meta.name,
          kind: paramFieldKind(field),
        })
      }
      for (const el of page.elements) {
        const bindings = getEffectiveParamBindings(el)
        for (const [field, meta] of Object.entries(bindings)) {
          if (!isBindingFieldActive(el, field)) continue
          out.push({
            pageName: page.name,
            scope: 'element',
            ownerId: el.id,
            item: el,
            field,
            name: meta.name,
            kind: paramFieldKind(field),
          })
        }
      }
    }
    return out
  }, [app.pages])

  // Nettoyage des overrides orphelins : si l'éditeur a renommé/supprimé
  // un binding entre deux publications, les anciennes entrées dans
  // paramOverrides (et donc dans localStorage) ne matchent plus rien.
  // On les filtre dès que paramBindingList est stable.
  useEffect(() => {
    setParamOverrides((current) => {
      if (Object.keys(current).length === 0) return current
      const validFields = new Map<string, Set<string>>()
      for (const b of paramBindingList) {
        if (!validFields.has(b.ownerId)) validFields.set(b.ownerId, new Set())
        validFields.get(b.ownerId)!.add(b.field)
      }
      let changed = false
      const next: ParamOverrides = {}
      for (const [ownerId, fields] of Object.entries(current)) {
        const allowed = validFields.get(ownerId)
        if (!allowed) {
          changed = true
          continue
        }
        const cleanFields: Record<string, unknown> = {}
        for (const [f, v] of Object.entries(fields)) {
          if (allowed.has(f)) cleanFields[f] = v
          else changed = true
        }
        if (Object.keys(cleanFields).length > 0) next[ownerId] = cleanFields
      }
      return changed ? next : current
    })
  }, [paramBindingList])

  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  })

  useEffect(() => {
    const h = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  // Geste 3 doigts × 3 taps = retour menu (utile en mode playing sur
  // touchscreen).
  //
  // Évolution du geste :
  //   v1 : e.touches.length === 3 sur 1 touchstart → ratait souvent
  //   v2 : 3 doigts en fenêtre 80ms × 3 taps → user devait s'y reprendre
  //   v3 : 3 doigts en fenêtre 150ms × 2 taps → trop facile à déclencher
  //        par accident pendant une démo prolongée
  //   v4 (actuel) : 3 doigts en fenêtre 150ms × 3 taps + cancel auto du
  //                 swipe single-finger qui aurait pu démarrer
  //
  // 3 taps : assez délibéré pour éviter les faux positifs (un test
  // utilisateur appuie naturellement sur l'écran à plusieurs reprises),
  // tout en restant accessible.
  useEffect(() => {
    let recentDigitAdds: number[] = []
    let tapTimes: number[] = []
    const onTouchStart = (e: TouchEvent) => {
      const now = Date.now()
      // Dès que 2+ doigts touchent l'écran, on annule un éventuel
      // swipe single-finger en cours. L'utilisateur est probablement
      // en train de poser 3 doigts pour le geste menu — sans cancel,
      // le 1er doigt avait déjà initié un swipe-to-page (cf swipe
      // pointermove handler global) que l'utilisateur ne voulait pas.
      if (e.touches.length >= 2) {
        if (swipeAnimRef.current !== null) {
          cancelAnimationFrame(swipeAnimRef.current)
          swipeAnimRef.current = null
        }
        swipeDragRef.current = null
        setActiveSwipeId(null)
        setSwipeOffset({ x: 0, y: 0 })
      }
      // Compte chaque nouveau doigt qui vient de toucher l'écran.
      for (let i = 0; i < e.changedTouches.length; i++) {
        recentDigitAdds.push(now)
      }
      // Fenêtre 150 ms pour reconnaître 3 doigts décalés comme un seul
      // tap collectif. 150 ms est tolérant (l'utilisateur a le temps de
      // poser ses doigts naturellement) sans risquer de mélanger 2 taps
      // séparés (intervalle minimum entre 2 taps humains > 200ms).
      recentDigitAdds = recentDigitAdds.filter((t) => now - t < 150)
      if (recentDigitAdds.length >= 3) {
        recentDigitAdds = []
        // Garde-fou : on n'enregistre un tap collectif que si le
        // précédent date d'au moins 120ms (sinon les 3 doigts qui
        // arrivent en succession rapide pourraient être comptés comme
        // 2 taps consécutifs et fausser le compteur).
        const lastTap = tapTimes[tapTimes.length - 1] ?? 0
        if (now - lastTap < 120) return
        tapTimes = tapTimes.filter((t) => now - t < 2000)
        tapTimes.push(now)
        if (tapTimes.length >= 3) {
          tapTimes = []
          setMode('menu')
        }
      }
    }
    window.addEventListener('touchstart', onTouchStart)
    return () => window.removeEventListener('touchstart', onTouchStart)
     
  }, [])

  // Escape pour sortir sur desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode === 'playing') setMode('menu')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Quand on quitte le mode playing, on sort aussi du fullscreen (cas
  // 3-doigts × 3 ou Escape qui n'aurait pas été intercepté par le
  // navigateur). Sur iOS Safari mobile, document.fullscreenElement est
  // toujours null et exitFullscreen n'existe pas — no-op silencieux.
  useEffect(() => {
    if (mode === 'playing') return
    const doc = document as Document & {
      webkitFullscreenElement?: Element
      webkitExitFullscreen?: () => Promise<void>
    }
    const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement
    if (!fsEl) return
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen
    if (exit) {
      try {
        const p = exit.call(doc)
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch {
        // ignore
      }
    }
  }, [mode])

  // Raccourcis clavier (mirror de PreviewShell). Ignoré si livetext focusé
  // ou si l'utilisateur tape dans un input HTML (onglet Édition).
  // Scanne currentPage + overlays (page-level + app-level) — un toast
  // dans un overlay header doit pouvoir être déclenché depuis n'importe
  // quelle page. Cas spéciaux pour toast/sound/video qui sont jamais
  // dans visibleIds (toast = virtuel, sound = sans visuel, video peut
  // être cachée mais shortcutable).
  useEffect(() => {
    if (mode !== 'playing' || !currentPage) return
    const onKey = (e: KeyboardEvent) => {
      if (focusedLiveId) return
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return
      if (e.key.length !== 1) return
      const key = e.key.toLowerCase()

      // Récolte page courante + overlays — pour le shortcut on inclut
      // les éléments des overlays (les toasts globaux y vivent souvent).
      const findP = (id: string | undefined) =>
        id ? app.pages.find((p) => p.id === id) : null
      const headerP = findP(currentPage.topOverlayPageId) ?? findP(app.topOverlayPageId)
      const footerP = findP(currentPage.bottomOverlayPageId) ?? findP(app.bottomOverlayPageId)
      const seen = new Set<string>()
      const overlayPages = [headerP, footerP].filter(
        (p): p is NonNullable<typeof p> => {
          if (!p) return false
          if (p.id === currentPage.id) return false
          if (seen.has(p.id)) return false
          seen.add(p.id)
          return true
        }
      )
      const allElements = [
        ...currentPage.elements,
        ...overlayPages.flatMap((p) => p.elements),
      ]
      for (const el of allElements) {
        if (el.shortcutKey !== key) continue
        // Cas spéciaux : sound / video. Le shortcut joue (ou rejoue)
        // directement la cible — visibleIds est by-passé (un son n'a
        // pas de visuel et une vidéo cachée peut quand même être
        // déclenchée selon l'intention auteur).
        if (el.type === 'sound') {
          playSounds([el.id])
          continue
        }
        if (el.type === 'video') {
          // Note : pas de toggleVideos dans le player Tauri actuel.
          // playSounds suffit pour les vidéos audio-only ; pour les
          // vraies vidéos, il faut un videoRegistry comme côté éditeur
          // (à ajouter quand le besoin se présente).
          continue
        }
        // Toast : la touche déclenche le toast (PAS son onClickAction
        // qui est pour le clic SUR le toast). On clear l'éventuel
        // timer d'apparition pour éviter le double-affichage.
        if (el.type === 'toast') {
          showToast(
            {
              title: el.toastTitle,
              message: el.content ?? '',
              iconDataUrl: el.toastIconDataUrl,
              timestamp: el.toastTimestamp,
              x: el.width > 0 ? el.x : undefined,
              y: el.width > 0 ? el.y : undefined,
              width: el.width > 0 ? el.width : undefined,
              height: el.width > 0 && el.height > 0 ? el.height : undefined,
              direction: el.toastDirection,
              fontScale: el.toastFontScale ? el.toastFontScale / 100 : undefined,
              infinite: el.toastInfinite || undefined,
            },
            el.toastDurationMs ?? 4500,
            buildToastOnTap(el),
            el.id
          )
          continue
        }
        if (!visibleIds.has(el.id)) continue
        if (el.onClickAction) {
          executeAction(el.onClickAction)
        } else if (el.targetPageId) {
          setCurrentPageId(el.targetPageId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentPage, focusedLiveId, visibleIds])

  // Flèches gauche / droite : navigation directe entre pages (skip
  // les interactions). Utile pour rejouer rapidement une séquence sans
  // refaire tous les hotspots / swipes / shortcuts. On parcourt les
  // pages "régulières" (non-overlay) dans l'ordre `app.pages`. Clamp
  // aux bornes (pas de wrap), ignoré quand un livetext est focus ou
  // qu'on tape dans un input HTML.
  useEffect(() => {
    if (mode !== 'playing' || !currentPage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (focusedLiveId) return
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return
      const overlayIds = new Set<string>()
      for (const pg of app.pages) {
        if (pg.topOverlayPageId) overlayIds.add(pg.topOverlayPageId)
        if (pg.bottomOverlayPageId) overlayIds.add(pg.bottomOverlayPageId)
      }
      if (app.topOverlayPageId) overlayIds.add(app.topOverlayPageId)
      if (app.bottomOverlayPageId) overlayIds.add(app.bottomOverlayPageId)
      const regularPages = app.pages.filter((p) => !overlayIds.has(p.id))
      if (regularPages.length === 0) return
      const idx = regularPages.findIndex((p) => p.id === currentPage.id)
      if (idx < 0) return
      const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1
      if (nextIdx < 0 || nextIdx >= regularPages.length) return
      e.preventDefault()
      // skipPageEntryForRef.current = pageId → useEntryAnimation reçoit
      // type='none' au mount → pas de fondu ni de slide, switch instantané.
      skipPageEntryForRef.current = regularPages[nextIdx].id
      setCurrentPageId(regularPages[nextIdx].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentPage, focusedLiveId])

  const canvasScale = useMemo(() => {
    const sx = size.w / app.resolution.width
    const sy = size.h / app.resolution.height
    return Math.min(sx, sy)
  }, [size, app.resolution])

  const canvasW = app.resolution.width * canvasScale
  const canvasH = app.resolution.height * canvasScale

  const filterStyle =
    filter.hex && filter.opacity > 0
      ? {
          backgroundColor: filter.hex,
          opacity: filter.opacity / 100,
          mixBlendMode: 'multiply' as const,
        }
      : null

  const handleHotspot = (el: CanvasElement) => {
    if (el.onClickAction) {
      executeAction(el.onClickAction)
      return
    }
    if (el.targetPageId && app.pages.some((p) => p.id === el.targetPageId)) {
      setCurrentPageId(el.targetPageId)
    }
  }

  // Swipe (mirror de PreviewShell web). Mode 'slide' = la page suit le
  // doigt puis glisse hors écran (ou revient à 0). Mode 'reveal' = un
  // élément ciblé glisse depuis hors-écran vers sa position designée.
  // Mode 'none' = fire à la détection au release.
  const swipeDragRef = useRef<{
    el: CanvasElement
    startX: number
    startY: number
  } | null>(null)
  const [swipeOffset, setSwipeOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  })
  const [activeSwipeId, setActiveSwipeId] = useState<string | null>(null)

  // slideIncoming : détecte la page de destination d'un swipe slide
  // en cours (mirror PreviewShell). Sert de signal pour pré-populer
  // visibleIds avec les éléments entrants.
  const slideIncoming = useMemo(() => {
    if (!currentPage || !activeSwipeId) return null
    const activeEl = currentPage.elements.find((e) => e.id === activeSwipeId)
    if (!activeEl) return null
    if ((activeEl.swipeStyle ?? 'zone') !== 'zone') return null
    if ((activeEl.swipeTransition ?? 'none') !== 'slide') return null
    const ax = swipeOffset.x
    const ay = swipeOffset.y
    const horizontal = Math.abs(ax) > Math.abs(ay) && Math.abs(ax) > 4
    const vertical = !horizontal && Math.abs(ay) > 4
    let dir: 'left' | 'right' | 'up' | 'down' | null = null
    if (horizontal) dir = ax > 0 ? 'right' : 'left'
    else if (vertical) dir = ay > 0 ? 'down' : 'up'
    if (!dir) return null
    const perDir = activeEl.swipeDirectionalActions?.[dir]
    const targetId = perDir?.targetPageId ?? activeEl.targetPageId
    if (!targetId || targetId === currentPage.id) return null
    const target = app.pages.find((p) => p.id === targetId)
    if (!target) return null
    return { page: target, dir }
  }, [currentPage, activeSwipeId, swipeOffset.x, swipeOffset.y, app.pages])

  // Pré-populate visibleIds avec les éléments de la page entrante dès
  // que slideIncoming est détecté. Sans ça, au switch de currentPage,
  // visibleIds reste celui de la page sortante pendant un frame → les
  // éléments de la nouvelle page rendraient visible=false → unmount →
  // remount-with-fresh-state → replay des animations d'entrée. Inclut
  // les éléments à appearDelay : ils sont visibles pendant le glissement.
  useEffect(() => {
    if (!slideIncoming) return
    const idsToAdd = slideIncoming.page.elements
      .filter((el) => !el.hidden && el.type !== 'toast')
      .map((el) => el.id)
    if (idsToAdd.length === 0) return
    setVisibleIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of idsToAdd) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [slideIncoming])

  const swipeAnimRef = useRef<number | null>(null)
  // Ref sur le Stage Konva pour pouvoir convertir les coords écran en
  // coords canvas (forward-tap quand un swipe couvre des hotspots dessous).
  const stageRef = useRef<Konva.Stage>(null)

  // Éléments déjà révélés (ancrés à leur position designée) sur la page
  // courante. Reset à chaque changement de page — si l'utilisateur revient,
  // l'élément est à nouveau caché. Utilisé par le rendu pour décider si un
  // reveal-target est à sa position finale (ancré) ou à son offset caché.
  const [revealedElementIds, setRevealedElementIds] = useState<Set<string>>(
    new Set()
  )

  const handleSwipeStart = (
    el: CanvasElement,
    clientX: number,
    clientY: number
  ) => {
    if (swipeAnimRef.current !== null) {
      cancelAnimationFrame(swipeAnimRef.current)
      swipeAnimRef.current = null
    }
    swipeDragRef.current = { el, startX: clientX, startY: clientY }
    setActiveSwipeId(el.id)
    setSwipeOffset({ x: 0, y: 0 })
  }

  useEffect(() => {
    if (mode !== 'playing') return
    const SWIPE_THRESHOLD_PX = 40
    const clampDelta = (
      dir: 'left' | 'right' | 'up' | 'down',
      dx: number,
      dy: number
    ) => {
      switch (dir) {
        case 'right':
          return { x: Math.max(0, dx), y: 0 }
        case 'left':
          return { x: Math.min(0, dx), y: 0 }
        case 'down':
          return { x: 0, y: Math.max(0, dy) }
        case 'up':
          return { x: 0, y: Math.min(0, dy) }
      }
    }
    const animateTo = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      durationMs: number,
      onDone: () => void
    ) => {
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs)
        const eased = 1 - Math.pow(1 - t, 3)
        setSwipeOffset({
          x: fromX + (toX - fromX) * eased,
          y: fromY + (toY - fromY) * eased,
        })
        if (t < 1) {
          swipeAnimRef.current = requestAnimationFrame(tick)
        } else {
          swipeAnimRef.current = null
          onDone()
        }
      }
      swipeAnimRef.current = requestAnimationFrame(tick)
    }
    // Directions autorisées (multi-direction prévaut sur single).
    const enabledDirs = (
      el: CanvasElement
    ): ('left' | 'right' | 'up' | 'down')[] => {
      if (Array.isArray(el.swipeDirections) && el.swipeDirections.length > 0) {
        return el.swipeDirections
      }
      return [el.swipeDirection ?? 'right']
    }
    const clampMulti = (
      dirs: ('left' | 'right' | 'up' | 'down')[],
      dx: number,
      dy: number
    ) => {
      let best: 'left' | 'right' | 'up' | 'down' | null = null
      let bestMag = 0
      for (const d of dirs) {
        let mag = 0
        if (d === 'right') mag = dx > 0 ? dx : 0
        else if (d === 'left') mag = dx < 0 ? -dx : 0
        else if (d === 'down') mag = dy > 0 ? dy : 0
        else mag = dy < 0 ? -dy : 0
        if (mag > bestMag) {
          bestMag = mag
          best = d
        }
      }
      if (!best) return { x: 0, y: 0 }
      return clampDelta(best, dx, dy)
    }

    const onMove = (e: PointerEvent) => {
      const drag = swipeDragRef.current
      if (!drag) return
      const style = drag.el.swipeStyle ?? 'zone'
      const transition = drag.el.swipeTransition ?? 'none'
      if (
        style !== 'knob' &&
        transition !== 'slide' &&
        transition !== 'reveal' &&
        transition !== 'card'
      )
        return
      const rawDx = e.clientX - drag.startX
      const rawDy = e.clientY - drag.startY
      const dirs = enabledDirs(drag.el)
      const primary = dirs[0] ?? 'right'
      const allowMulti =
        style !== 'knob' &&
        dirs.length > 1 &&
        (transition === 'card' || transition === 'slide' || transition === 'none')
      const { x, y } = allowMulti
        ? clampMulti(dirs, rawDx, rawDy)
        : clampDelta(primary, rawDx, rawDy)
      const scale = canvasScale || 1
      let canvasX = x / scale
      let canvasY = y / scale
      if (style === 'knob') {
        const pad = 6
        let knobW = drag.el.height - pad * 2
        let knobH = drag.el.width - pad * 2
        if (drag.el.swipeKnobElementId) {
          const knobEl = currentPage?.elements.find(
            (e2) => e2.id === drag.el.swipeKnobElementId
          )
          if (knobEl) {
            knobW = knobEl.width
            knobH = knobEl.height
          }
        }
        const travelX = Math.max(0, drag.el.width - knobW - pad * 2)
        const travelY = Math.max(0, drag.el.height - knobH - pad * 2)
        if (primary === 'right') canvasX = Math.min(canvasX, travelX)
        if (primary === 'left') canvasX = Math.max(canvasX, -travelX)
        if (primary === 'down') canvasY = Math.min(canvasY, travelY)
        if (primary === 'up') canvasY = Math.max(canvasY, -travelY)
      } else if (transition === 'reveal') {
        const targetId = drag.el.swipeRevealElementId
        const target = targetId
          ? (currentPage?.elements.find((e2) => e2.id === targetId) ?? null)
          : null
        if (target) {
          const hidden = computeHiddenOffset(primary, target, app.resolution)
          const hMagX = Math.abs(hidden.x)
          const hMagY = Math.abs(hidden.y)
          if (primary === 'right') canvasX = Math.min(canvasX, hMagX)
          if (primary === 'left') canvasX = Math.max(canvasX, -hMagX)
          if (primary === 'down') canvasY = Math.min(canvasY, hMagY)
          if (primary === 'up') canvasY = Math.max(canvasY, -hMagY)
        }
      }
      setSwipeOffset({ x: canvasX, y: canvasY })
    }
    const detectWinning = (
      dirs: ('left' | 'right' | 'up' | 'down')[],
      dx: number,
      dy: number
    ): 'left' | 'right' | 'up' | 'down' | null => {
      let best: 'left' | 'right' | 'up' | 'down' | null = null
      let bestMag = SWIPE_THRESHOLD_PX - 1
      for (const d of dirs) {
        let mag = 0
        if (d === 'right') mag = dx > 0 ? dx : 0
        else if (d === 'left') mag = dx < 0 ? -dx : 0
        else if (d === 'down') mag = dy > 0 ? dy : 0
        else mag = dy < 0 ? -dy : 0
        const dominates =
          d === 'right' || d === 'left' ? mag > Math.abs(dy) : mag > Math.abs(dx)
        if (dominates && mag > bestMag) {
          bestMag = mag
          best = d
        }
      }
      return best
    }

    // Cherche un élément cliquable (hotspot ou élément avec action) sous
    // la position écran, en respectant le z-order (du plus haut au plus
    // bas dans le tableau elements). Skippe l'élément swipe lui-même.
    // Utilisé pour forwarder un tap "raté" quand un swipe couvre les
    // hotspots dessous (sans cette passerelle, le swipe absorbe les taps
    // de Crusher / boutons d'app et l'utilisateur a l'impression que les
    // boutons ne marchent pas).
    const findClickableUnder = (
      clientX: number,
      clientY: number,
      excludeId: string
    ): CanvasElement | null => {
      const stage = stageRef.current
      if (!stage || !currentPage) return null
      const rect = stage.container().getBoundingClientRect()
      const cx = (clientX - rect.left) / canvasScale
      const cy = (clientY - rect.top) / canvasScale + scrollY
      const hitsRect = (el: CanvasElement) =>
        cx >= el.x &&
        cx <= el.x + el.width &&
        cy >= el.y &&
        cy <= el.y + el.height
      const hitsCircle = (el: CanvasElement) => {
        const rx = el.width / 2
        const ry = el.height / 2
        const ddx = (cx - (el.x + rx)) / rx
        const ddy = (cy - (el.y + ry)) / ry
        return ddx * ddx + ddy * ddy <= 1
      }
      const isClickable = (el: CanvasElement) =>
        el.type === 'hotspot' ||
        !!el.targetPageId ||
        !!el.onClickAction
      // 1) Overlays (overlay haut / bas) — rendus au-dessus de la page
      const overlayPages: typeof app.pages = []
      const seen = new Set<string>()
      for (const id of [
        currentPage.topOverlayPageId,
        app.topOverlayPageId,
        currentPage.bottomOverlayPageId,
        app.bottomOverlayPageId,
      ]) {
        if (!id || seen.has(id) || id === currentPage.id) continue
        seen.add(id)
        const pg = app.pages.find((p) => p.id === id)
        if (pg) overlayPages.push(pg)
      }
      for (const pg of overlayPages) {
        const els = pg.elements
        for (let i = els.length - 1; i >= 0; i--) {
          const el = els[i]
          if (el.id === excludeId || el.hidden) continue
          if (!isClickable(el)) continue
          if (!hitsRect(el)) continue
          if (el.type === 'hotspot' && el.hotspotShape === 'circle' && !hitsCircle(el)) continue
          return el
        }
      }
      // 2) Page courante
      const els = currentPage.elements
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i]
        if (el.id === excludeId || el.hidden) continue
        if (!isClickable(el)) continue
        if (!hitsRect(el)) continue
        if (el.type === 'hotspot' && el.hotspotShape === 'circle' && !hitsCircle(el)) continue
        return el
      }
      return null
    }

    const onUp = (e: PointerEvent) => {
      const drag = swipeDragRef.current
      if (!drag) return
      swipeDragRef.current = null
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const dirs = enabledDirs(drag.el)
      const primary = dirs[0] ?? 'right'
      const style = drag.el.swipeStyle ?? 'zone'
      const transition = drag.el.swipeTransition ?? 'none'

      // Tap (mouvement < threshold) : on cherche un cliquable dessous et on
      // y forwarde l'event. Évite que le swipe full-screen absorbe les taps
      // sur les boutons de la page (cas des grilles d'icônes type SpringBoard).
      const isTap =
        Math.abs(dx) < SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_THRESHOLD_PX
      if (isTap) {
        const tapped = findClickableUnder(e.clientX, e.clientY, drag.el.id)
        if (tapped) {
          setSwipeOffset({ x: 0, y: 0 })
          setActiveSwipeId(null)
          handleHotspot(tapped)
          return
        }
      }

      // Fire action pour la direction gagnante (per-direction en priorité,
      // sinon fallback sur l'action générique de l'élément).
      const fireAction = (winningDir: 'left' | 'right' | 'up' | 'down') => {
        const perDir = drag.el.swipeDirectionalActions?.[winningDir]
        if (perDir) {
          if (perDir.action) executeAction(perDir.action)
          else if (
            perDir.targetPageId &&
            app.pages.some((p) => p.id === perDir.targetPageId)
          ) {
            setCurrentPageId(perDir.targetPageId)
          }
          return
        }
        handleHotspot(drag.el)
      }

      if (style === 'knob') {
        const pad = 6
        let knobW = drag.el.height - pad * 2
        let knobH = drag.el.width - pad * 2
        if (drag.el.swipeKnobElementId) {
          const knobEl = currentPage?.elements.find(
            (e2) => e2.id === drag.el.swipeKnobElementId
          )
          if (knobEl) {
            knobW = knobEl.width
            knobH = knobEl.height
          }
        }
        const travel = Math.max(
          1,
          primary === 'left' || primary === 'right'
            ? drag.el.width - knobW - pad * 2
            : drag.el.height - knobH - pad * 2
        )
        const mag =
          primary === 'right' || primary === 'left'
            ? Math.abs(swipeOffset.x)
            : Math.abs(swipeOffset.y)
        const ok = mag >= travel * 0.75
        if (ok) {
          const endX =
            primary === 'right' ? travel : primary === 'left' ? -travel : 0
          const endY =
            primary === 'down' ? travel : primary === 'up' ? -travel : 0
          animateTo(swipeOffset.x, swipeOffset.y, endX, endY, 120, () => {
            setSwipeOffset({ x: 0, y: 0 })
            setActiveSwipeId(null)
            handleHotspot(drag.el)
          })
        } else {
          animateTo(swipeOffset.x, swipeOffset.y, 0, 0, 200, () => {
            setActiveSwipeId(null)
          })
        }
        return
      }

      const winning = detectWinning(dirs, dx, dy)

      if (transition === 'card') {
        if (winning) {
          const exitX =
            winning === 'right'
              ? app.resolution.width * 1.2
              : winning === 'left'
                ? -app.resolution.width * 1.2
                : 0
          const exitY =
            winning === 'down'
              ? app.resolution.height * 1.2
              : winning === 'up'
                ? -app.resolution.height * 1.2
                : 0
          animateTo(swipeOffset.x, swipeOffset.y, exitX, exitY, 260, () => {
            setSwipeOffset({ x: 0, y: 0 })
            setActiveSwipeId(null)
            fireAction(winning)
          })
        } else {
          animateTo(swipeOffset.x, swipeOffset.y, 0, 0, 220, () => {
            setActiveSwipeId(null)
          })
        }
        return
      }

      if (transition === 'reveal') {
        if (winning) {
          const targetId = drag.el.swipeRevealElementId
          if (targetId) {
            setRevealedElementIds((prev) => {
              const next = new Set(prev)
              next.add(targetId)
              return next
            })
          }
          setSwipeOffset({ x: 0, y: 0 })
          setActiveSwipeId(null)
          fireAction(winning)
        } else {
          animateTo(swipeOffset.x, swipeOffset.y, 0, 0, 200, () => {
            setActiveSwipeId(null)
          })
        }
        return
      }
      if (transition !== 'slide') {
        setSwipeOffset({ x: 0, y: 0 })
        setActiveSwipeId(null)
        if (winning) fireAction(winning)
        return
      }
      if (winning) {
        const exitX =
          winning === 'right'
            ? app.resolution.width
            : winning === 'left'
              ? -app.resolution.width
              : 0
        const exitY =
          winning === 'down'
            ? app.resolution.height
            : winning === 'up'
              ? -app.resolution.height
              : 0
        // Calcule la page cible AVANT la nav et arme le skip pour qu'au
        // moment où setCurrentPageId switch sur la cible, son
        // entryAnimation soit court-circuitée (la page a déjà glissé
        // visuellement, pas besoin de la re-animer).
        const perDir = drag.el.swipeDirectionalActions?.[winning]
        const targetIdForSkip = perDir?.targetPageId ?? drag.el.targetPageId
        if (targetIdForSkip && targetIdForSkip !== currentPage?.id) {
          skipPageEntryForRef.current = targetIdForSkip
        }
        animateTo(swipeOffset.x, swipeOffset.y, exitX, exitY, 260, () => {
          setSwipeOffset({ x: 0, y: 0 })
          setActiveSwipeId(null)
          fireAction(winning)
        })
      } else {
        animateTo(swipeOffset.x, swipeOffset.y, 0, 0, 200, () => {
          setActiveSwipeId(null)
        })
      }
    }
    const onCancel = () => {
      swipeDragRef.current = null
      setSwipeOffset({ x: 0, y: 0 })
      setActiveSwipeId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, canvasScale, app.resolution.width, app.resolution.height, swipeOffset.x, swipeOffset.y])

  // Reset livetexts sur entrée Play / changement de page + auto-focus
  useEffect(() => {
    if (mode !== 'playing' || !currentPage) {
      setLiveTexts({})
      setFocusedLiveId(null)
      return
    }
    setLiveTexts({})
    const firstLive = currentPage.elements.find(
      (e) =>
        e.type === 'livetext' &&
        !e.hidden &&
        (e.liveFocusMode ?? 'auto') === 'auto'
    )
    setFocusedLiveId(firstLive?.id ?? null)
  }, [mode, currentPage?.id, currentPage])

  // Handler clavier livetext focusé
  useEffect(() => {
    if (mode !== 'playing' || !focusedLiveId || !currentPage) return
    const el = currentPage.elements.find((e) => e.id === focusedLiveId)
    if (!el || el.type !== 'livetext') return
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable)
        return
      if (e.key === 'Escape') {
        setFocusedLiveId(null)
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        setLiveTexts((s) => ({
          ...s,
          [focusedLiveId]: (s[focusedLiveId] ?? '').slice(0, -1),
        }))
        return
      }
      const mode_ = el.liveMode ?? 'free'

      // Enter = touche de validation. En mode libre, toute pression sur
      // Entrée déclenche l'action si elle est définie (et remplace alors
      // l'ajout du saut de ligne). En mode scripté, l'action se déclenche
      // uniquement après que le texte prédéfini soit entièrement tapé.
      const fireEnterAction = () => {
        if (el.onEnterAction) {
          executeAction(el.onEnterAction)
          return true
        }
        if (
          el.enterTargetPageId &&
          app.pages.some((p) => p.id === el.enterTargetPageId)
        ) {
          setCurrentPageId(el.enterTargetPageId)
          return true
        }
        return false
      }

      if (e.key === 'Enter') {
        if (mode_ === 'scripted') {
          const current = liveTexts[focusedLiveId] ?? ''
          const script = el.liveScriptedText ?? ''
          if (current.length >= script.length) {
            if (fireEnterAction()) {
              e.preventDefault()
              return
            }
          }
          // Sinon on laisse tomber dans la branche scripted ci-dessous
          // (Enter fait avancer le script comme n'importe quelle touche).
        } else {
          if (fireEnterAction()) {
            e.preventDefault()
            return
          }
          // Pas d'action : fall-through vers l'ajout de '\n'.
        }
      }

      if (mode_ === 'scripted') {
        if (e.key.length > 1 && e.key !== 'Enter') return
        e.preventDefault()
        const script = el.liveScriptedText ?? ''
        setLiveTexts((s) => {
          const current = s[focusedLiveId] ?? ''
          if (current.length >= script.length) return s
          return { ...s, [focusedLiveId]: script.slice(0, current.length + 1) }
        })
      } else {
        let ch = ''
        if (e.key.length === 1) ch = e.key
        else if (e.key === 'Enter') ch = '\n'
        else return
        e.preventDefault()
        setLiveTexts((s) => ({
          ...s,
          [focusedLiveId]: (s[focusedLiveId] ?? '') + ch,
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // liveTexts dans les deps pour que `fireEnterAction` voie la longueur
    // actuelle du texte tapé en mode scripté (détection "script terminé").
  }, [mode, focusedLiveId, currentPage, liveTexts, app.pages])

  const handleAnimationEnd = (el: CanvasElement) => {
    if (el.onAnimationEnd) {
      executeAction(el.onAnimationEnd)
      return
    }
    if (
      el.animationEndTargetPageId &&
      app.pages.some((p) => p.id === el.animationEndTargetPageId)
    ) {
      setCurrentPageId(el.animationEndTargetPageId)
    }
  }

  // Applique les overrides paramBindings au niveau page (entryDuration
  // etc.) avant de lire les valeurs pour l'animation d'entrée.
  const effectivePage = currentPage
    ? applyPageParamOverrides(currentPage, paramOverrides)
    : null
  // skipPageEntryForRef est déclaré en haut du composant pour qu'il soit
  // accessible par l'effet d'init visibleIds (qui doit savoir si on
  // arrive via slide pour inclure les éléments à appearDelay sans timer).
  const skipPageAnim =
    !!skipPageEntryForRef.current &&
    skipPageEntryForRef.current === currentPage?.id
  const pageAnim = useEntryAnimation({
    type: skipPageAnim ? 'none' : effectivePage?.entryAnimation,
    duration: effectivePage?.entryDuration,
    easing: effectivePage?.entryEasing,
    runKey: `page:${currentPage?.id ?? ''}:${playKey}`,
    active: mode === 'playing' && !!currentPage,
    onDone: () => {
      if (!effectivePage) return
      if (effectivePage.onAnimationEnd) {
        executeAction(effectivePage.onAnimationEnd)
      } else if (
        effectivePage.animationEndTargetPageId &&
        app.pages.some(
          (p) => p.id === effectivePage.animationEndTargetPageId
        )
      ) {
        setCurrentPageId(effectivePage.animationEndTargetPageId)
      }
    },
  })

  // Clear le skip ref UNIQUEMENT quand on quitte la page cible. Si on
  // flippe `type` (none → réelle) pendant qu'on est encore sur la même
  // page, useEntryAnimation re-run et l'animation rejoue depuis zéro
  // (le bug observé). Cf. PreviewShell pour la même logique.
  useEffect(() => {
    if (
      skipPageEntryForRef.current &&
      currentPage &&
      skipPageEntryForRef.current !== currentPage.id
    ) {
      skipPageEntryForRef.current = null
    }
  }, [currentPage?.id])

  if (mode === 'playing') {
    return (
      <div
        className="w-screen h-screen flex items-center justify-center relative overflow-hidden"
        style={{
          backgroundColor: currentPage?.backgroundColor ?? '#ffffff',
          // Toujours 'none' sur mobile : 'auto' laisse le navigateur retenir
          // le touch 100-200ms pour tap/scroll disambiguation et batch les
          // `pointermove`, ce qui casse la détection de swipe. En 'none' on
          // reçoit les events en temps réel ; le scroll de page est déjà
          // géré manuellement via onWheel + onTouchStart/onTouchMove.
          touchAction: 'none',
        }}
        onWheel={(e) => {
          if (!isScrollable) return
          setScrollY((y) =>
            Math.max(0, Math.min(maxScrollY, y + e.deltaY / canvasScale))
          )
        }}
        onTouchStart={(e) => {
          if (!isScrollable || e.touches.length !== 1) return
          touchStartRef.current = {
            y: e.touches[0].clientY,
            scroll: scrollY,
          }
        }}
        onTouchMove={(e) => {
          if (!isScrollable || !touchStartRef.current) return
          const dy =
            (touchStartRef.current.y - e.touches[0].clientY) / canvasScale
          setScrollY(
            Math.max(
              0,
              Math.min(maxScrollY, touchStartRef.current.scroll + dy)
            )
          )
        }}
        onTouchEnd={() => {
          touchStartRef.current = null
        }}
      >
        {currentPage ? (
          <Stage
            ref={stageRef}
            width={canvasW}
            height={canvasH}
            scaleX={canvasScale}
            scaleY={canvasScale}
          >
            <Layer y={-scrollY}>
              <Group
                // Clé stable sur page.id : le slideIncoming Group ci-dessous
                // a sa propre key={incomingPage.id}. Quand le swipe se
                // termine et currentPage flip de A→B, React reconcile par
                // key — le Group entrant (key=B) prend la place du Group
                // courant (key=A unmount). Son fiber tree est préservé,
                // donc les hooks (useEntryAnimation) gardent leur état au
                // lieu d'être démontés-remontés. C'est ce qui empêche
                // l'animation d'entrée de rejouer après le slide. Sans
                // cette key, React utilise position et tout repart à zéro.
                key={currentPage.id}
                x={(() => {
                  const activeEl = currentPage?.elements.find(
                    (el) => el.id === activeSwipeId
                  )
                  const applyPageSlide =
                    !!activeEl &&
                    (activeEl.swipeStyle ?? 'zone') === 'zone' &&
                    (activeEl.swipeTransition ?? 'none') === 'slide'
                  return (
                    app.resolution.width / 2 +
                    pageAnim.offsetX +
                    (applyPageSlide ? swipeOffset.x : 0)
                  )
                })()}
                y={(() => {
                  const activeEl = currentPage?.elements.find(
                    (el) => el.id === activeSwipeId
                  )
                  const applyPageSlide =
                    !!activeEl &&
                    (activeEl.swipeStyle ?? 'zone') === 'zone' &&
                    (activeEl.swipeTransition ?? 'none') === 'slide'
                  return (
                    app.resolution.height / 2 +
                    pageAnim.offsetY +
                    (applyPageSlide ? swipeOffset.y : 0)
                  )
                })()}
                offsetX={app.resolution.width / 2}
                offsetY={app.resolution.height / 2}
                scaleX={pageAnim.scale}
                scaleY={pageAnim.scale}
                opacity={pageAnim.opacity}
              >
                {(() => {
                  // Pré-calcul : pour chaque element id cible d'un swipe en
                  // mode 'reveal' sur cette page, on mappe vers le swipe
                  // correspondant. Sert à positionner le target en
                  // hors-écran au render + à interpoler pendant le drag.
                  const revealTargets = new Map<string, CanvasElement>()
                  for (const el of currentPage.elements) {
                    if (
                      el.type === 'swipe' &&
                      (el.swipeTransition ?? 'none') === 'reveal' &&
                      el.swipeRevealElementId
                    ) {
                      revealTargets.set(el.swipeRevealElementId, el)
                    }
                  }
                  const getRevealOffset = (
                    el: CanvasElement
                  ): { x: number; y: number } => {
                    const swipe = revealTargets.get(el.id)
                    if (!swipe) return { x: 0, y: 0 }
                    // Ancré après un reveal réussi → position designée.
                    if (revealedElementIds.has(el.id)) return { x: 0, y: 0 }
                    const dir = swipe.swipeDirection ?? 'right'
                    const hidden = computeHiddenOffset(dir, el, app.resolution)
                    // Pas le swipe actif → target à sa position cachée.
                    if (swipe.id !== activeSwipeId) return hidden
                    // Active drag : hidden → 0 proportionnel au drag.
                    const hiddenMag =
                      dir === 'right' || dir === 'left'
                        ? Math.abs(hidden.x)
                        : Math.abs(hidden.y)
                    if (hiddenMag < 1) return { x: 0, y: 0 }
                    const dragMag =
                      dir === 'right' || dir === 'left'
                        ? Math.abs(swipeOffset.x)
                        : Math.abs(swipeOffset.y)
                    const progress = Math.min(1, dragMag / hiddenMag)
                    return {
                      x: hidden.x * (1 - progress),
                      y: hidden.y * (1 - progress),
                    }
                  }
                  // ---- Card mode : on cherche l'élément swipe 'card' de
                  // la page indépendamment du drag en cours, pour que
                  // l'arbre React reste STABLE qu'on soit ou non en train
                  // de dragger. Sinon les éléments internes à la carte
                  // passeraient de siblings du Layer à enfants d'un Group
                  // au touchdown, et leurs animations d'entrée
                  // rejoueraient à chaque pose de doigt.
                  const activeSwipe = currentPage.elements.find(
                    (e) => e.id === activeSwipeId
                  )
                  const cardSwipeEl = currentPage.elements.find(
                    (e) =>
                      (e.swipeTransition ?? 'none') === 'card' &&
                      (e.swipeStyle ?? 'zone') !== 'knob' &&
                      e.swipeRevealElementId
                  )
                  const isCardActive =
                    !!cardSwipeEl && activeSwipeId === cardSwipeEl.id
                  const cardTargetId = cardSwipeEl?.swipeRevealElementId ?? null
                  const isBadgeActive =
                    !!activeSwipe &&
                    ((activeSwipe.swipeTransition ?? 'none') === 'card' ||
                      (activeSwipe.swipeTransition ?? 'none') === 'slide') &&
                    (activeSwipe.swipeStyle ?? 'zone') !== 'knob'
                  const CARD_THRESHOLD_CANVAS = 40 / (canvasScale || 1)
                  const badgeOpacities: Record<string, number> = {}
                  if (isBadgeActive && activeSwipe) {
                    const prog = (axis: 'x' | 'y', sign: 1 | -1) => {
                      const v = axis === 'x' ? swipeOffset.x : swipeOffset.y
                      const signed = sign * v
                      if (signed <= 0) return 0
                      return Math.min(1, signed / CARD_THRESHOLD_CANVAS)
                    }
                    if (activeSwipe.swipeBadgeRightElementId) {
                      badgeOpacities[activeSwipe.swipeBadgeRightElementId] =
                        prog('x', 1)
                    }
                    if (activeSwipe.swipeBadgeLeftElementId) {
                      badgeOpacities[activeSwipe.swipeBadgeLeftElementId] =
                        prog('x', -1)
                    }
                    if (activeSwipe.swipeBadgeUpElementId) {
                      badgeOpacities[activeSwipe.swipeBadgeUpElementId] =
                        prog('y', -1)
                    }
                  }
                  const cardTilt =
                    isCardActive && activeSwipe?.swipeTilt
                      ? Math.max(
                          -15,
                          Math.min(
                            15,
                            (swipeOffset.x / app.resolution.width) * 30
                          )
                        )
                      : 0
                  const cardEl = cardTargetId
                    ? currentPage.elements.find(
                        (c) => c.id === cardTargetId
                      ) ?? null
                    : null
                  const isInCard = (el: CanvasElement) => {
                    if (!cardEl) return false
                    const cx = el.x + el.width / 2
                    const cy = el.y + el.height / 2
                    return (
                      cx >= cardEl.x &&
                      cx <= cardEl.x + cardEl.width &&
                      cy >= cardEl.y &&
                      cy <= cardEl.y + cardEl.height
                    )
                  }
                  // Knob custom : élément désigné qui suit le doigt
                  // dans les limites de la pilule (offset déjà clampé).
                  const knobTargetId =
                    activeSwipe &&
                    (activeSwipe.swipeStyle ?? 'zone') === 'knob' &&
                    activeSwipe.swipeKnobElementId
                      ? activeSwipe.swipeKnobElementId
                      : null
                  const renderOne = (el: CanvasElement) => {
                    const off = getRevealOffset(el)
                    const effEl = applyParamOverrides(el, paramOverrides)
                    const badgeOp = badgeOpacities[el.id]
                    const elForRender =
                      badgeOp !== undefined
                        ? { ...effEl, opacity: badgeOp }
                        : effEl
                    const isKnob =
                      knobTargetId && el.id === knobTargetId
                    const knobDx = isKnob ? swipeOffset.x : 0
                    const knobDy = isKnob ? swipeOffset.y : 0
                    return (
                      <Group
                        key={el.id}
                        x={off.x + knobDx}
                        y={off.y + knobDy}
                      >
                        <PreviewElement
                          element={elForRender}
                          onHotspotClick={handleHotspot}
                          visible={visibleIds.has(el.id)}
                          pageKey={`${currentPage?.id ?? ''}:${playKey}`}
                          onAnimationEnd={handleAnimationEnd}
                          liveTypedText={liveTexts[el.id]}
                          liveFocused={focusedLiveId === el.id}
                          onLiveFocus={(id) => setFocusedLiveId(id)}
                          onSwipeStart={handleSwipeStart}
                          activeSwipeId={activeSwipeId}
                          swipeOffset={swipeOffset}
                          // Note : on ne passe PAS skipEntryAnimation ici
                          // (laissé à false). Le user veut que les
                          // entry animations des éléments (zoom-in,
                          // fade-in, etc.) JOUENT à l'arrivée par slide,
                          // mais sans la cascade des appearDelay (qui
                          // est gérée séparément par visibleIds pre-pop
                          // + arrivedViaSlide → tous visibles d'un
                          // coup). skipPageAnim reste utilisé seulement
                          // pour pageAnim (zoom global de la page) qui
                          // serait redondant avec le slide visuel.
                        />
                      </Group>
                    )
                  }
                  // Toujours rendre la même structure partition dès
                  // qu'une carte existe — stable entre repos et drag.
                  if (cardEl) {
                    const pivotX = cardEl.x + cardEl.width / 2
                    const pivotY = cardEl.y + cardEl.height / 2
                    const inside: CanvasElement[] = []
                    const outside: CanvasElement[] = []
                    for (const el of currentPage.elements) {
                      if (isInCard(el)) inside.push(el)
                      else outside.push(el)
                    }
                    return (
                      <>
                        {outside.map(renderOne)}
                        <Group
                          key="__card-group__"
                          x={pivotX + (isCardActive ? swipeOffset.x : 0)}
                          y={pivotY + (isCardActive ? swipeOffset.y : 0)}
                          offsetX={pivotX}
                          offsetY={pivotY}
                          rotation={isCardActive ? cardTilt : 0}
                        >
                          {inside.map(renderOne)}
                        </Group>
                      </>
                    )
                  }
                  return currentPage.elements.map(renderOne)
                })()}
              </Group>
              {/* Group entrant pendant un swipe slide — la page cible
                  glisse depuis l'extérieur en miroir de la page courante,
                  donnant le visuel iOS-native de page push. Mirror
                  PreviewShell.tsx ligne 1862. Skip explicitement les
                  entry animations puisque l'utilisateur voit la page
                  arriver via le slide. */}
              {slideIncoming && (() => {
                const ax = swipeOffset.x
                const ay = swipeOffset.y
                let incomingX = 0
                let incomingY = 0
                if (slideIncoming.dir === 'right')
                  incomingX = -app.resolution.width + ax
                else if (slideIncoming.dir === 'left')
                  incomingX = app.resolution.width + ax
                else if (slideIncoming.dir === 'down')
                  incomingY = -app.resolution.height + ay
                else if (slideIncoming.dir === 'up')
                  incomingY = app.resolution.height + ay
                const incomingPage = slideIncoming.page
                return (
                  <Group
                    key={incomingPage.id}
                    x={app.resolution.width / 2 + incomingX}
                    y={app.resolution.height / 2 + incomingY}
                    offsetX={app.resolution.width / 2}
                    offsetY={app.resolution.height / 2}
                  >
                    {incomingPage.elements
                      .filter((el) => el.type !== 'toast' && !el.hidden)
                      .map((el) => {
                        const effEl = applyParamOverrides(el, paramOverrides)
                        // CRITIQUE : on wrap chaque PreviewElement dans
                        // un <Group key={el.id} x={0} y={0}> pour matcher
                        // EXACTEMENT la structure produite par le Group
                        // courant (qui wrap pareil pour pouvoir poser
                        // un offset reveal/knob — ici 0 car la page
                        // entrante n'a pas de swipe actif). Sans ce
                        // wrapping, la profondeur de l'arbre est
                        // différente entre incoming et current → React
                        // ne reconcile PAS les fibers au flip → remount
                        // des PreviewElement → useEntryAnimation
                        // re-démarre depuis 0 → animation rejoue.
                        // Mirror PreviewShell.tsx ligne 2183.
                        return (
                          <Group key={el.id} x={0} y={0}>
                            <PreviewElement
                              element={effEl}
                              onHotspotClick={() => {}}
                              visible={visibleIds.has(el.id)}
                              pageKey={`${incomingPage.id}:${playKey}`}
                            />
                          </Group>
                        )
                      })}
                  </Group>
                )
              })()}
            </Layer>
            {/* Overlay layer — header & footer rendus par-dessus la page,
                indépendants du scroll vertical et de la transition swipe
                slide entre pages. Override : page-level masque app-level
                pour chaque rôle. */}
            {(() => {
              const findP = (id: string | undefined) =>
                id ? app.pages.find((p) => p.id === id) : null
              // Cumul : page-level d'abord (en bas), app-level
              // par-dessus. L'overlay général reste donc toujours
              // visible même quand une page a son propre overlay.
              // Mirror PreviewShell — changement 2026-05-05 (revert
              // override → cumul à la demande user).
              const headerPageOverlay = findP(currentPage?.topOverlayPageId)
              const footerPageOverlay = findP(currentPage?.bottomOverlayPageId)
              // App-level overlay peut être masqué sur certaines pages
              // spécifiques (configuré dans l'éditeur PropertiesPanel
              // section "Visibilité" d'un overlay app-level).
              const hiddenHeader = new Set(app.topOverlayHiddenOnPageIds ?? [])
              const hiddenFooter = new Set(app.bottomOverlayHiddenOnPageIds ?? [])
              const headerAppOverlay =
                currentPage && hiddenHeader.has(currentPage.id)
                  ? null
                  : findP(app.topOverlayPageId)
              const footerAppOverlay =
                currentPage && hiddenFooter.has(currentPage.id)
                  ? null
                  : findP(app.bottomOverlayPageId)
              const seen = new Set<string>()
              const overlayPages = [
                headerPageOverlay,
                footerPageOverlay,
                headerAppOverlay,
                footerAppOverlay,
              ].filter(
                (p): p is NonNullable<typeof p> => {
                  if (!p) return false
                  if (p.id === currentPage?.id) return false
                  if (seen.has(p.id)) return false
                  seen.add(p.id)
                  return true
                }
              )
              if (overlayPages.length === 0) return null
              return (
                <Layer>
                  {overlayPages.flatMap((pg) =>
                    pg.elements.map((el) => {
                      const effEl = applyParamOverrides(el, paramOverrides)
                      return (
                        <PreviewElement
                          key={el.id}
                          element={effEl}
                          onHotspotClick={handleHotspot}
                          visible
                          pageKey={pg.id}
                        />
                      )
                    })
                  )}
                </Layer>
              )
            })()}
          </Stage>
        ) : (
          <div className="text-slate-700 text-sm">
            Cette app n'a aucune page.
          </div>
        )}
        {filterStyle && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={filterStyle}
          />
        )}
        {toasts.length > 0 && (
          // Wrapper double pour que les toasts (HTML overlay positionnés
          // en coords canvas natives) s'alignent exactement avec la zone
          // Konva. Sans ça, sur les hôtes où canvasScale ≠ 1 ou où la
          // viewport est plus large que le device (Mac Catalyst, large
          // iPad letterboxed), les toasts apparaissent en haut-gauche de
          // la fenêtre et à la mauvaise échelle. Cf. PreviewShell qui
          // applique exactement le même pattern.
          //   - flex-centré (extérieur) : matche le centrage du Stage
          //   - boîte canvasW × canvasH (milieu) : trace la zone Stage
          //   - scaled à canvasScale, top-left origin (intérieur) :
          //     les toasts utilisent leurs coords canvas brutes
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className="relative"
              style={{ width: canvasW, height: canvasH }}
            >
              <div
                className="absolute top-0 left-0"
                style={{
                  width: app.resolution.width,
                  height: app.resolution.height,
                  transform: `scale(${canvasScale})`,
                  transformOrigin: 'top left',
                }}
              >
                {toasts.map((t) => (
                  <IosToast
                    key={t.data.id}
                    toast={t.data}
                    // Tap sur la carte : si l'auteur a configuré une
                    // action ou une navigation (onTap), le tap ferme la
                    // notif ET déclenche cette action. Si aucune action
                    // n'est définie, le tap est ignoré — la notif reste
                    // visible jusqu'à durationMs (ou jamais si infinie).
                    // Évite que l'utilisateur dismisse par accident une
                    // notif "passive" en touchant l'écran.
                    onClick={
                      t.onTap
                        ? () => {
                            const f = t.onTap!
                            dismissToast(t.data.id)
                            f()
                          }
                        : undefined
                    }
                    durationMs={t.durationMs}
                    onDone={() => dismissToast(t.data.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {showExplanations &&
          !explanationDismissed &&
          currentPage?.explanation?.trim() && (
            <ExplanationPopup
              key={currentPage.id}
              text={currentPage.explanation}
              onDismiss={() => setExplanationDismissed(true)}
            />
          )}
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-white text-slate-900 relative overflow-hidden">
      <Header
        appName={app.name}
        sequence={app.sequence}
        onPlay={() => {
          setMode('playing')
          // Demande le fullscreen au passage en mode playing. Doit être
          // synchrone dans le click handler (gesture user requis par les
          // navigateurs). Échoue silencieusement sur iOS Safari mobile
          // qui ne supporte pas la Fullscreen API.
          const el = document.documentElement as HTMLElement & {
            webkitRequestFullscreen?: () => Promise<void>
          }
          const req = el.requestFullscreen ?? el.webkitRequestFullscreen
          if (req) {
            try {
              const p = req.call(el)
              if (p && typeof p.catch === 'function') p.catch(() => {})
            } catch {
              // Ignore — pas de fullscreen disponible (iOS, contexte non-secure, etc.)
            }
          }
        }}
      />

      <main className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'infos' && (
          <InfosTab
            project={project}
            app={app}
            showExplanations={showExplanations}
            onToggleExplanations={handleToggleExplanations}
          />
        )}
        {activeTab === 'filtre' && (
          <FilterTab filter={filter} onChange={setFilter} />
        )}
        {activeTab === 'edition' && (
          <EditionTab
            paramBindings={paramBindingList}
            paramOverrides={paramOverrides}
            onChangeOverride={(_scope, ownerId, field, value) =>
              setParamOverrides((o) => ({
                ...o,
                [ownerId]: { ...(o[ownerId] ?? {}), [field]: value },
              }))
            }
            onResetOverride={(_scope, ownerId, field) =>
              setParamOverrides((o) => {
                const forOwner = o[ownerId]
                if (!forOwner) return o
                const { [field]: _drop, ...rest } = forOwner
                const next = { ...o }
                if (Object.keys(rest).length === 0) delete next[ownerId]
                else next[ownerId] = rest
                return next
              })
            }
            onResetAll={() => setParamOverrides({})}
          />
        )}
      </main>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {filterStyle && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={filterStyle}
        />
      )}
    </div>
  )
}

// -------- Header --------

function Header({
  appName,
  sequence,
  onPlay,
}: {
  appName: string
  sequence: string
  onPlay: () => void
}) {
  return (
    <header
      className="relative bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white px-6 pt-9 pb-7 flex-shrink-0 overflow-hidden"
      style={{
        // Safe-area pour status bar (pt-9 inclut déjà ~36px de padding,
        // on additionne env top pour repousser le contenu sous une
        // status bar visible en cas de non-immersive). Left/right pour
        // les notches landscape.
        paddingTop: 'calc(2.25rem + env(safe-area-inset-top))',
        paddingLeft: 'calc(1.5rem + env(safe-area-inset-left))',
        paddingRight: 'calc(1.5rem + env(safe-area-inset-right))',
      }}
    >
      {/* Dot pattern de fond — signature visuelle premium PB. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(255 255 255 / 0.8) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />
      {/* Halo radial sky en haut-droite pour donner un point lumineux
          sans surcharger — accent brand discret. */}
      <div
        className="absolute -top-16 -right-16 w-72 h-72 rounded-full pointer-events-none opacity-30 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(56,189,248,0.45) 0%, transparent 70%)',
        }}
      />
      <div className="relative flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.22em] uppercase text-slate-400 truncate mb-2">
            Séquence
          </div>
          <div className="text-[64px] font-extrabold leading-none tabular-nums tracking-tight">
            {sequence || '—'}
          </div>
          <div className="text-[14px] font-medium text-slate-200/90 mt-3 truncate">
            {appName}
          </div>
        </div>
        <button
          onClick={onPlay}
          title="Lancer l'application"
          className="group relative inline-flex items-center justify-center gap-2.5 pl-4 pr-5 h-12 rounded-full bg-white text-slate-900 font-semibold text-[14px] shadow-[0_10px_30px_-8px_rgb(255_255_255_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.08)] hover:shadow-[0_16px_40px_-8px_rgb(56_189_248_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.15)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all duration-200"
        >
          {/* Halo gradient subtle qui apparaît au hover pour un côté
              premium "le bouton brille". */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, rgba(56,189,248,0.18), transparent 60%)',
            }}
          />
          <span className="relative w-7 h-7 rounded-full bg-gradient-to-br from-slate-900 to-slate-700 text-white flex items-center justify-center shadow-[inset_0_1px_0_rgb(255_255_255_/_0.15)]">
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current translate-x-[1px]">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="relative">Lancer</span>
        </button>
      </div>
    </header>
  )
}

// -------- Tabs --------

function TabBar({
  active,
  onChange,
}: {
  active: Tab
  onChange: (t: Tab) => void
}) {
  return (
    <nav
      className="flex-shrink-0 border-t border-slate-200 bg-white flex"
      style={{
        // viewport-fit=cover laisse le content sous les barres système.
        // Sans padding-bottom safe-area, sur Android portrait le nav bar
        // (pill ou 3 boutons) chevauche la TabBar. En landscape c'est
        // pareil pour right/left selon la rotation. On padde les 3 côtés
        // pertinents — top jamais nécessaire (Header s'occupe du status).
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <TabButton
        label="Infos"
        active={active === 'infos'}
        onClick={() => onChange('infos')}
        icon={<InfoIcon />}
      />
      <TabButton
        label="Filtre"
        active={active === 'filtre'}
        onClick={() => onChange('filtre')}
        icon={<FilterIcon />}
      />
      <TabButton
        label="Édition"
        active={active === 'edition'}
        onClick={() => onChange('edition')}
        icon={<EditIcon />}
      />
    </nav>
  )
}

function TabButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 flex flex-col items-center gap-1 py-3 text-[11px] transition-colors ' +
        (active ? 'text-blue-500' : 'text-slate-500 hover:text-slate-700')
      }
    >
      <span className="w-5 h-5">{icon}</span>
      {label}
    </button>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 11v5M12 8v.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path
        d="M12 3a9 9 0 0 1 0 18 9 9 0 0 1-7.8-4.5Z"
        fill="currentColor"
        fillOpacity="0.5"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <path
        d="M6 6h8M6 12h12M6 18h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="20" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14" cy="18" r="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

// -------- Infos tab --------

function InfosTab({
  project,
  app,
  showExplanations,
  onToggleExplanations,
}: {
  project: Project
  app: AppType
  showExplanations: boolean
  onToggleExplanations: (v: boolean) => void
}) {
  const version = app.version?.trim() || '1.0.0'
  const meta: { label: string; value: string }[] = [
    { label: 'Projet', value: project.name },
    ...(app.sequence ? [{ label: 'Séquence', value: app.sequence }] : []),
    { label: 'Version', value: `v${version}` },
    {
      label: 'Résolution',
      value: `${app.resolution.width}×${app.resolution.height}`,
    },
  ]

  return (
    <section>
      <h1 className="text-3xl font-extrabold mb-4 tracking-tight">Infos</h1>

      <dl className="grid grid-cols-2 gap-2 mb-5">
        {meta.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"
          >
            <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {m.label}
            </dt>
            <dd className="text-sm font-semibold text-slate-900 truncate">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>

      {app.description && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 mb-5">
          {app.description}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <span
            className={
              'w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ' +
              (showExplanations ? 'bg-emerald-500' : 'bg-slate-200')
            }
          >
            <span
              className={
                'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ' +
                (showExplanations ? 'left-[18px]' : 'left-0.5')
              }
            />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-sm text-slate-900">
              Afficher les explications
            </span>
            <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">
              Explication pas à pas des interactions de l&rsquo;app.
            </span>
          </span>
          <input
            type="checkbox"
            checked={showExplanations}
            onChange={(e) => onToggleExplanations(e.target.checked)}
            className="sr-only"
          />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-sky-200/70 bg-sky-50/60 px-4 py-3">
        <p className="text-[12px] leading-relaxed text-sky-900/85">
          <span className="font-semibold">Astuce :</span> à n&rsquo;importe quel
          moment, tapez 3 fois avec 3 doigts (sur téléphone) ou appuyez sur la
          touche <kbd className="rounded border border-sky-300 bg-white px-1 text-[10px] font-mono text-sky-900">Échap</kbd> (sur ordinateur)
          pour afficher cette fenêtre.
        </p>
      </div>
    </section>
  )
}

// -------- Filter tab --------

function FilterTab({
  filter,
  onChange,
}: {
  filter: FilterState
  onChange: (f: FilterState) => void
}) {
  return (
    <section>
      <h1 className="text-3xl font-extrabold mb-5">Filtre</h1>

      <h2 className="text-sm font-semibold mb-3">Température</h2>
      <div className="grid grid-cols-5 gap-2 mb-6">
        {TEMP_PRESETS.map((p) => {
          const active = filter.hex === p.hex
          return (
            <button
              key={p.kelvin}
              onClick={() =>
                onChange({ ...filter, hex: active ? null : p.hex })
              }
              className={
                'flex flex-col items-center gap-1 text-center transition-transform ' +
                (active ? 'scale-105' : 'hover:scale-105')
              }
            >
              <span
                className={
                  'block w-10 h-10 rounded-md border ' +
                  (active
                    ? 'border-blue-500 ring-2 ring-blue-300'
                    : 'border-slate-200')
                }
                style={{ backgroundColor: p.hex }}
              />
              <span className="text-[10px] leading-tight">{p.label}</span>
              <span className="text-[9px] text-slate-400 font-mono leading-tight">
                {p.hex}
              </span>
            </button>
          )
        })}
      </div>

      <h2 className="text-sm font-semibold mb-2">Opacité</h2>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={filter.opacity}
          onChange={(e) =>
            onChange({ ...filter, opacity: Number(e.target.value) })
          }
          className="flex-1 accent-blue-500"
        />
        <div className="w-10 text-right text-xs tabular-nums bg-slate-100 rounded px-2 py-1">
          {filter.opacity}
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={() => onChange(DEFAULT_FILTER)}
          className="inline-flex items-center gap-2 border border-slate-200 rounded-full px-4 py-1.5 text-xs hover:bg-slate-50"
        >
          ↺ Reset
        </button>
      </div>
    </section>
  )
}

// -------- Edition tab --------

function EditionTab({
  paramBindings,
  paramOverrides,
  onChangeOverride,
  onResetOverride,
  onResetAll,
}: {
  paramBindings: PlayerParamBindingRef[]
  paramOverrides: ParamOverrides
  onChangeOverride: (
    scope: 'element' | 'page',
    ownerId: string,
    field: string,
    value: unknown
  ) => void
  onResetOverride: (
    scope: 'element' | 'page',
    ownerId: string,
    field: string
  ) => void
  onResetAll: () => void
}) {
  const hasAnyOverride = Object.keys(paramOverrides).length > 0

  // Regroupe les bindings par (kind + nom case-insensitive) — plusieurs
  // champs portant le même label se présentent comme UN SEUL contrôle qui
  // édite toutes les valeurs en cascade. C'est ce que l'auteur attend
  // quand il réutilise un même label (ex. "Heure") sur plusieurs notifs.
  // Mirror du dedup côté PreviewShell de l'éditeur.
  const groups = useMemo(() => {
    const map = new Map<string, PlayerParamBindingRef[]>()
    for (const b of paramBindings) {
      const key = `${b.kind}:${b.name.trim().toLowerCase()}`
      const arr = map.get(key)
      if (arr) arr.push(b)
      else map.set(key, [b])
    }
    return Array.from(map.values())
  }, [paramBindings])

  return (
    <section>
      <h1 className="text-3xl font-extrabold mb-4">Édition</h1>
      {paramBindings.length === 0 ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          Aucun paramètre exposé.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
            Vos modifications sont sauvegardées sur cet appareil et restent
            actives à la prochaine ouverture.
          </p>
          <div className="space-y-4">
            {groups.map((group) => {
              const first = group[0]
              const memberWithOverride = group.find(
                (b) => paramOverrides[b.ownerId]?.[b.field] !== undefined
              )
              const original = originalParamValue(first.item, first.field)
              const currentValue = memberWithOverride
                ? paramOverrides[memberWithOverride.ownerId]![
                    memberWithOverride.field
                  ]
                : original
              const changed = group.some((b) => {
                const ov = paramOverrides[b.ownerId]?.[b.field]
                return (
                  ov !== undefined &&
                  ov !== originalParamValue(b.item, b.field)
                )
              })
              const pageNames = Array.from(
                new Set(group.map((b) => b.pageName))
              )
              const scopeLabel =
                pageNames.length === 1 ? pageNames[0] : 'Plusieurs pages'
              const isPageScope = group.every((b) => b.scope === 'page')
              const groupKey = group
                .map((b) => `${b.scope}:${b.ownerId}.${b.field}`)
                .join('|')
              return (
                <div key={groupKey}>
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <label className="text-xs font-semibold flex items-center gap-1.5">
                      {first.name}
                      {group.length > 1 && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200"
                          title={`Ce label pilote ${group.length} champs`}
                        >
                          ×{group.length}
                        </span>
                      )}
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {scopeLabel}
                      {isPageScope && ' · page'}
                    </span>
                  </div>
                  <ParamValueInput
                    kind={first.kind}
                    value={currentValue}
                    onChange={(v) => {
                      // Propage à tous les membres du groupe pour que les
                      // champs liés restent synchronisés.
                      for (const b of group) {
                        onChangeOverride(b.scope, b.ownerId, b.field, v)
                      }
                    }}
                  />
                  {changed && (
                    <button
                      onClick={() => {
                        for (const b of group) {
                          onResetOverride(b.scope, b.ownerId, b.field)
                        }
                      }}
                      className="text-[10px] text-blue-500 hover:text-blue-600 mt-1"
                    >
                      ↺ Rétablir
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {hasAnyOverride && (
            <div className="mt-6 pt-4 border-t border-slate-200">
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Réinitialiser tous les paramètres aux valeurs d’origine ?'
                    )
                  ) {
                    onResetAll()
                  }
                }}
                className="text-[11px] text-slate-500 hover:text-rose-600 transition-colors"
              >
                ↺ Tout réinitialiser
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ParamValueInput({
  kind,
  value,
  onChange,
}: {
  kind: 'text' | 'duration' | 'key'
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (kind === 'duration') {
    const n = typeof value === 'number' ? value : Number(value ?? 0)
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={Number.isFinite(n) ? n : 0}
          min={0}
          step={50}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        />
        <span className="text-[10px] text-slate-400">ms</span>
      </div>
    )
  }
  if (kind === 'key') {
    return (
      <input
        type="text"
        maxLength={1}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) =>
          onChange(e.target.value.trim().slice(0, 1).toLowerCase() || '')
        }
        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
      />
    )
  }
  return (
    <textarea
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500 resize-none"
    />
  )
}

// -------- Helpers --------

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-black text-white text-sm">
      {children}
    </div>
  )
}

export default App
