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
  // Stratégie de chargement par taille/type :
  //  - Petite source (data URL < 100 KB) ET pas un GIF : voie directe
  //    <img src=...>. Le plus rapide, marche partout.
  //  - Gros data URL (≥ 100 KB) OU GIF potentiel : on fetch en blob.
  //    Pour les gros data URLs, le <img src=data:...> casse silencieux
  //    sur Tauri Android WebView (limite interne ~quelques 100 KB selon
  //    le device) → on convertit en URL.createObjectURL qui est un
  //    pointeur court vers le blob en mémoire, accepté sans souci.
  //    Pour les GIFs, on a besoin du blob pour décoder en JS via gifuct.
  const isLikelyGif = isPotentialGif(src)
  const isLargeDataUrl = src.startsWith('data:') && src.length > 100_000

  if (!blobHint && !isLikelyGif && !isLargeDataUrl) {
    return loadAsImageElement(src)
  }

  let blob = blobHint
  if (!blob) {
    try {
      const res = await fetch(src)
      blob = await res.blob()
    } catch {
      // fetch a échoué (Tauri quirk, CORS, etc.) — fallback <img> direct.
      // Si c'est un gros data URL et que <img> aussi échoue, on aura
      // une erreur claire à ce moment-là (image cassée affichée).
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
      // GIF mono-frame → tombe sur l'<img> normal via blob URL
    } catch (err) {
      console.warn('[animatedImage] gif decode failed, fallback to <img>', err)
    }
  }

  // Non-GIF (ou GIF qu'on n'a pas su décoder) : on passe par un Blob
  // URL plutôt que de re-coller le data URL original. Évite la size
  // limit silencieuse de <img src=data:...> sur Tauri Android pour les
  // wallpapers en JPEG/PNG inline 1 MB+.
  const objUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Image load failed'))
      el.src = objUrl
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      // Revoke le blob URL au unmount pour libérer la mémoire. Sans ça,
      // 50 wallpapers chargés × 1 MB de blob = 50 MB en mémoire vive
      // qui ne sont jamais GC, même quand le user navigue ailleurs.
      detach: () => URL.revokeObjectURL(objUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objUrl)
    throw err
  }
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
