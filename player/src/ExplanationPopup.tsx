interface Props {
  text: string
  onDismiss: () => void
}

// Popup d'explication en haut de l'écran pendant le mode Play.
// Bannière verte pleine largeur, X à droite. Masque pour la session.
export function ExplanationPopup({ text, onDismiss }: Props) {
  return (
    <div style={{ zIndex: 9999 }} className="pointer-events-none absolute inset-x-3 top-3">
      <div className="pointer-events-auto flex items-center gap-3 bg-[#7BEFAB] rounded-2xl shadow-[0_8px_24px_rgb(15_23_42_/_0.14)] px-4 py-3">
        <p className="flex-1 text-sm text-slate-900 leading-snug whitespace-pre-wrap font-medium">
          {text}
        </p>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900/15 hover:bg-slate-900/25 text-slate-900 flex items-center justify-center transition-colors"
          title="Masquer les explications pour cette session"
        >
          <svg
            className="w-4 h-4"
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
