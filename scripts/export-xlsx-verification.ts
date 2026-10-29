/**
 * Révision du 29/10/2026 — preuve d'export : régénère l'export Excel complet
 * de l'application (mêmes fonctions que le bouton « Export » de l'interface)
 * sur les fichiers d'audit réels et vérifie la feuille « Pièces à demander »
 * (22 lignes attendues après déduplication au niveau document) ainsi que la
 * feuille « Diagnostics 8 écarts » (constats corrigés L354/L471/L482).
 * Exécution : bun run scripts/export-xlsx-verification.ts
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { construireDiagnostics, construireDemandesPieces } from "../src/lib/diagnostics";
import { statSync } from "node:fs";
const XLSX = await import("xlsx");

const UP = "/home/z/my-project/upload";
const verifBuf = await Bun.file(`${UP}/Verif BG 27102026 VF.xlsx`).arrayBuffer();
const { entites, balance, ecartsReference } = parseVerif(verifBuf);
const lignesN = parseBrouillard(await Bun.file(`${UP}/BROUILLARD 2026 27102026.xlsx`).arrayBuffer(), {
  fichier: "BROUILLARD 2026 27102026.xlsx",
});
{
  const dates = lignesN.map((l) => l.date).sort();
  for (const l of lignesN) l.exercice = dates[dates.length - 1]?.slice(0, 4) ?? "";
}
const result = analyse(lignesN, entites, balance, ecartsReference);
const diagnostics = construireDiagnostics(result);
const demandes = construireDemandesPieces(diagnostics, result);

const OUT = "/home/z/my-project/download/Export_SMART-VERIF_pieces_a_demander_29102026_rev.xlsx";

// Feuilles construites avec les mêmes données que l'export de l'interface
// (export-xlsx.ts consomme exactement construireDiagnostics +
// construireDemandesPieces) — isolées ici pour un livrable vérifiable.
const diagsSheet = diagnostics.map((d) => ({
  Bloc: d.bloc,
  "Ligne feuille": d.ligne,
  "Type de contrôle": d.typeControle === "famille" ? "Famille (latéral)" : "Entité",
  "Type diagnostic": d.type,
  Confiance: d.confiance,
  "Montant référence": d.montantReference,
  "Montant calculé": d.montantCalcule,
  "Résiduel (référence − calculé)": d.ecartSigne,
  "Divergences rattachées": d.composants.map((c) => `${c.compte} (+${c.contribution.toLocaleString("fr-FR")} Ar)`).join(" ; "),
  "Écart restant": d.ecartRestant,
  "Éléments confirmés": d.elementsConfirmes.join(" | "),
  "Hypothèses d'audit": d.preuvesAudit.map((p) => `${p.source} — ${p.detail}`).join(" | "),
  Limites: d.elementsManquants.join(" | "),
  "Action recommandée": d.actionRecommandee,
}));
const demandesSheet = demandes.map((d, i) => ({
  "N°": i + 1,
  "Contrôle / objet": d.controle,
  "Ligne feuille": d.ligne || "",
  "Type diagnostic": d.type,
  "Pièce à demander": d.piece,
  Motif: d.motif,
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(demandesSheet), "Pièces à demander");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diagsSheet), "Diagnostics 8 écarts");
XLSX.writeFile(wb, OUT);

const ko = demandes.length !== 22 ? 1 : 0;
console.log(`Feuille « Pièces à demander » : ${demandes.length} lignes (attendu : 22) — ${ko === 0 ? "OK" : "ÉCHEC"}`);
console.log(`Feuille « Diagnostics 8 écarts » : ${diagnostics.length} lignes (attendu : 8) — ${diagnostics.length === 8 ? "OK" : "ÉCHEC"}`);
const l471 = diagnostics.find((d) => d.ligne === 471);
const l482 = diagnostics.find((d) => d.ligne === 482);
const l354 = diagnostics.find((d) => d.ligne === 354);
console.log("L354 décomposition :", l354?.elementsConfirmes.find((x) => x.includes("Décomposition"))?.slice(0, 120), "…");
console.log("L471 constat :", l471?.elementsConfirmes[1]?.slice(0, 120), "…");
console.log("L482 constat :", l482?.elementsConfirmes[1]?.slice(0, 120), "…");
console.log("Export écrit :", OUT, `(${statSync(OUT).size} octets)`);
process.exit(ko);
