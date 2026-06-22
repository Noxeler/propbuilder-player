import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor = alternative légère à Tauri pour le build Android. Au
// lieu d'embarquer un runtime Rust de 100 MB dans l'APK, on utilise
// la WebView Android (Chrome embedded) comme runtime — APK final
// ~12-15 MB. 100% offline : le `webDir` (dist/) est copié dans
// android/app/src/main/assets/public/ par `npx cap copy`, la WebView
// le sert via le scheme `https://localhost`.
//
// `appId` ici n'est qu'un seed, utilisé à la création de `android/`
// par `npx cap add`. Le build Capacitor (build-player-local-android-
// capacitor.sh, étape 5b) réécrit ensuite `applicationId` dans
// build.gradle avec un package unique <projet>.<app>, pour que
// chaque app s'installe en parallèle sur le téléphone (icône + slot
// distincts) au lieu de s'écraser mutuellement.
const config: CapacitorConfig = {
  appId: 'com.noxel.propbuilder.player',
  appName: 'PropBuilder Player',
  webDir: 'dist',
  // Scheme `https` plutôt que `capacitor://` : utilise un cookie /
  // origin standard, évite les quirks WebView sur paths relatifs et
  // fetch() vers les fichiers bundlés media/. `https://localhost`
  // résout en assets://localhost/ via le WebViewAssetLoader interne.
  server: {
    androidScheme: 'https',
  },
  android: {
    // Empêche la WebView Android de charger du HTTP en clair (CORS
    // strict, force HTTPS / asset-loader interne). Sécurité par défaut.
    allowMixedContent: false,
    // Active la barre d'état Android transparente pour qu'on puisse
    // appliquer immersive mode depuis MainActivity comme côté Tauri.
    // Pas de plugin StatusBar nécessaire pour notre cas (immersive
    // sticky se gère via WindowInsetsControllerCompat).
  },
}

export default config
