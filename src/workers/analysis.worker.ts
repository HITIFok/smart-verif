import { analyse, parseBrouillard, parseVerif } from "@/lib/analyzer";

export interface WorkerRequest {
  brouillard: ArrayBuffer;
  verif: ArrayBuffer;
  /** Brouillard N-1 (exercice précédent) — FACULTATIF : recherches
   *  interexercices (reports, opérations antérieures non apurées,
   *  contreparties de décembre N-1 comptabilisées en janvier N). */
  brouillardN1?: ArrayBuffer;
  fichierN1?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    postMessage({ type: "progress", step: "Lecture de la feuille de vérification…" });
    const { entites, balance, ecartsReference } = parseVerif(e.data.verif);
    postMessage({ type: "progress", step: "Lecture du brouillard…" });
    const lignes = parseBrouillard(e.data.brouillard);
    // Exercice du brouillard principal : déduit de la dernière date (jamais
    // deviné — un brouillard sans date valide reste sans étiquette).
    const datesN = lignes
      .map((l) => l.date)
      .filter(Boolean)
      .sort();
    const exerciceN = datesN[datesN.length - 1]?.slice(0, 4) ?? "";
    for (const l of lignes) l.exercice = exerciceN;
    // Brouillard N-1 (facultatif) : étiqueté avec son propre exercice.
    // Un fichier illisible ou vide ne fait JAMAIS échouer l'analyse :
    // le moteur continue sur N seul et l'erreur est signalée honnêtement.
    let lignesN1: import("@/lib/analysis-types").EntryLine[] = [];
    let n1Erreur: string | undefined;
    if (e.data.brouillardN1) {
      postMessage({ type: "progress", step: "Lecture du brouillard N-1…" });
      try {
        lignesN1 = parseBrouillard(e.data.brouillardN1, { fichier: e.data.fichierN1 ?? "" });
        const datesN1 = lignesN1
          .map((l) => l.date)
          .filter(Boolean)
          .sort();
        const exerciceN1 = datesN1[datesN1.length - 1]?.slice(0, 4) ?? "";
        for (const l of lignesN1) {
          l.exercice = exerciceN1;
          if (!l.fichier) l.fichier = e.data.fichierN1 ?? "";
        }
      } catch (errN1) {
        lignesN1 = [];
        n1Erreur = `Brouillard N-1 illisible (${e.data.fichierN1 ?? "fichier N-1"}) : ${errN1 instanceof Error ? errN1.message : String(errN1)} — l'analyse continue sur N seul.`;
      }
    }
    postMessage({
      type: "progress",
      step: lignesN1.length
        ? `Analyse des écritures (N ${exerciceN} + N-1 ${lignesN1.find((l) => l.exercice)?.exercice ?? ""})…`
        : "Analyse des écritures…",
    });
    const result = analyse(lignes, entites, balance, ecartsReference, lignesN1);
    if (n1Erreur) result.n1Erreur = n1Erreur;
    postMessage({ type: "done", result });
  } catch (err) {
    postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
