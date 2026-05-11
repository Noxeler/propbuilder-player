import { useState, useEffect, useLayoutEffect, useRef } from 'react'
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
import { loadAnimatedImage } from './animatedImage'

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
  // Quand true, court-circuite l'entryAnimation : la page vient d'arriver
  // via un swipe slide donc l'élément a déjà glissé avec elle, pas besoin
  // de re-jouer un fondu/zoom. Cf. mécanisme skipPageEntryForRef côté
  // App.tsx (mirror du PreviewShell éditeur).
  skipEntryAnimation?: boolean
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
  skipEntryAnimation,
}: PreviewElementProps) {
  // Overrides paramBindings déjà merged dans element en amont par App.tsx.
  const anim = useEntryAnimation({
    type: skipEntryAnimation ? 'none' : element.entryAnimation,
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

  // On applique l'ombre directement sur le shape Konva (alpha-shadow qui
  // suit le contour) plutôt qu'un Rect carré blanc derrière — sinon le
  // Rect blanc transparait à travers les zones translucides quand opacity<1
  // (et un triangle aurait une ombre carrée).
  const useShapeAlphaShadow = showShadow && element.type === 'shape'

  const inner = (() => {
    switch (element.type) {
      case 'shape':
        return (
          <PreviewShape
            element={element}
            shadowProps={useShapeAlphaShadow ? shadowKonvaProps : undefined}
          />
        )
      case 'text': {
        // Texte décoratif (sans action) → listening:false pour que le
        // swipe / hotspot situé en dessous reçoive le geste.
        const hasTextAction =
          !!element.onClickAction || !!element.targetPageId
        return (
          <CachedText
            element={element}
            textContent={textContent}
            hasTextAction={hasTextAction}
            shadowProps={shadowKonvaProps}
          />
        )
      }
      case 'image':
        return element.content ? (
          <PreviewImage
            element={element}
            shadowProps={showShadow ? shadowKonvaProps : undefined}
          />
        ) : null
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
              <SwipeKnob
                x={knobX}
                y={knobY}
                size={knobSize}
                arrowPts={arrowPts}
              />
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
  // Pour les images sans cornerRadius, l'ombre est portée par le KonvaImage
  // (alpha-aware) — on saute le Rect d'ombre rectangulaire externe ici.
  const useImageAlphaShadow =
    element.type === 'image' && (element.cornerRadius ?? 0) === 0
  // Interactivité : un élément ne capture les events que s'il est cliquable,
  // swipable, focusable (livetext), ou s'il déclenche une action / nav. Sinon
  // (ex. icône image décorative au-dessus d'un hotspot) on met listening=false
  // pour que le hotspot dessous reçoive le tap. Ordre des calques = ordre des
  // priorités : seuls les calques effectivement interactifs comptent.
  const isInteractive =
    element.type === 'hotspot' ||
    element.type === 'swipe' ||
    element.type === 'livetext' ||
    element.type === 'button' ||
    // Sound en mode 'zone' = hit area tactile invisible, doit recevoir
    // les clics pour déclencher la lecture. Mode 'source' = rendu null
    // donc isInteractive est sans effet, gardé pour clarté.
    (element.type === 'sound' && (element.soundMode ?? 'zone') === 'zone') ||
    needsHover ||
    !!element.onClickAction ||
    !!element.targetPageId

  return (
    <Group
      x={cx + anim.offsetX}
      y={cy + anim.offsetY}
      offsetX={cx}
      offsetY={cy}
      scaleX={anim.scale}
      scaleY={anim.scale}
      opacity={anim.opacity}
      listening={isInteractive}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {showShadow && !isTextual && !useImageAlphaShadow && !useShapeAlphaShadow && (
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

// Text statique avec cache bitmap. Même problématique que LiveTextPreview
// et SwipeKnob : Konva rasterise les glyphes à chaque batchDraw, et avec
// Stage.scaleX fractionnaire (canvasScale ≠ entier), les pixels d'anti-
// aliasing tombent à des positions sub-pixel → artefacts visibles
// (surtout sur les gros fontSize comme l'horloge 9:45 en 101pt). En
// cachant le Text en bitmap au layout-effect (avant le 1er paint), le
// rendu est calculé UNE FOIS proprement, puis Konva ne fait que
// translater la bitmap au lieu de re-rasteriser à chaque tick. Re-cache
// si le contenu ou les styles changent (ex: param "Heure" édité dans
// l'aperçu partagé). Pour les textes sans shadow on cache aussi — le
// gain visuel sur les gros glyphes blancs sur fond contrasté est net.
function CachedText({
  element,
  textContent,
  hasTextAction,
  shadowProps,
}: {
  element: CanvasElement
  textContent: string
  hasTextAction: boolean
  shadowProps: Record<string, unknown>
}) {
  const textRef = useRef<Konva.Text>(null)
  useLayoutEffect(() => {
    const node = textRef.current
    if (!node) return
    // Padding cache : doit englober la shadow + une marge pour
    // l'antialiasing. Si pas de shadow, marge minimale suffit.
    const blur = Number(shadowProps?.shadowBlur ?? 0)
    const offX = Math.abs(Number(shadowProps?.shadowOffsetX ?? 0))
    const offY = Math.abs(Number(shadowProps?.shadowOffsetY ?? 0))
    const pad = Math.ceil(blur + Math.max(offX, offY) + 8)
    try {
      node.cache({
        x: -pad,
        y: -pad,
        width: element.width + pad * 2,
        height: element.height + pad * 2,
      })
      node.getLayer()?.batchDraw()
    } catch {
      /* dims invalides → rendu live sans cache */
    }
    return () => {
      try {
        node.clearCache()
      } catch {
        /* node déjà unmount */
      }
    }
  }, [
    textContent,
    element.fontSize,
    element.fontFamily,
    element.color,
    element.width,
    element.height,
    element.textAlign,
    shadowProps,
  ])
  return (
    <Text
      ref={textRef}
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
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
      {...shadowProps}
    />
  )
}

// Knob de swipe (style 'knob') — 4 nodes Konva composés (rond gradient,
// highlight, arrow, shadow). Rendu dans un Group cached à mount pour
// éviter la re-rasterisation à chaque frame pendant que l'utilisateur
// drag (knobX/knobY = Group.x/y → Konva translate seulement la bitmap
// cachée, sans re-peindre le contenu).
//
// Sans ce caching, le stroke 0.75px ultra-fin + la shadow rasterisaient
// à des positions sub-pixel (Stage.scaleX fractionnaire) à chaque rAF
// → flicker très visible sur le knob lui-même côté natif Android.
function SwipeKnob({
  x,
  y,
  size,
  arrowPts,
}: {
  x: number
  y: number
  size: number
  arrowPts: number[]
}) {
  const groupRef = useRef<Konva.Group>(null)
  // useLayoutEffect (pas useEffect) : on cache avant le 1er paint
  // navigateur pour qu'on ne voit pas l'instant fugace où le knob
  // est rendu en mode "shadow non-cachée" (frame d'artefact avant
  // que le cache batchDraw prenne effet).
  useLayoutEffect(() => {
    const node = groupRef.current
    if (!node) return
    // Padding cache = shadow blur + offset + marge. Sans ça la shadow
    // se fait clipper au bord du rect de cache.
    const shadowBlur = size * 0.25
    const shadowOff = size * 0.06
    const pad = Math.ceil(shadowBlur + shadowOff + 4)
    node.cache({
      x: -pad,
      y: -pad,
      width: size + pad * 2,
      height: size + pad * 2,
      pixelRatio: 2,
    })
    node.getLayer()?.batchDraw()
    return () => {
      try {
        node.clearCache()
      } catch {
        /* node déjà unmount */
      }
    }
    // arrowPts est un tableau de nombres — on join() pour comparer par
    // valeur dans les deps. Re-cache si la direction du swipe change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, arrowPts.join(',')])

  return (
    <Group ref={groupRef} x={x} y={y} listening={false}>
      <Rect
        x={0}
        y={0}
        width={size}
        height={size}
        cornerRadius={size / 2}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: size }}
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
        shadowBlur={size * 0.25}
        shadowOffsetY={size * 0.06}
        shadowOpacity={0.6}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
        listening={false}
      />
      <Rect
        x={size * 0.18}
        y={size * 0.08}
        width={size * 0.64}
        height={size * 0.28}
        cornerRadius={size * 0.14}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: size * 0.28 }}
        fillLinearGradientColorStops={[
          0,
          'rgba(255,255,255,0.85)',
          1,
          'rgba(255,255,255,0)',
        ]}
        listening={false}
      />
      <Arrow
        x={0}
        y={0}
        points={arrowPts}
        stroke="#1f2937"
        fill="#1f2937"
        strokeWidth={Math.max(2, size * 0.09)}
        pointerLength={size * 0.22}
        pointerWidth={size * 0.26}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    </Group>
  )
}

function PreviewShape({
  element,
  shadowProps,
}: {
  element: CanvasElement
  shadowProps?: Record<string, unknown>
}) {
  const fill = element.color || '#3b82f6'
  const stroke = element.strokeColor || '#1e40af'
  const strokeWidth = element.strokeWidth ?? 0
  const kind = element.shapeKind ?? 'rectangle'

  const paint = {
    fill,
    stroke: strokeWidth > 0 ? stroke : undefined,
    strokeWidth,
    // Mêmes flags anti-artefacts que sur Text — fundamentaux pour les
    // shapes avec shadow (typique d'un knob/bouton stylisé) qui se
    // redraw à chaque frame quand le swipe est dragué. Élimine les
    // pixels orphelins autour du bord du shape pendant l'animation.
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
    ...(shadowProps ?? {}),
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
      // Centered (cf. CanvasArea) : pivot au centre du bbox.
      return (
        <Line
          {...common}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          points={[-element.width / 2, 0, element.width / 2, 0]}
          stroke={stroke}
          strokeWidth={Math.max(strokeWidth ?? 4, 0.25)}
          lineCap="round"
        />
      )
    default:
      return null
  }
}

function PreviewImage({
  element,
  shadowProps,
}: {
  element: CanvasElement
  shadowProps?: {
    shadowColor?: string
    shadowBlur?: number
    shadowOffsetX?: number
    shadowOffsetY?: number
    shadowOpacity?: number
  }
}) {
  const [img, setImg] = useState<HTMLImageElement | HTMLCanvasElement | null>(
    null
  )
  const imageNodeRef = useRef<Konva.Image>(null)
  useEffect(() => {
    if (!element.content) return
    let cancelled = false
    let detach: (() => void) | null = null
    // GIF : décodage manuel + canvas auto-animé (drawImage(<img>) ne lit pas
    // la frame courante d'un GIF animé, quirk Canvas API universel).
    loadAnimatedImage(element.content)
      .then((res) => {
        if (cancelled) {
          res.detach()
          return
        }
        detach = res.detach
        setImg(res.source)
      })
      .catch(() => {
        /* image cassée */
      })
    return () => {
      cancelled = true
      if (detach) detach()
    }
  }, [element.content])

  // rAF batchDraw : Konva ne redessine pas spontanément le canvas ; on tick
  // rAF batchDraw UNIQUEMENT pour les GIFs animés (canvas auto-animé,
  // cf. animatedImage.ts qui décode les frames en JS et les rend sur
  // un HTMLCanvasElement). Les images statiques (PNG/JPEG/SVG) sont des
  // HTMLImageElement et n'ont pas besoin de rAF — leur frame ne change
  // jamais. Sans cette garde, sur une page avec N images, on tournait à
  // N × 60 batchDraw/s qui redraw tout le layer Konva → freeze sur une
  // page chargée.
  useEffect(() => {
    if (!img) return
    if (!(img instanceof HTMLCanvasElement)) return
    let raf: number
    const tick = () => {
      imageNodeRef.current?.getLayer()?.batchDraw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [img])

  if (!img) return null

  const cornerRadius = element.cornerRadius ?? 0
  const cropShape = element.cropShape ?? 'rectangle'
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

  // Masque appliqué au rendu : rectangle (avec cornerRadius optionnel),
  // cercle (= ellipse couvrant le bbox), ou triangle pointe en haut.
  const needsClip = cropShape !== 'rectangle' || cornerRadius > 0
  const clipFunc = needsClip
    ? (ctx: Konva.Context) => {
        const w = element.width
        const h = element.height
        ctx.beginPath()
        if (cropShape === 'circle') {
          ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        } else if (cropShape === 'triangle') {
          ctx.moveTo(w / 2, 0)
          ctx.lineTo(w, h)
          ctx.lineTo(0, h)
        } else if (cornerRadius > 0) {
          const r = Math.min(cornerRadius, w / 2, h / 2)
          ctx.moveTo(r, 0)
          ctx.lineTo(w - r, 0)
          ctx.quadraticCurveTo(w, 0, w, r)
          ctx.lineTo(w, h - r)
          ctx.quadraticCurveTo(w, h, w - r, h)
          ctx.lineTo(r, h)
          ctx.quadraticCurveTo(0, h, 0, h - r)
          ctx.lineTo(0, r)
          ctx.quadraticCurveTo(0, 0, r, 0)
        } else {
          ctx.rect(0, 0, w, h)
        }
        ctx.closePath()
      }
    : undefined

  // Pour les icônes vectorielles lucide (iconName posé), on force un
  // rendu CARRÉ centré dans la bbox de l'élément. iOS WKWebView ne
  // respecte pas preserveAspectRatio quand drawImage rasterise un SVG
  // sur canvas Konva (l'SVG est traité comme une bitmap rasterisée à
  // sa taille naturelle puis stretchée). En contrôlant nous-mêmes les
  // dims/offset du draw, on garantit l'aspect 1:1 partout — éditeur,
  // web preview, app iOS — indépendamment du comportement WebKit.
  const isLucideIcon =
    typeof element.iconName === 'string' && element.iconName.length > 0
  let drawX = 0
  let drawY = 0
  let drawW = element.width
  let drawH = element.height
  if (isLucideIcon) {
    const square = Math.min(element.width, element.height)
    drawW = square
    drawH = square
    drawX = (element.width - square) / 2
    drawY = (element.height - square) / 2
  }

  return (
    <Group
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      opacity={element.opacity}
    >
      <PreviewImageInner
        img={img}
        drawX={drawX}
        drawY={drawY}
        drawW={drawW}
        drawH={drawH}
        width={element.width}
        height={element.height}
        cornerRadius={element.cornerRadius ?? 0}
        cropShape={element.cropShape ?? 'rectangle'}
        clipFunc={clipFunc}
        crop={crop}
        shadowProps={shadowProps}
        imageNodeRef={imageNodeRef}
      />
    </Group>
  )
}

// Sous-composant qui gère le rendu de l'image avec ou sans shadow.
// Quand shadowProps est défini, on pré-rend l'image dans un canvas
// offscreen (avec clip + crop + drawX/Y/W/H bakés) puis on pose shadow
// directement sur KonvaImage qui utilise ce canvas en source — l'ombre
// suit alors l'alpha du résultat (silhouette PNG transparente, rectangle
// arrondi, cercle, triangle, icône carrée centrée). Sans shadowProps,
// on rend en mode standard avec clipFunc + crop sur KonvaImage.
function PreviewImageInner({
  img,
  drawX,
  drawY,
  drawW,
  drawH,
  width,
  height,
  cornerRadius,
  cropShape,
  clipFunc,
  crop,
  shadowProps,
  imageNodeRef,
}: {
  img: HTMLImageElement | HTMLCanvasElement | null
  drawX: number
  drawY: number
  drawW: number
  drawH: number
  width: number
  height: number
  cornerRadius: number
  cropShape: 'rectangle' | 'circle' | 'triangle'
  clipFunc?: (ctx: Konva.Context) => void
  crop?: { x: number; y: number; width: number; height: number }
  shadowProps?: {
    shadowColor?: string
    shadowBlur?: number
    shadowOffsetX?: number
    shadowOffsetY?: number
    shadowOpacity?: number
  }
  imageNodeRef: React.RefObject<Konva.Image | null>
}) {
  const cropX = crop?.x
  const cropY = crop?.y
  const cropW = crop?.width
  const cropH = crop?.height
  // CRITIQUE : booléen stable plutôt que l'objet shadowProps directement.
  // Le parent recrée shadowProps={...} à chaque render → identité change
  // → useEffect re-fire → ré-alloue un canvas + setState → re-render →
  // boucle. Cf. fix CanvasArea.tsx du même commit.
  const hasShadow = !!shadowProps
  const [shadowSourceCanvas, setShadowSourceCanvas] = useState<
    HTMLCanvasElement | null
  >(null)
  useEffect(() => {
    if (!img || !hasShadow || width <= 0 || height <= 0) {
      setShadowSourceCanvas(null)
      return
    }
    // DPR du device (= 2 ou 3 sur iPhone Retina), pas de minimum forcé.
    // Le minimum à 2 testé précédemment plombait le FPS sur les
    // animations pour zéro gain de qualité visuelle (iOS est déjà ≥2).
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setShadowSourceCanvas(null)
      return
    }
    ctx.scale(dpr, dpr)
    const needsClip = cropShape !== 'rectangle' || cornerRadius > 0
    if (needsClip) {
      ctx.beginPath()
      if (cropShape === 'circle') {
        ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
      } else if (cropShape === 'triangle') {
        ctx.moveTo(width / 2, 0)
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
      } else if (cornerRadius > 0) {
        const r = Math.min(cornerRadius, width / 2, height / 2)
        ctx.moveTo(r, 0)
        ctx.lineTo(width - r, 0)
        ctx.quadraticCurveTo(width, 0, width, r)
        ctx.lineTo(width, height - r)
        ctx.quadraticCurveTo(width, height, width - r, height)
        ctx.lineTo(r, height)
        ctx.quadraticCurveTo(0, height, 0, height - r)
        ctx.lineTo(0, r)
        ctx.quadraticCurveTo(0, 0, r, 0)
      }
      ctx.closePath()
      ctx.clip()
    }
    try {
      if (
        cropX !== undefined &&
        cropY !== undefined &&
        cropW !== undefined &&
        cropH !== undefined
      ) {
        ctx.drawImage(img, cropX, cropY, cropW, cropH, drawX, drawY, drawW, drawH)
      } else {
        ctx.drawImage(img, drawX, drawY, drawW, drawH)
      }
      setShadowSourceCanvas(canvas)
    } catch {
      setShadowSourceCanvas(null)
    }
  }, [
    img,
    hasShadow,
    width,
    height,
    cornerRadius,
    cropShape,
    cropX,
    cropY,
    cropW,
    cropH,
    drawX,
    drawY,
    drawW,
    drawH,
  ])

  if (shadowProps && shadowSourceCanvas) {
    return (
      <KonvaImage
        ref={imageNodeRef}
        image={shadowSourceCanvas}
        width={width}
        height={height}
        {...shadowProps}
      />
    )
  }

  return (
    <Group clipFunc={clipFunc}>
      {img && (
        <KonvaImage
          ref={imageNodeRef}
          image={img}
          x={drawX}
          y={drawY}
          width={drawW}
          height={drawH}
          crop={crop}
        />
      )}
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
  const placeholder = element.livePlaceholder ?? ''
  const showPlaceholder =
    isEmpty &&
    !focused &&
    (element.liveFocusMode ?? 'auto') === 'click' &&
    placeholder.length > 0
  const display = showPlaceholder ? placeholder : typed
  const fontSize = element.fontSize || 28
  const caretW = Math.max(1, Math.round(fontSize / 18))
  const caretH = fontSize * 1.05
  // Styles effectifs : quand le placeholder est visible, on applique les
  // overrides livePlaceholder* (couleur/poids/italique/souligné/contour).
  // Font-family et fontSize restent toujours hérités du texte saisi.
  const effFontStyle = showPlaceholder
    ? konvaFontStyle({
        bold: !!element.livePlaceholderBold,
        italic: !!element.livePlaceholderItalic,
      })
    : konvaFontStyle(element)
  const effTextDecoration = showPlaceholder
    ? konvaTextDecoration({ underline: !!element.livePlaceholderUnderline })
    : konvaTextDecoration(element)
  const effFill = showPlaceholder
    ? element.livePlaceholderColor ?? '#94a3b8'
    : isEmpty
      ? '#94a3b8'
      : element.color || '#000000'
  const effStrokeWidth = showPlaceholder
    ? element.livePlaceholderStrokeWidth ?? 0
    : !isEmpty
      ? element.strokeWidth ?? 0
      : 0
  const effStroke =
    effStrokeWidth > 0
      ? showPlaceholder
        ? element.livePlaceholderStrokeColor ?? '#1e40af'
        : element.strokeColor ?? '#1e40af'
      : undefined

  // Cache du Text en bitmap quand une shadow est attachée. Sans ça,
  // chaque redraw du layer (caret blink toutes les 500ms, drag d'un
  // autre élément à 60fps, GIF, etc.) re-rasterise le texte+shadow à
  // des positions sub-pixel (Stage.scaleX fractionnaire) → artefacts
  // statiques permanents sur les glyphes du 9:45 et autres livetexts.
  // Avec cache, Konva translate la bitmap baked → plus de drift.
  //
  // useLayoutEffect (pas useEffect) : le cache doit être posé AVANT
  // que Konva ait dessiné le premier frame du Text — sinon on voit
  // une fraction de seconde le rendu sub-pixel artefacté avant que
  // le redraw post-cache prenne effet. Layout effects run après le
  // commit React mais avant le paint navigateur → cache + batchDraw
  // → 1er frame visible déjà clean.
  //
  // Re-cache quand le contenu change (ex: 9:45 → 9:46) ou les styles.
  useLayoutEffect(() => {
    if (!shadowProps || Object.keys(shadowProps).length === 0) return
    const node = textRef.current
    if (!node) return
    const blur = Number(shadowProps.shadowBlur ?? 0)
    const offX = Math.abs(Number(shadowProps.shadowOffsetX ?? 0))
    const offY = Math.abs(Number(shadowProps.shadowOffsetY ?? 0))
    const pad = Math.ceil(blur + Math.max(offX, offY) + 8)
    try {
      node.cache({
        x: -pad,
        y: -pad,
        width: element.width + pad * 2,
        height: element.height + pad * 2,
      })
      node.getLayer()?.batchDraw()
    } catch {
      /* cache peut échouer si dims invalides — fallback rendu live */
    }
    return () => {
      try {
        node.clearCache()
      } catch {
        /* déjà unmount */
      }
    }
  }, [
    shadowProps,
    display,
    fontSize,
    effFill,
    effStroke,
    effStrokeWidth,
    effFontStyle,
    effTextDecoration,
    element.width,
    element.height,
    element.fontFamily,
    element.textAlign,
  ])

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
        fontStyle={effFontStyle}
        textDecoration={effTextDecoration}
        fill={effFill}
        stroke={effStroke}
        strokeWidth={effStrokeWidth}
        fillAfterStrokeEnabled
        align={element.textAlign ?? 'left'}
        listening={false}
        // Mêmes flags que sur le Text statique — éliminent les pixels
        // orphelins quand le layer se redraw 60fps (caret blink ici,
        // ou drag de knob ailleurs sur la page).
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
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
