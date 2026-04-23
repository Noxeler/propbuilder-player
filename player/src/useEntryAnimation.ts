import { useEffect, useRef, useState } from 'react'
import type { EntryAnimation, AnimEasing } from './types'

export interface AnimState {
  opacity: number
  scale: number
  offsetX: number
  offsetY: number
  done: boolean
}

const IDLE: AnimState = {
  opacity: 1,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  done: true,
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

const SLIDE_DISTANCE = 80

export function useEntryAnimation(params: {
  type: EntryAnimation | undefined
  duration: number | undefined
  easing: AnimEasing | undefined
  runKey: string | number
  active: boolean
  onDone?: () => void
}): AnimState {
  const type = params.type ?? 'none'
  const duration = Math.max(50, params.duration ?? 400)
  const easingName = params.easing ?? 'ease-out'
  const { runKey, active, onDone } = params

  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const doneFiredRef = useRef(false)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (!active) {
      setProgress(0)
      doneFiredRef.current = false
      return
    }
    if (type === 'none') {
      setProgress(1)
      if (!doneFiredRef.current) {
        doneFiredRef.current = true
        onDoneRef.current?.()
      }
      return
    }
    setProgress(0)
    startRef.current = null
    doneFiredRef.current = false
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now
      const elapsed = now - startRef.current
      const p = Math.min(1, elapsed / duration)
      setProgress(p)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else if (!doneFiredRef.current) {
        doneFiredRef.current = true
        onDoneRef.current?.()
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [runKey, active, type, duration])

  if (!active) {
    return { opacity: 0, scale: 1, offsetX: 0, offsetY: 0, done: false }
  }
  if (type === 'none') return IDLE

  const eased =
    easingName === 'snap' ? easeOutBack(progress) : easeOutCubic(progress)

  switch (type) {
    case 'fade-in':
      return { opacity: eased, scale: 1, offsetX: 0, offsetY: 0, done: progress >= 1 }
    case 'zoom-in':
      return {
        opacity: Math.min(1, progress * 2),
        scale: 0.6 + 0.4 * eased,
        offsetX: 0,
        offsetY: 0,
        done: progress >= 1,
      }
    case 'slide-in-up':
      return {
        opacity: Math.min(1, progress * 2),
        scale: 1,
        offsetX: 0,
        offsetY: (1 - eased) * SLIDE_DISTANCE,
        done: progress >= 1,
      }
    case 'slide-in-down':
      return {
        opacity: Math.min(1, progress * 2),
        scale: 1,
        offsetX: 0,
        offsetY: -(1 - eased) * SLIDE_DISTANCE,
        done: progress >= 1,
      }
    case 'slide-in-left':
      return {
        opacity: Math.min(1, progress * 2),
        scale: 1,
        offsetX: (1 - eased) * SLIDE_DISTANCE,
        offsetY: 0,
        done: progress >= 1,
      }
    case 'slide-in-right':
      return {
        opacity: Math.min(1, progress * 2),
        scale: 1,
        offsetX: -(1 - eased) * SLIDE_DISTANCE,
        offsetY: 0,
        done: progress >= 1,
      }
    default:
      return IDLE
  }
}
