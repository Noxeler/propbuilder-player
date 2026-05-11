interface Props {
  text: string
  onDismiss: () => void
}

// HUD d'explication affiché en bas de l'écran pendant le mode Play.
// Style premium iOS : carte glass dark + bordure subtle + accent sky/
// indigo sur l'icône ampoule, texte blanc. Position centré-bas (~18%
// du bas) pour ne pas masquer le contenu utile en haut.
// Le X masque les popups pour toute la session Play (mirror éditeur).
export function ExplanationPopup({ text, onDismiss }: Props) {
  return (
    <div
      style={{ zIndex: 9999 }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 max-w-[480px] w-full px-4 py-3 rounded-2xl bg-slate-900/85 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.55)] border border-white/[0.08]">
        <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-500 flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(14,165,233,0.5)]">
          <svg
            className="w-4 h-4 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
          </svg>
        </div>
        <p className="flex-1 text-[13.5px] text-white/95 leading-snug whitespace-pre-wrap font-medium">
          {text}
        </p>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-colors"
          title="Masquer les explications pour cette session"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
