import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Stage, Layer, Group } from 'react-konva'
import { PreviewElement } from './PreviewElement'
import { playSounds } from './soundRegistry'
import { IosToast, type IosToastData } from './IosToast'
import { ExplanationPopup } from './ExplanationPopup'
import { useEntryAnimation } from './useEntryAnimation'
import type {
  Project,
  App as AppType,
  CanvasElement,
  TriggerAction,
} from './types'
import { TEMP_PRESETS, DEFAULT_FILTER, type FilterState } from './filterPresets'
import {
  applyParamOverrides,
  applyPageParamOverrides,
  getEffectiveParamBindings,
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

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/project.json')
      .then((r) => r.json())
      .then((p: Project) => setProject(p))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
  const [activeTab, setActiveTab] = useState<Tab>('infos')
  const [showExplanations, setShowExplanations] = useState(false)
  const [explanationDismissed, setExplanationDismissed] = useState(false)
  const handleToggleExplanations = (next: boolean) => {
    setShowExplanations(next)
    if (next) setExplanationDismissed(false)
  }
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  // Overrides saisis dans le tab Édition — { elementId → { fieldName → valeur } }.
  const [paramOverrides, setParamOverrides] = useState<ParamOverrides>({})
  const [currentPageId, setCurrentPageId] = useState<string | null>(
    app.pages[0]?.id ?? null
  )
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{
    data: IosToastData
    durationMs: number
  } | null>(null)
  const toastCounterRef = useRef(0)
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
    const initial = new Set<string>()
    for (const el of currentPage.elements) {
      if (el.hidden) continue
      if (el.type === 'toast') continue
      // Les images pilotées par un livetext démarrent toujours masquées ;
      // c'est l'effet de prefix-match qui décidera laquelle s'affiche.
      if (triggerTargetIds.has(el.id)) continue
      if (!el.hiddenInitially && !(el.appearDelay && el.appearDelay > 0)) {
        initial.add(el.id)
      }
    }
    setVisibleIds(initial)
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const el of currentPage.elements) {
      if (el.hidden) continue
      if (el.type === 'toast') {
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
            },
            el.toastDurationMs ?? 4500
          )
        }, delay)
        timers.push(t)
        continue
      }
      if (el.hiddenInitially) continue
      if (!el.appearDelay || el.appearDelay <= 0) continue
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
    durationMs = 4500
  ) => {
    const id = ++toastCounterRef.current
    setToast({ data: { id, ...data }, durationMs })
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
  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  })

  useEffect(() => {
    const h = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  // Geste 3 doigts × 3 = retour menu (utile en mode playing sur touchscreen)
  useEffect(() => {
    let tapTimes: number[] = []
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 3) return
      const now = Date.now()
      tapTimes = tapTimes.filter((t) => now - t < 1500)
      tapTimes.push(now)
      if (tapTimes.length >= 3) {
        tapTimes = []
        setMode('menu')
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

  // Raccourcis clavier (mirror de PreviewShell). Ignoré si livetext focusé
  // ou si l'utilisateur tape dans un input HTML (onglet Édition).
  useEffect(() => {
    if (mode !== 'playing' || !currentPage) return
    const onKey = (e: KeyboardEvent) => {
      if (focusedLiveId) return
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return
      if (e.key.length !== 1) return
      const key = e.key.toLowerCase()
      for (const el of currentPage.elements) {
        if (el.shortcutKey !== key) continue
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
  const swipeAnimRef = useRef<number | null>(null)

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
  const pageAnim = useEntryAnimation({
    type: effectivePage?.entryAnimation,
    duration: effectivePage?.entryDuration,
    easing: effectivePage?.entryEasing,
    runKey: `page:${currentPage?.id ?? ''}`,
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
            width={canvasW}
            height={canvasH}
            scaleX={canvasScale}
            scaleY={canvasScale}
          >
            <Layer y={-scrollY}>
              <Group
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
                          pageKey={currentPage?.id ?? ''}
                          onAnimationEnd={handleAnimationEnd}
                          liveTypedText={liveTexts[el.id]}
                          liveFocused={focusedLiveId === el.id}
                          onLiveFocus={(id) => setFocusedLiveId(id)}
                          onSwipeStart={handleSwipeStart}
                          activeSwipeId={activeSwipeId}
                          swipeOffset={swipeOffset}
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
            </Layer>
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
        {toast && (
          <IosToast
            key={toast.data.id}
            toast={toast.data}
            durationMs={toast.durationMs}
            onDone={() => setToast(null)}
          />
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
        onPlay={() => setMode('playing')}
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
    <header className="relative bg-slate-950 text-white px-5 pt-4 pb-5 flex-shrink-0 overflow-hidden">
      {/* Dot pattern en fond pour le côté premium, même signature que
          l'InfoPanel de l'aperçu partagé. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(255 255 255 / 0.8) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />
      <div className="relative flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium tracking-[0.18em] uppercase text-slate-400 truncate mb-1.5">
            Séquence
          </div>
          <div className="text-5xl font-extrabold leading-none tabular-nums">
            {sequence || '—'}
          </div>
          <div className="text-sm font-medium text-slate-200 mt-2 truncate">
            {appName}
          </div>
        </div>
        <button
          onClick={onPlay}
          title="Lancer l'application"
          className="group relative inline-flex items-center justify-center gap-2 pl-4 pr-5 h-11 rounded-full bg-white text-slate-900 font-semibold text-sm shadow-[0_6px_20px_-6px_rgb(255_255_255_/_0.45)] hover:shadow-[0_10px_28px_-6px_rgb(255_255_255_/_0.6)] hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current translate-x-[1px]">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          Lancer
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
    <nav className="flex-shrink-0 border-t border-slate-200 bg-white flex">
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
}) {
  return (
    <section>
      <h1 className="text-3xl font-extrabold mb-4">Édition</h1>
      {paramBindings.length === 0 ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          Aucun paramètre exposé.
        </p>
      ) : (
        <div className="space-y-4">
          {paramBindings.map((b) => {
            const override = paramOverrides[b.ownerId]?.[b.field]
            const original = originalParamValue(b.item, b.field)
            const currentValue = override !== undefined ? override : original
            const changed = override !== undefined && override !== original
            return (
              <div key={`${b.scope}:${b.ownerId}.${b.field}`}>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-semibold">{b.name}</label>
                  <span className="text-[10px] text-slate-400">
                    {b.pageName}
                    {b.scope === 'page' && ' · page'}
                  </span>
                </div>
                <ParamValueInput
                  kind={b.kind}
                  value={currentValue}
                  onChange={(v) =>
                    onChangeOverride(b.scope, b.ownerId, b.field, v)
                  }
                />
                {changed && (
                  <button
                    onClick={() =>
                      onResetOverride(b.scope, b.ownerId, b.field)
                    }
                    className="text-[10px] text-blue-500 hover:text-blue-600 mt-1"
                  >
                    ↺ Rétablir
                  </button>
                )}
              </div>
            )
          })}
        </div>
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
