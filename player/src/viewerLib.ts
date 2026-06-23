// Viewer desktop (Windows + Linux) — logique du « launcher ».
//
// Le Viewer est le même player Tauri que les builds par-app, mais SANS
// project.json baké : un écran d'accueil où l'utilisateur colle un lien de
// partage Viewer (…/v/<slug>/<app>?name=…&token=…), l'app fetch le projet
// (avec ?inlineMedia=1 → bundle autonome), le met en cache local pour
// réouverture hors-ligne, puis le rend avec le PlayerShell habituel.
//
// Ce module = helpers purs (parse / fetch / cache / récents). L'UI est dans
// Launcher.tsx, l'orchestration dans App.tsx (ViewerApp).
import type { Project } from './types'

export interface ViewerLink {
  origin: string
  slug: string
  appSlug: string
  name?: string
  token?: string
}

const DEFAULT_ORIGIN = 'https://propbuilder.noxelstudio.com'

// Parse un lien de partage. Accepte les deux formes :
//   /v/<slug>/<app>?name=…&token=…        (lien Viewer / QR)
//   /project/<slug>/app/<app>?share=…      (lien d'aperçu web)
export function parseViewerLink(input: string): ViewerLink | null {
  const raw = (input || '').trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  let m = u.pathname.match(/\/v\/([^/]+)\/([^/]+)\/?$/)
  if (!m) m = u.pathname.match(/\/project\/([^/]+)\/app\/([^/]+)\/?$/)
  if (!m) return null
  return {
    origin: u.origin || DEFAULT_ORIGIN,
    slug: decodeURIComponent(m[1]),
    appSlug: decodeURIComponent(m[2]),
    name: u.searchParams.get('name') ?? undefined,
    token:
      u.searchParams.get('token') ?? u.searchParams.get('share') ?? undefined,
  }
}

// Fetch le projet depuis l'endpoint public, médias inlinés (offline-ready).
export async function fetchViewerProject(link: ViewerLink): Promise<Project> {
  const base = link.origin || DEFAULT_ORIGIN
  const qs = new URLSearchParams({ inlineMedia: '1' })
  if (link.token) qs.set('share', link.token)
  const url = `${base}/api/public/preview/${encodeURIComponent(
    link.slug
  )}/${encodeURIComponent(link.appSlug)}?${qs.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { project?: Project }
  if (!data || !data.project) throw new Error('Réponse invalide')
  return data.project
}

// ─── Cache offline ──────────────────────────────────────────────────────
// IndexedDB et pas localStorage : un projet médias-inlinés pèse plusieurs
// Mo (≈16 Mo vu sur l'app seq28), bien au-dessus du quota localStorage ~5 Mo.
const DB_NAME = 'pb-viewer'
const STORE = 'projects'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const cacheKey = (l: { slug: string; appSlug: string }) =>
  `${l.slug}/${l.appSlug}`

export async function cacheProject(
  link: ViewerLink,
  project: Project
): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(project, cacheKey(link))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* cache best-effort : un échec n'empêche pas le rendu en ligne */
  }
}

export async function getCachedProject(
  link: ViewerLink
): Promise<Project | null> {
  try {
    const db = await openDb()
    const out = await new Promise<Project | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const r = tx.objectStore(STORE).get(cacheKey(link))
      r.onsuccess = () => resolve((r.result as Project) ?? null)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return out
  } catch {
    return null
  }
}

// ─── Récents (localStorage, léger : pas de project blob ici) ──────────────
export interface RecentApp {
  slug: string
  appSlug: string
  name: string
  origin: string
  token?: string
  at: number
}

const RECENTS_KEY = 'pb-viewer-recents'
const MAX_RECENTS = 30

export function getRecents(): RecentApp[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function addRecent(link: ViewerLink, fallbackName: string): RecentApp[] {
  const list = getRecents().filter(
    (r) => !(r.slug === link.slug && r.appSlug === link.appSlug)
  )
  list.unshift({
    slug: link.slug,
    appSlug: link.appSlug,
    name: link.name || fallbackName || link.appSlug,
    origin: link.origin,
    token: link.token,
    at: Date.now(),
  })
  const trimmed = list.slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed))
  } catch {
    /* ignore */
  }
  return trimmed
}

export function removeRecent(slug: string, appSlug: string): RecentApp[] {
  const list = getRecents().filter(
    (r) => !(r.slug === slug && r.appSlug === appSlug)
  )
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
  return list
}

export function recentToLink(r: RecentApp): ViewerLink {
  return {
    origin: r.origin,
    slug: r.slug,
    appSlug: r.appSlug,
    name: r.name,
    token: r.token,
  }
}
