// Écran d'accueil du Viewer desktop (Windows + Linux).
//
// Permet de coller un lien de partage PropBuilder (…/v/<slug>/<app>?…) et
// de rouvrir les apps récemment ouvertes. Au clic, remonte un ViewerLink au
// parent (ViewerApp dans App.tsx) qui fait le fetch + cache + rendu.
//
// DA alignée sur ViewerLandingPage / la famille Viewer : charcoal monochrome
// (clap), accents MONO, grille blueprint en filigrane, bouton brushed-plate.
import { useState } from 'react'
import {
  parseViewerLink,
  getRecents,
  removeRecent,
  recentToLink,
  type ViewerLink,
  type RecentApp,
} from './viewerLib'

// Palette cinema clap (identique à ViewerLandingPage.tsx).
const C = {
  bg: '#0a0a0a',
  bg2: '#0f0f0f',
  card: '#141414',
  border: '#262626',
  borderHi: '#404040',
  ink: '#f5f5f4',
  inkMuted: '#a8a29e',
  inkDim: '#78716c',
  white: '#fafaf9',
}
const MONO = "ui-monospace, 'SF Mono', Menlo, 'JetBrains Mono', monospace"

export function Launcher({ onOpen }: { onOpen: (link: ViewerLink) => void }) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentApp[]>(() => getRecents())

  const submit = () => {
    const link = parseViewerLink(input)
    if (!link) {
      setErr(
        'Lien invalide. Collez un lien de partage PropBuilder (https://…/v/… ou …/project/…).'
      )
      return
    }
    setErr(null)
    onOpen(link)
  }

  const openRecent = (r: RecentApp) => onOpen(recentToLink(r))
  const drop = (r: RecentApp) => setRecents(removeRecent(r.slug, r.appSlug))

  return (
    <div
      className="min-h-screen w-screen overflow-auto"
      style={{
        background: C.bg,
        color: C.ink,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* Filigrane blueprint (identique à ViewerLandingPage) */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 70%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-14">
        {/* En-tête : plaque brossée + triangle play (rappel icône Viewer) */}
        <div className="mb-12 flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              background: 'linear-gradient(180deg, #f5f5f4 0%, #d6d3d1 100%)',
              boxShadow:
                '0 12px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.4)',
            }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinejoin="round">
              <path d="M7 5v14l11-7z" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17, color: C.ink }}>
              PropBuilder Viewer
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.22em',
                color: C.inkDim,
              }}
            >
              OUVREZ N'IMPORTE QUELLE APP PAR SON LIEN
            </div>
          </div>
        </div>

        {/* Champ lien */}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.22em',
            color: C.inkDim,
          }}
          className="mb-3"
        >
          LIEN DE PARTAGE
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (err) setErr(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="https://propbuilder.noxelstudio.com/v/…"
            spellCheck={false}
            autoFocus
            className="min-w-0 flex-1 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            style={{
              background: C.bg2,
              border: `1px solid ${C.border}`,
              color: C.ink,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = C.borderHi)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
          />
          <button
            onClick={submit}
            disabled={!input.trim()}
            className="shrink-0 rounded-xl px-6 py-3 font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: 'linear-gradient(180deg, #f5f5f4 0%, #d6d3d1 100%)',
              color: '#0a0a0a',
              boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
            }}
          >
            Ouvrir
          </button>
        </div>
        {err && (
          <p className="mt-2 text-xs" style={{ color: '#f87171' }}>
            {err}
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed" style={{ color: C.inkDim }}>
          Copiez le lien depuis l'éditeur PropBuilder (bouton Partager) ou
          l'email « Version prête ». La 1ʳᵉ ouverture nécessite Internet ;
          ensuite l'app fonctionne hors-ligne.
        </p>

        {/* Récents */}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.22em',
            color: C.inkDim,
          }}
          className="mb-3 mt-12"
        >
          APPS RÉCENTES
        </div>
        {recents.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-10 text-center text-sm"
            style={{
              border: `1px dashed ${C.border}`,
              color: C.inkDim,
            }}
          >
            Aucune app encore ouverte. Collez un lien ci-dessus pour commencer.
          </div>
        ) : (
          <ul className="space-y-2">
            {recents.map((r) => (
              <li
                key={`${r.slug}/${r.appSlug}`}
                className="group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors"
                style={{ background: C.bg2, border: `1px solid ${C.border}` }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = C.borderHi)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = C.border)
                }
              >
                <button
                  onClick={() => openRecent(r)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
                    style={{ background: C.card, color: C.inkMuted }}
                  >
                    {(r.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div
                      className="truncate text-sm font-medium"
                      style={{ color: C.ink }}
                    >
                      {r.name}
                    </div>
                    <div
                      className="truncate"
                      style={{ fontFamily: MONO, fontSize: 11, color: C.inkDim }}
                    >
                      {r.slug}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => drop(r)}
                  aria-label="Retirer de la liste"
                  title="Retirer de la liste"
                  className="shrink-0 rounded-md px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: C.inkDim }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div
          className="mt-10 text-center"
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.18em',
            color: C.inkDim,
          }}
        >
          © NOXEL STUDIO
        </div>
      </div>
    </div>
  )
}
