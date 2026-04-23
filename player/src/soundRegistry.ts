// Registre partagé des éléments <audio> des sons de la page en cours de Play.
// Chaque PreviewSound s'enregistre à mount / se désenregistre à unmount.
// executeAction(type: 'sound') y accède pour jouer les cibles.

const audioByElementId = new Map<string, HTMLAudioElement>()

export function registerSoundAudio(id: string, audio: HTMLAudioElement) {
  audioByElementId.set(id, audio)
}

export function unregisterSoundAudio(id: string) {
  audioByElementId.delete(id)
}

export function playSounds(ids: string[]) {
  for (const id of ids) {
    const audio = audioByElementId.get(id)
    if (!audio) continue
    audio.currentTime = 0
    audio.play().catch(() => {})
  }
}
