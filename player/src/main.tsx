import React from "react";
import ReactDOM from "react-dom/client";
import Konva from "konva";
import "./index.css";
import App from "./App";

// Cap Konva's internal pixelRatio à une valeur entière. Certains Android
// rapportent un devicePixelRatio fractionnaire (Redmi 15C @ 2.5, Pixel
// 7 @ 2.625, Galaxy A en 2.75…) — Konva rasterise alors les shadows et
// strokes à des positions sub-pixel, ce qui produit des pixels noirs
// orphelins visibles autour des glyphes après les redraws (artefacts
// classiques sur l'horloge live "9:45" et le knob "déverrouiller"
// côté natif). Floor pour aligner sur des pixels entiers ; cap à 3
// pour éviter l'oversampling 4x sur un device qui rapporterait DPR=4.
// Cap min à 2 pour rester net sur les écrans dits Retina ; en dessous
// (devices très anciens à DPR=1) on garde 1 pour pas gaspiller.
if (typeof window !== 'undefined') {
  const dpr = window.devicePixelRatio || 1
  Konva.pixelRatio = Math.min(3, Math.max(1, Math.floor(dpr)))
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
