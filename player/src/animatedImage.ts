// Décodage manuel d'un GIF animé en frames + canvas auto-animé.
//
// Pourquoi : ctx.drawImage(HTMLImageElement) ne lit JAMAIS la frame courante
// d'un GIF animé (testé Chrome + Firefox). Donc on parse le GIF en JS via
// gifuct-js, on construit chaque frame dans un canvas offscreen et on tick
// au rythme des delays du GIF. Konva.Image accepte HTMLCanvasElement comme
// source, donc on swap juste img → canvas.
//
// Pour les images statiques (PNG, JPEG, WebP non-animé) on retombe sur
// HTMLImageElement direct, qui marche normalement avec drawImage.
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js'

export type AnimatedSource = HTMLImageElement | HTMLCanvasElement

interface GifPlayer {
  canvas: HTMLCanvasElement
  stop: () => void
}

function isGifBlob(blob: Blob): boolean {
  // mime fiable d'abord, magic bytes en fallback (parfois mime perdu)
  return blob.type === 'image/gif'
}

async function readMagic(blob: Blob, n: number): Promise<Uint8Array> {
  const buf = await blob.slice(0, n).arrayBuffer()
  return new Uint8Array(buf)
}

async function looksLikeGif(blob: Blob): Promise<boolean> {
  if (isGifBlob(blob)) return true
  const m = await readMagic(blob, 6)
  // "GIF87a" ou "GIF89a"
  return (
    m[0] === 0x47 &&
    m[1] === 0x49 &&
    m[2] === 0x46 &&
    m[3] === 0x38 &&
    (m[4] === 0x37 || m[4] === 0x39) &&
    m[5] === 0x61
  )
}

function buildGifPlayer(frames: ParsedFrame[], width: number, height: number): GifPlayer {
  // Canvas final (full taille) — c'est ce qu'on retourne à Konva.
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Canvas tampon pour la frame courante (les frames GIF peuvent être
  // partielles — dims/coords variables, et il y a la disposalType à gérer).
  const tmp = document.createElement('canvas')
  tmp.width = width
  tmp.height = height
  const tmpCtx = tmp.getContext('2d')!

  // Snapshot du canvas avant la frame courante — utilisé quand
  // disposalType=3 ("revert to previous"). Lazy-allouée.
  let savedCanvas: ImageData | null = null

  let frameIdx = 0
  let lastTickAt = 0
  let elapsed = 0
  let raf: number | null = null
  let stopped = false

  const drawFrame = (frame: ParsedFrame) => {
    // disposalType géré AVANT de dessiner la nouvelle frame :
    // 2 = restore to background (clear la zone précédente)
    // 3 = restore to previous (rétablit le snapshot)
    // 0/1 = leave (on laisse tel quel)
    // (la lib expose disposalType ; le previous frame's disposal s'applique)
    const { dims, patch } = frame
    // Construit la frame patch dans tmp aux bonnes coords.
    const imageData = new ImageData(
      new Uint8ClampedArray(patch),
      dims.width,
      dims.height
    )
    tmpCtx.clearRect(0, 0, width, height)
    tmpCtx.putImageData(imageData, dims.left, dims.top)
    // Composite sur le canvas final : on respecte la "permanence" des
    // frames précédentes (pour les GIFs où chaque frame ne couvre qu'une
    // sous-région — typique pour optimiser la taille).
    ctx.drawImage(tmp, 0, 0)
  }

  const init = () => {
    // Première frame : on clear et on dessine.
    ctx.clearRect(0, 0, width, height)
    drawFrame(frames[0])
    savedCanvas = ctx.getImageData(0, 0, width, height)
  }

  const tick = (now: number) => {
    if (stopped) return
    if (lastTickAt === 0) lastTickAt = now
    // Cap dt à 100 ms : quand l'onglet passe en arrière-plan, rAF est
    // paused. Au retour, le premier tick a un dt énorme (plusieurs
    // secondes / minutes) qui ferait avancer le GIF d'autant de frames
    // → défilement en mode accéléré pendant 1-2 sec au retour de l'onglet.
    // Le cap absorbe une pause comme 100 ms d'inactivité (pas de rattrapage)
    // tout en autorisant un jank normal (5-30 ms par tick).
    const dt = Math.min(now - lastTickAt, 100)
    lastTickAt = now
    elapsed += dt

    const current = frames[frameIdx]
    // delay est en centièmes de seconde dans le GIF ; gifuct-js le convertit
    // déjà en ms via .delay (10ms minimum si =0, comportement browser standard).
    const delayMs = Math.max(current.delay, 20)
    if (elapsed >= delayMs) {
      elapsed -= delayMs
      // Disposal de la frame qu'on quitte
      if (current.disposalType === 2) {
        // restore to bg = clear sa zone
        const d = current.dims
        ctx.clearRect(d.left, d.top, d.width, d.height)
      } else if (current.disposalType === 3 && savedCanvas) {
        ctx.putImageData(savedCanvas, 0, 0)
      }
      frameIdx = (frameIdx + 1) % frames.length
      const next = frames[frameIdx]
      if (next.disposalType === 3) {
        // snapshot avant de dessiner cette frame (au cas où la suivante
        // demande un revert)
        savedCanvas = ctx.getImageData(0, 0, width, height)
      }
      drawFrame(next)
    }
    raf = requestAnimationFrame(tick)
  }

  init()
  raf = requestAnimationFrame(tick)

  return {
    canvas,
    stop: () => {
      stopped = true
      if (raf !== null) cancelAnimationFrame(raf)
    },
  }
}

export interface LoadedAnimated {
  source: AnimatedSource
  width: number
  height: number
  detach: () => void
}

// Charge une image, anime si GIF, retourne une source utilisable comme
// `image` d'un Konva.Image (HTMLImageElement OU HTMLCanvasElement).
export async function loadAnimatedImage(
  src: string,
  blobHint?: Blob
): Promise<LoadedAnimated> {
  // Fast-path : si la source ne peut PAS être un GIF animé (data URL
  // non-GIF, ou URL avec extension claire non-GIF), on saute le détour
  // fetch+blob et on file direct sur <img src>. Sous Tauri Android,
  // fetch() peut silencieusement échouer pour des data URLs longs ou
  // pour le scheme custom Tauri là où <img src> accepte sans broncher
  // — cette voie évite ces faux négatifs (image jamais chargée, donc
  // wallpaper invisible côté natif).
  if (!blobHint && !isPotentialGif(src)) {
    return loadAsImageElement(src)
  }

  let blob = blobHint
  if (!blob) {
    try {
      const res = await fetch(src)
      blob = await res.blob()
    } catch {
      // fetch a échoué (Tauri quirk, CORS, etc.) — fallback <img> direct
      return loadAsImageElement(src)
    }
  }

  if (await looksLikeGif(blob)) {
    try {
      const buf = await blob.arrayBuffer()
      const parsed = parseGIF(buf)
      const frames = decompressFrames(parsed, true)
      if (frames.length > 1) {
        const w = parsed.lsd.width
        const h = parsed.lsd.height
        const player = buildGifPlayer(frames, w, h)
        return {
          source: player.canvas,
          width: w,
          height: h,
          detach: player.stop,
        }
      }
      // GIF mono-frame → tombe sur l'<img> normal
    } catch (err) {
      console.warn('[animatedImage] gif decode failed, fallback to <img>', err)
    }
  }

  // Fallback : HTMLImageElement classique (PNG, JPEG, WebP statique, GIF
  // mono-frame, ou GIF qu'on n'a pas su parser).
  return loadAsImageElement(src)
}

function isPotentialGif(src: string): boolean {
  if (src.startsWith('data:')) {
    return src.startsWith('data:image/gif')
  }
  const cleaned = src.split(/[?#]/)[0].toLowerCase()
  return cleaned.endsWith('.gif')
}

async function loadAsImageElement(src: string): Promise<LoadedAnimated> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Image load failed'))
    el.src = src
  })
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    detach: () => {},
  }
}
