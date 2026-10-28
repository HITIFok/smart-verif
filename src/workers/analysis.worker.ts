import { analyse, parseBrouillard, parseVerif } from "@/lib/analyzer";

export interface WorkerRequest {
  brouillard: ArrayBuffer;
  verif: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    postMessage({ type: "progress", step: "Lecture de la feuille de vérification…" });
    const { entites, balance, ecartsReference } = parseVerif(e.data.verif);
    postMessage({ type: "progress", step: "Lecture du brouillard…" });
    const lignes = parseBrouillard(e.data.brouillard);
    postMessage({ type: "progress", step: "Analyse des écritures…" });
    const result = analyse(lignes, entites, balance, ecartsReference);
    postMessage({ type: "done", result });
  } catch (err) {
    postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
