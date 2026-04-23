export type ElementType =
  | 'image'
  | 'text'
  | 'shape'
  | 'button'
  | 'hotspot'
  | 'video'
  | 'toast'
  | 'livetext'
  | 'swipe'
  | 'sound'

export type LiveTextMode = 'free' | 'scripted'

export interface LiveTextImageTrigger {
  id: string
  text: string
  targetElementId: string
}

export type TriggerAction =
  | {
      type: 'toast'
      message: string
      durationMs?: number
      title?: string
      iconDataUrl?: string
      timestamp?: string
    }
  | { type: 'show'; targetElementIds: string[] }
  | { type: 'hide'; targetElementIds: string[] }
  | { type: 'toggle'; targetElementIds: string[] }
  | { type: 'sound'; targetElementIds: string[] }

export type ShapeKind =
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'line'

export type EntryAnimation =
  | 'none'
  | 'fade-in'
  | 'zoom-in'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'slide-in-left'
  | 'slide-in-right'

export type AnimEasing = 'ease-out' | 'snap'

export interface CanvasElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  content?: string
  color?: string
  fontSize?: number
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  targetPageId?: string
  shapeKind?: ShapeKind
  strokeColor?: string
  strokeWidth?: number
  cornerRadius?: number
  starPoints?: number
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
  iconName?: string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  // 'video' : overlay player visible (play/pause + progression + temps).
  showPlayer?: boolean
  // 'sound' : volume 0–1, défaut 1.
  volume?: number
  // 'sound' : mode d'interaction. 'zone' (défaut) = hit zone tactile invisible.
  // 'source' = non-tappable, déclenché par un autre élément.
  soundMode?: 'zone' | 'source'
  appearDelay?: number
  // Paramètres exposés dans le tab Édition : fieldName → { name affiché }.
  paramBindings?: Record<string, { name: string }>
  // Organisation dans le panneau Calques éditeur (ignorés au play)
  label?: string
  parentFolderId?: string
  locked?: boolean
  // @deprecated legacy (ancien système 2-fields, pre 2026-04-22).
  runtimeEditable?: boolean
  runtimeLabel?: string
  hiddenInitially?: boolean
  hidden?: boolean
  hoverShadow?: boolean
  shadowOnHover?: boolean
  hoverShadowX?: number
  hoverShadowY?: number
  hoverShadowBlur?: number
  hoverShadowColor?: string
  hoverShadowOpacity?: number
  onClickAction?: TriggerAction
  toastTitle?: string
  toastIconDataUrl?: string
  toastTimestamp?: string
  toastDurationMs?: number
  toastDirection?: 'top' | 'bottom' | 'left' | 'right'
  entryAnimation?: EntryAnimation
  entryDuration?: number
  entryEasing?: AnimEasing
  onAnimationEnd?: TriggerAction
  animationEndTargetPageId?: string
  liveMode?: LiveTextMode
  liveScriptedText?: string
  livePlaceholder?: string
  liveFocusMode?: 'auto' | 'click'
  onEnterAction?: TriggerAction
  enterTargetPageId?: string
  imageTriggers?: LiveTextImageTrigger[]
  hotspotShape?: 'rectangle' | 'circle'
  swipeDirection?: 'left' | 'right' | 'up' | 'down'
  swipeTransition?: 'none' | 'slide' | 'reveal' | 'card'
  swipeStyle?: 'zone' | 'knob'
  // Pour swipeTransition === 'reveal' ou 'card' : id de l'élément cible.
  swipeRevealElementId?: string
  // Pour swipeStyle === 'knob' : id d'un élément utilisé comme knob
  // custom (image / forme). Remplace le knob blanc par défaut.
  swipeKnobElementId?: string
  // Multi-direction (Tinder-like) : si défini, prévaut sur swipeDirection.
  swipeDirections?: ('left' | 'right' | 'up' | 'down')[]
  // Actions par direction pour le mode multi-direction.
  swipeDirectionalActions?: Partial<
    Record<
      'left' | 'right' | 'up' | 'down',
      { targetPageId?: string; action?: TriggerAction }
    >
  >
  // Rotation tilt en mode 'card' (proportionnelle au déplacement
  // horizontal, max ~15°).
  swipeTilt?: boolean
  // Badges overlay dont l'opacité est pilotée par la progression du drag
  // en mode 'card' (fade-in par direction).
  swipeBadgeLeftElementId?: string
  swipeBadgeRightElementId?: string
  swipeBadgeUpElementId?: string
  shortcutKey?: string
}

export interface Page {
  id: string
  name: string
  order: number
  elements: CanvasElement[]
  backgroundColor?: string
  canvasHeight?: number
  explanation?: string
  entryAnimation?: EntryAnimation
  entryDuration?: number
  entryEasing?: AnimEasing
  onAnimationEnd?: TriggerAction
  animationEndTargetPageId?: string
  paramBindings?: Record<string, { name: string }>
}

export type AppDeviceType =
  | 'mobile'
  | 'tablet'
  | 'laptop'
  | 'desktop'
  | 'smartwatch'

export interface App {
  id: string
  name: string
  description: string
  deviceType: AppDeviceType
  resolution: { width: number; height: number }
  sequence: string
  pages: Page[]
  version?: string
  iconDataUrl?: string
}

export interface Project {
  id: string
  slug: string
  name: string
  apps: App[]
  isPublic?: boolean
  previewToken?: string
}
