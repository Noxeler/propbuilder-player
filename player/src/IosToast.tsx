import { useEffect, useRef, useState } from 'react'

export type ToastDirection = 'top' | 'bottom' | 'left' | 'right'

export interface IosToastData {
  id: number
  title?: string
  message: string
  iconDataUrl?: string
  timestamp?: string
  // Position dans le canvas (coords natives). Optionnel.
  x?: number
  y?: number
  width?: number
  height?: number
  direction?: ToastDirection
  fontScale?: number
  infinite?: boolean
}

const BANNER_WRAPPER_BY_DIRECTION: Record<ToastDirection, string> = {
  top: 'absolute top-4 left-2 right-2 z-30 pointer-events-none flex justify-center',
  bottom:
    'absolute bottom-4 left-2 right-2 z-30 pointer-events-none flex justify-center',
  left: 'absolute left-2 top-0 bottom-0 z-30 pointer-events-none flex items-center',
  right:
    'absolute right-2 top-0 bottom-0 z-30 pointer-events-none flex items-center',
}

const HIDDEN_TRANSFORM: Record<ToastDirection, string> = {
  top: 'translateY(-120%)',
  bottom: 'translateY(120%)',
  left: 'translateX(-120%)',
  right: 'translateX(120%)',
}

export function IosToast({
  toast,
  durationMs,
  onDone,
  onClick,
}: {
  toast: IosToastData
  durationMs: number
  onDone?: () => void
  // Callback déclenché par un clic sur la carte du toast — généralement
  // l'onClickAction de l'élément toast source (ex: navigate vers une page).
  // Le wrapper est passé en pointerEvents='none' pour ne pas bloquer les
  // taps autour ; on remet 'auto' sur la carte uniquement quand onClick
  // est défini.
  onClick?: () => void
}) {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'leave'>('enter')

  // Stabilise onDone : sans ref, le parent recrée la flèche à chaque render et
  // ré-exécute cet effet, ce qui clear t1 (20ms) avant qu'il ne fire pendant
  // l'animation d'entrée de page (qui rerender ~60fps).
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('visible'), 20)
    // Mode infini : la carte reste visible jusqu'au tap (handleCardClick
    // appelle onDone). Pas d'auto-dismiss.
    if (toast.infinite) {
      return () => clearTimeout(t1)
    }
    const t2 = setTimeout(
      () => setPhase('leave'),
      Math.max(500, durationMs - 300)
    )
    const t3 = setTimeout(() => onDoneRef.current?.(), durationMs)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [durationMs, toast.id, toast.infinite])

  const direction: ToastDirection = toast.direction ?? 'top'
  const baseTransform =
    phase === 'enter' || phase === 'leave'
      ? HIDDEN_TRANSFORM[direction]
      : 'translate(0, 0)'
  const opacity = phase === 'visible' ? 1 : 0

  const positioned =
    typeof toast.x === 'number' &&
    typeof toast.y === 'number' &&
    typeof toast.width === 'number' &&
    toast.width > 0
  const wrapperStyle: React.CSSProperties = positioned
    ? {
        position: 'absolute',
        left: toast.x,
        top: toast.y,
        width: toast.width,
        height: toast.height,
        transform: baseTransform,
        opacity,
        transition:
          'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease-out',
        zIndex: 30,
        // Mode infini : la carte doit être tappable pour pouvoir être
        // fermée — sinon elle resterait à l'écran sans recours.
        pointerEvents: toast.infinite ? 'auto' : 'none',
      }
    : {
        transform: baseTransform,
        opacity,
        transition:
          'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease-out',
      }
  const wrapperClass = positioned
    ? ''
    : BANNER_WRAPPER_BY_DIRECTION[direction]
  const hasHeight = positioned && typeof toast.height === 'number' && toast.height > 0
  // Style aligné sur PreviewShell (web) — bg-white/50 + backdrop-blur-md
  // = vrai look notif Apple translucide. L'ancien 85+xl était trop opaque.
  const cardClass = positioned
    ? `w-full ${hasHeight ? 'h-full' : ''} bg-white/50 backdrop-blur-md rounded-2xl shadow-[0_6px_18px_rgba(0,0,0,0.10)] px-3 py-2.5 flex items-center gap-3`
    : `${
        direction === 'top' || direction === 'bottom'
          ? 'w-full max-w-[520px]'
          : 'w-[min(320px,75%)]'
      } bg-white/50 backdrop-blur-md rounded-2xl shadow-[0_6px_18px_rgba(0,0,0,0.10)] px-3 py-2.5 flex items-center gap-3`

  // Le wrapper a pointerEvents='none' (sauf si positioned avec wrapperStyle
  // explicite). On remet 'auto' sur la carte uniquement quand onClick est
  // fourni — sans ça la carte intercepterait les taps même quand non
  // cliquable, masquant les hotspots dessous.
  const handleCardClick = (e: React.MouseEvent) => {
    // Mode infini : tap = dismiss forcé (en plus de l'onClick éventuel
    // attaché par le parent, type navigate).
    if (toast.infinite) {
      e.stopPropagation()
      onClick?.()
      onDoneRef.current?.()
      return
    }
    if (!onClick) return
    e.stopPropagation()
    onClick()
  }
  const cardStyle: React.CSSProperties =
    onClick || toast.infinite
      ? { pointerEvents: 'auto', cursor: 'pointer' }
      : {}

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <div className={cardClass} style={cardStyle} onClick={handleCardClick}>
        <div className="w-10 h-10 rounded-lg bg-slate-200 flex-shrink-0 overflow-hidden flex items-center justify-center">
          {toast.iconDataUrl ? (
            <img
              src={toast.iconDataUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xl">🔔</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="font-semibold text-slate-900 truncate"
              style={{ fontSize: 13 * (toast.fontScale ?? 1) }}
            >
              {toast.title || 'Notification'}
            </span>
            <span
              className="font-medium text-slate-700 flex-shrink-0"
              style={{ fontSize: 10 * (toast.fontScale ?? 1) }}
            >
              {toast.timestamp || 'maintenant'}
            </span>
          </div>
          <p
            className="leading-snug text-slate-800 whitespace-pre-wrap break-words"
            style={{ fontSize: 12 * (toast.fontScale ?? 1) }}
          >
            {toast.message}
          </p>
        </div>
      </div>
    </div>
  )
}
