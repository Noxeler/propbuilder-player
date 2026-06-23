// Écran d'accueil du Viewer desktop (Windows + Linux).
//
// Permet de coller un lien de partage PropBuilder (…/v/<slug>/<app>?…) et
// de rouvrir les apps récemment ouvertes. Au clic, remonte un ViewerLink au
// parent (ViewerApp dans App.tsx) qui fait le fetch + cache + rendu.
//
// UI Tailwind (Tailwind v4 présent dans le player). Pas de fetch ici : ce
// composant ne fait que parser le lien et lister les récents.
import { useState } from 'react'
import {
  parseViewerLink,
  getRecents,
  removeRecent,
  recentToLink,
  type ViewerLink,
  type RecentApp,
} from './viewerLib'

export function Launcher({ onOpen }: { onOpen: (link: ViewerLink) => void }) {
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentApp[]>(() => getRecents())

  const submit = () => {
    const link = parseViewerLink(input)
    if (!link) {
      setErr(
        'Lien invalide. Collez un lien de partage PropBuilder (commençant par https://…/v/ ou …/project/).'
      )
      return
    }
    setErr(null)
    onOpen(link)
  }

  const openRecent = (r: RecentApp) => onOpen(recentToLink(r))

  const drop = (r: RecentApp) =>
    setRecents(removeRecent(r.slug, r.appSlug))

  return (
    <div className="min-h-screen w-screen overflow-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        {/* En-tête */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-lg font-bold text-white">
            P
          </div>
          <div>
            <div className="text-base font-semibold">PropBuilder Viewer</div>
            <div className="text-xs text-slate-400">
              Ouvrez n'importe quelle app depuis son lien de partage
            </div>
          </div>
        </div>

        {/* Champ lien */}
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Lien de partage
        </label>
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
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={!input.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ouvrir
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        <p className="mt-2 text-xs text-slate-500">
          Copiez le lien depuis l'éditeur PropBuilder (bouton Partager) ou
          l'email « Version prête ». La 1ʳᵉ ouverture nécessite Internet ;
          ensuite l'app fonctionne hors-ligne.
        </p>

        {/* Récents */}
        <div className="mt-10 flex-1">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Apps récentes
          </div>
          {recents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
              Aucune app encore ouverte. Collez un lien ci-dessus pour
              commencer.
            </div>
          ) : (
            <ul className="space-y-2">
              {recents.map((r) => (
                <li
                  key={`${r.slug}/${r.appSlug}`}
                  className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 transition-colors hover:border-slate-600"
                >
                  <button
                    onClick={() => openRecent(r)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sm font-semibold text-slate-300">
                      {(r.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {r.name}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {r.slug}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => drop(r)}
                    aria-label="Retirer de la liste"
                    title="Retirer de la liste"
                    className="shrink-0 rounded-md px-2 py-1 text-slate-500 opacity-0 transition-opacity hover:text-slate-200 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 text-center text-[11px] text-slate-600">
          PropBuilder Viewer
        </div>
      </div>
    </div>
  )
}
