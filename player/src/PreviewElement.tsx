import { useState, useEffect, useRef } from 'react'
import {
  Group,
  Rect,
  Text,
  Image as KonvaImage,
  Circle,
  Ellipse,
  RegularPolygon,
  Star,
  Line,
  Arrow,
} from 'react-konva'
import type Konva from 'konva'
import type { CanvasElement } from './types'
import { useEntryAnimation } from './useEntryAnimation'
import { konvaFontStyle, konvaTextDecoration } from './textFormat'
import { registerSoundAudio, unregisterSoundAudio } from './soundRegistry'

interface PreviewElementProps {
  element: CanvasElement
  onHotspotClick: (el: CanvasElement) => void
  visible?: boolean
  pageKey: string
  onAnimationEnd?: (el: CanvasElement) => void
  liveTypedText?: string
  liveFocused?: boolean
  onLiveFocus?: (id: string) => void
  onSwipeStart?: (el: CanvasElement, clientX: number, clientY: number) => void
  activeSwipeId?: string | null
  swipeOffset?: { x: number; y: number }
}

export function PreviewElement({
  element,
  onHotspotClick,
  visible = true,
  pageKey,
  onAnimationEnd,
  liveTypedText,
  liveFocused,
  onLiveFocus,
  onSwipeStart,
  activeSwipeId,
  swipeOffset,
}: PreviewElementProps) {
  // Overrides paramBindings déjà merged dans element en amont par App.tsx.
  const anim = useEntryAnimation({
    type: element.entryAnimation,
    duration: element.entryDuration,
    easing: element.entryEasing,
    runKey: `${pageKey}:${visible ? 1 : 0}`,
    active: visible,
    onDone: () => onAnimationEnd?.(element),
  })
  const [isHovered, setIsHovered] = useState(false)

  if (!visible) return null
  if (element.type === 'toast') return null
  if (element.hidden) return null

  const textContent = element.content || ''

  const showShadow =
    !!element.hoverShadow && (!element.shadowOnHover || isHovered)
  const shadowKonvaProps = showShadow
    ? {
        shadowColor: element.hoverShadowColor ?? '#0f172a',
        shadowBlur: element.hoverShadowBlur ?? 28,
        shadowOffsetX: element.hoverShadowX ?? 0,
        shadowOffsetY: element.hoverShadowY ?? 10,
        shadowOpacity: element.hoverShadowOpacity ?? 0.28,
      }
    : {}

  const inner = (() => {
    switch (element.type) {
      case 'shape':
        return <PreviewShape element={element} />
      case 'text': {
        // Texte décoratif (sans action) → listening:false pour que le
        // swipe / hotspot situé en dessous reçoive le geste.
        const hasTextAction =
          !!element.onClickAction || !!element.targetPageId
        return (
          <Text
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rotation={element.rotation}
            opacity={element.opacity}
            text={textContent}
            fontSize={element.fontSize || 32}
            fontFamily={element.fontFamily || 'Arial'}
            fontStyle={konvaFontStyle(element)}
            textDecoration={konvaTextDecoration(element)}
            fill={element.color || '#000000'}
            align={element.textAlign ?? 'left'}
            listening={hasTextAction}
            {...shadowKonvaProps}
          />
        )
      }
      case 'image':
        return element.content ? <PreviewImage element={element} /> : null
      case 'video':
        return element.content ? <PreviewVideo element={element} /> : null
      case 'sound':
        return element.content ? <PreviewSound element={element} /> : null
      case 'hotspot':
        return (
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rotation={element.rotation}
            fill="rgba(0,0,0,0)"
            onClick={() => onHotspotClick(element)}
            onTap={() => onHotspotClick(element)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage()
              if (stage && element.targetPageId) {
                stage.container().style.cursor = 'pointer'
              }
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage()
              if (stage) stage.container().style.cursor = 'default'
            }}
          />
        )
      case 'livetext':
        return (
          <LiveTextPreview
            element={element}
            typed={liveTypedText ?? ''}
            focused={!!liveFocused}
            onFocus={() => onLiveFocus?.(element.id)}
            shadowProps={shadowKonvaProps}
          />
        )
      case 'swipe': {
        const style = element.swipeStyle ?? 'zone'
        const dir = element.swipeDirection ?? 'right'
        const isActive = activeSwipeId === element.id
        const offX = isActive && swipeOffset ? swipeOffset.x : 0
        const offY = isActive && swipeOffset ? swipeOffset.y : 0
        const hitRect = (
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            fill="rgba(0,0,0,0)"
            onPointerDown={(e) => {
              onSwipeStart?.(element, e.evt.clientX, e.evt.clientY)
            }}
          />
        )
        if (style !== 'knob') return hitRect
        const horizontal = dir === 'left' || dir === 'right'
        const padding = 6
        const knobSize =
          (horizontal ? element.height : element.width) - padding * 2
        const startX =
          dir === 'right'
            ? element.x + padding
            : dir === 'left'
              ? element.x + element.width - padding - knobSize
              : element.x + (element.width - knobSize) / 2
        const startY =
          dir === 'down'
            ? element.y + padding
            : dir === 'up'
              ? element.y + element.height - padding - knobSize
              : element.y + (element.height - knobSize) / 2
        const knobX = startX + offX
        const knobY = startY + offY
        const am = knobSize * 0.3
        const arrowPts: number[] =
          dir === 'right'
            ? [am, knobSize / 2, knobSize - am, knobSize / 2]
            : dir === 'left'
              ? [knobSize - am, knobSize / 2, am, knobSize / 2]
              : dir === 'down'
                ? [knobSize / 2, am, knobSize / 2, knobSize - am]
                : [knobSize / 2, knobSize - am, knobSize / 2, am]
        const hasCustomKnob = !!element.swipeKnobElementId
        return (
          <>
            <Rect
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
              fillLinearGradientEndPoint={{ x: 0, y: element.height }}
              fillLinearGradientColorStops={[0, '#1e1e20', 1, '#0f0f11']}
              stroke="#2a2a2e"
              strokeWidth={1}
              cornerRadius={Math.min(element.width, element.height) / 2}
              listening={false}
            />
            {!hasCustomKnob && (
              <>
                <Rect
                  x={knobX}
                  y={knobY}
                  width={knobSize}
                  height={knobSize}
                  cornerRadius={knobSize / 2}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: knobSize }}
                  fillLinearGradientColorStops={[
                    0,
                    '#ffffff',
                    0.5,
                    '#f1f5f9',
                    1,
                    '#cbd5e1',
                  ]}
                  stroke="#94a3b8"
                  strokeWidth={0.75}
                  shadowColor="rgba(0,0,0,0.45)"
                  shadowBlur={knobSize * 0.25}
                  shadowOffsetY={knobSize * 0.06}
                  shadowOpacity={0.6}
                  listening={false}
                />
                <Rect
                  x={knobX + knobSize * 0.18}
                  y={knobY + knobSize * 0.08}
                  width={knobSize * 0.64}
                  height={knobSize * 0.28}
                  cornerRadius={knobSize * 0.14}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: 0, y: knobSize * 0.28 }}
                  fillLinearGradientColorStops={[
                    0,
                    'rgba(255,255,255,0.85)',
                    1,
                    'rgba(255,255,255,0)',
                  ]}
                  listening={false}
                />
                <Arrow
                  x={knobX}
                  y={knobY}
                  points={arrowPts}
                  stroke="#1f2937"
                  fill="#1f2937"
                  strokeWidth={Math.max(2, knobSize * 0.09)}
                  pointerLength={knobSize * 0.22}
                  pointerWidth={knobSize * 0.26}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </>
            )}
            {hitRect}
          </>
        )
      }
      default:
        return null
    }
  })()

  if (!inner) return null

  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const needsHover = !!element.hoverShadow && !!element.shadowOnHover
  const handleEnter = needsHover ? () => setIsHovered(true) : undefined
  const handleLeave = needsHover ? () => setIsHovered(false) : undefined
  const isTextual = element.type === 'text' || element.type === 'livetext'

  return (
    <Group
      x={cx + anim.offsetX}
      y={cy + anim.offsetY}
      offsetX={cx}
      offsetY={cy}
      scaleX={anim.scale}
      scaleY={anim.scale}
      opacity={anim.opacity}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {showShadow && !isTextual && (
        <Rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          cornerRadius={element.cornerRadius ?? 0}
          fill="#ffffff"
          shadowColor={element.hoverShadowColor ?? '#0f172a'}
          shadowBlur={element.hoverShadowBlur ?? 28}
          shadowOffsetX={element.hoverShadowX ?? 0}
          shadowOffsetY={element.hoverShadowY ?? 10}
          shadowOpacity={element.hoverShadowOpacity ?? 0.28}
          listening={false}
        />
      )}
      {inner}
    </Group>
  )
}

function PreviewShape({ element }: { element: CanvasElement }) {
  const fill = element.color || '#3b82f6'
  const stroke = element.strokeColor || '#1e40af'
  const strokeWidth = element.strokeWidth ?? 0
  const kind = element.shapeKind ?? 'rectangle'

  const paint = {
    fill,
    stroke: strokeWidth > 0 ? stroke : undefined,
    strokeWidth,
  }
  const common = { rotation: element.rotation, opacity: element.opacity }

  switch (kind) {
    case 'rectangle':
      return (
        <Rect
          {...common}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          cornerRadius={element.cornerRadius ?? 0}
          {...paint}
        />
      )
    case 'circle':
      return (
        <Circle
          {...common}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          radius={Math.min(element.width, element.height) / 2}
          {...paint}
        />
      )
    case 'ellipse':
      return (
        <Ellipse
          {...common}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          radiusX={element.width / 2}
          radiusY={element.height / 2}
          {...paint}
        />
      )
    case 'triangle':
      return (
        <RegularPolygon
          {...common}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          sides={3}
          radius={Math.min(element.width, element.height) / 2}
          {...paint}
        />
      )
    case 'star':
      return (
        <Star
          {...common}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          numPoints={element.starPoints ?? 5}
          innerRadius={Math.min(element.width, element.height) / 4}
          outerRadius={Math.min(element.width, element.height) / 2}
          {...paint}
        />
      )
    case 'line':
      return (
        <Line
          {...common}
          x={element.x}
          y={element.y}
          points={[0, element.height / 2, element.width, element.height / 2]}
          stroke={stroke}
          strokeWidth={Math.max(strokeWidth || 4, 1)}
          lineCap="round"
        />
      )
    default:
      return null
  }
}

function PreviewImage({ element }: { element: CanvasElement }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!element.content) return
    const image = new window.Image()
    image.src = element.content
    image.onload = () => setImg(image)
  }, [element.content])
  if (!img) return null

  const cornerRadius = element.cornerRadius ?? 0
  const crop =
    element.cropX !== undefined &&
    element.cropY !== undefined &&
    element.cropWidth !== undefined &&
    element.cropHeight !== undefined
      ? {
          x: element.cropX,
          y: element.cropY,
          width: element.cropWidth,
          height: element.cropHeight,
        }
      : undefined

  const clipFunc =
    cornerRadius > 0
      ? (ctx: Konva.Context) => {
          const w = element.width
          const h = element.height
          const r = Math.min(cornerRadius, w / 2, h / 2)
          ctx.beginPath()
          ctx.moveTo(r, 0)
          ctx.lineTo(w - r, 0)
          ctx.quadraticCurveTo(w, 0, w, r)
          ctx.lineTo(w, h - r)
          ctx.quadraticCurveTo(w, h, w - r, h)
          ctx.lineTo(r, h)
          ctx.quadraticCurveTo(0, h, 0, h - r)
          ctx.lineTo(0, r)
          ctx.quadraticCurveTo(0, 0, r, 0)
          ctx.closePath()
        }
      : undefined

  return (
    <Group
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={element.opacity}
      clipFunc={clipFunc}
    >
      <KonvaImage
        image={img}
        width={element.width}
        height={element.height}
        crop={crop}
      />
    </Group>
  )
}

function PreviewVideo({ element }: { element: CanvasElement }) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(element.autoplay ?? false)
  const [progress, setProgress] = useState(0)
  const imageNodeRef = useRef<Konva.Image>(null)

  const autoplay = element.autoplay ?? false
  const muted = element.muted ?? true
  const loop = element.loop ?? false
  const showPlayer = !!element.showPlayer

  useEffect(() => {
    if (!element.content) return
    const video = document.createElement('video')
    video.src = element.content
    video.muted = muted
    video.loop = loop
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadeddata', () => {
      setVideoEl(video)
      if (autoplay) {
        video.play().catch(() => {})
        setIsPlaying(true)
      }
    })
    video.load()
  }, [element.content, muted, loop, autoplay])

  useEffect(() => {
    if (!videoEl || !isPlaying) return
    let rafId: number
    const tick = () => {
      imageNodeRef.current?.getLayer()?.batchDraw()
      if (showPlayer && videoEl.duration > 0) {
        setProgress(videoEl.currentTime / videoEl.duration)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [videoEl, isPlaying, showPlayer])

  const handleClick = () => {
    if (!videoEl) return
    if (videoEl.paused) {
      videoEl.play().catch(() => {})
      setIsPlaying(true)
    } else {
      videoEl.pause()
      setIsPlaying(false)
    }
  }

  if (!videoEl) {
    return (
      <Rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        fill="#0f172a"
      />
    )
  }
  if (!showPlayer) {
    return (
      <KonvaImage
        ref={imageNodeRef}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        image={videoEl}
        onClick={handleClick}
        onTap={handleClick}
      />
    )
  }

  // Overlay player (play/pause center + bottom bar avec progression)
  const cur = formatVideoTime(videoEl.currentTime || 0)
  const tot = formatVideoTime(videoEl.duration || 0)
  const barH = Math.max(28, Math.min(48, element.height * 0.09))
  const barY = element.height - barH
  const iconSize = Math.min(element.width, element.height) * 0.18

  return (
    <Group
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={element.opacity}
    >
      <KonvaImage
        ref={imageNodeRef}
        x={0}
        y={0}
        width={element.width}
        height={element.height}
        image={videoEl}
        onClick={handleClick}
        onTap={handleClick}
      />
      {!isPlaying && (
        <>
          <Circle
            x={element.width / 2}
            y={element.height / 2}
            radius={iconSize}
            fill="rgba(0,0,0,0.55)"
            listening={false}
          />
          <Text
            x={element.width / 2 - iconSize}
            y={element.height / 2 - iconSize * 0.6}
            width={iconSize * 2}
            height={iconSize * 1.2}
            text="▶"
            fontSize={iconSize * 1.1}
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </>
      )}
      <Rect
        x={0}
        y={barY}
        width={element.width}
        height={barH}
        fill="rgba(0,0,0,0.55)"
        listening={false}
      />
      <Text
        x={10}
        y={barY + barH / 2 - barH * 0.3}
        width={barH}
        height={barH * 0.6}
        text={isPlaying ? '❚❚' : '▶'}
        fontSize={barH * 0.45}
        fill="#ffffff"
        align="left"
        verticalAlign="middle"
        listening={false}
      />
      <Text
        x={barH + 12}
        y={barY + barH / 2 - barH * 0.22}
        width={60}
        height={barH * 0.5}
        text={cur}
        fontSize={Math.min(13, barH * 0.4)}
        fill="#ffffff"
        fontStyle="bold"
        fontFamily="Monaco"
        listening={false}
      />
      <Text
        x={element.width - 68}
        y={barY + barH / 2 - barH * 0.22}
        width={60}
        height={barH * 0.5}
        text={tot}
        fontSize={Math.min(13, barH * 0.4)}
        fill="#ffffff"
        fontFamily="Monaco"
        align="right"
        listening={false}
      />
      <Rect
        x={barH + 76}
        y={barY + barH / 2 - 2}
        width={element.width - (barH + 76) - 74}
        height={4}
        fill="rgba(255,255,255,0.3)"
        cornerRadius={2}
        listening={false}
      />
      <Rect
        x={barH + 76}
        y={barY + barH / 2 - 2}
        width={Math.max(0, (element.width - (barH + 76) - 74) * progress)}
        height={4}
        fill="#ff3b30"
        cornerRadius={2}
        listening={false}
      />
    </Group>
  )
}

function formatVideoTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function PreviewSound({ element }: { element: CanvasElement }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loop = element.loop ?? false
  const volume = element.volume ?? 1
  const mode = element.soundMode ?? 'zone'

  useEffect(() => {
    if (!element.content) return
    const audio = new Audio(element.content)
    audio.loop = loop
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.preload = 'auto'
    audioRef.current = audio
    registerSoundAudio(element.id, audio)
    return () => {
      unregisterSoundAudio(element.id)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.content, element.id])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.loop = loop
    a.volume = Math.max(0, Math.min(1, volume))
  }, [loop, volume])

  const handleClick = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      a.currentTime = 0
      a.play().catch(() => {})
    } else {
      a.pause()
    }
  }

  if (mode === 'source') return null

  return (
    <Rect
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      fill="rgba(0,0,0,0)"
      onClick={handleClick}
      onTap={handleClick}
    />
  )
}

function LiveTextPreview({
  element,
  typed,
  focused,
  onFocus,
  shadowProps,
}: {
  element: CanvasElement
  typed: string
  focused: boolean
  onFocus: () => void
  shadowProps?: Record<string, unknown>
}) {
  const [cursorVisible, setCursorVisible] = useState(true)
  const textRef = useRef<Konva.Text>(null)
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!focused) {
      setCursorVisible(true)
      return
    }
    const t = setInterval(() => setCursorVisible((v) => !v), 500)
    return () => clearInterval(t)
  }, [focused])

  useEffect(() => {
    const node = textRef.current
    if (!node) return
    const fontSize = element.fontSize || 28
    const lines = (typed || '').split('\n')
    const lastLine = lines[lines.length - 1] ?? ''
    const lineIndex = lines.length - 1
    const lineWidth = measureKonvaText(node, lastLine)
    const align = element.textAlign ?? 'left'
    let localX = lineWidth
    if (align === 'center') localX = (element.width + lineWidth) / 2
    else if (align === 'right') localX = element.width
    const localY = lineIndex * fontSize * 1.1
    setCaret({ x: element.x + localX, y: element.y + localY })
  }, [
    typed,
    element.x,
    element.y,
    element.width,
    element.fontSize,
    element.fontFamily,
    element.textAlign,
  ])

  const isEmpty = typed.length === 0
  const display = typed
  const fontSize = element.fontSize || 28
  const caretW = Math.max(1, Math.round(fontSize / 18))
  const caretH = fontSize * 1.05

  return (
    <>
      <Rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill="rgba(0,0,0,0)"
        onClick={onFocus}
        onTap={onFocus}
      />
      <Text
        ref={textRef}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        text={display}
        fontSize={fontSize}
        fontFamily={element.fontFamily || 'Arial'}
        fontStyle={konvaFontStyle(element)}
        textDecoration={konvaTextDecoration(element)}
        fill={isEmpty ? '#94a3b8' : element.color || '#000000'}
        align={element.textAlign ?? 'left'}
        listening={false}
        {...(shadowProps ?? {})}
      />
      {focused && cursorVisible && caret && !isEmpty && (
        <Rect
          x={caret.x}
          y={caret.y}
          width={caretW}
          height={caretH}
          fill={element.color || '#000000'}
          listening={false}
        />
      )}
      {focused && cursorVisible && isEmpty && (
        <Rect
          x={
            (element.textAlign ?? 'left') === 'center'
              ? element.x + element.width / 2
              : (element.textAlign ?? 'left') === 'right'
                ? element.x + element.width
                : element.x
          }
          y={element.y}
          width={caretW}
          height={caretH}
          fill={element.color || '#000000'}
          listening={false}
        />
      )}
    </>
  )
}

function measureKonvaText(node: Konva.Text, text: string): number {
  if (!text) return 0
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    ctx.font = `${node.fontStyle() || 'normal'} ${node.fontSize()}px ${node.fontFamily()}`
    return ctx.measureText(text).width
  } catch {
    return 0
  }
}
