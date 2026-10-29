/**
 * TEST DE L'EXPORT EXCEL RÉEL — revue finale du 29/10/2026 (commit 1cfc649).
 *
 * La fonction appelée par le bouton « Export » de l'interface est
 * `exportAnomalies(result)` de src/lib/export-xlsx.ts — voir
 * src/routes/index.tsx : `onClick={() => exportAnomalies(result)}`.
 * Ce script appelle CETTE FONCTION directement (pas une copie) sur les
 * fichiers réels de l'audit (27/10/2026), relit le classeur produit et
 * vérifie :
 *   — la feuille « Pièces à demander » : 22 demandes (dédupliquées au
 *     niveau document), références regroupées (L471+L482, L354+L358),
 *     chaque grand livre demandé une seule fois, justificatifs distincts
 *     conservés séparément ;
 *   — la feuille « Diagnostics 8 écarts » : 8 diagnostics avec les constats
 *     révisés (signe +143 772 ; L471 non réduit au solde 512600 ;
 *     L482 = solde 512600 au centime) ;
 *   — la présence des feuilles historiques (aucune suppression).
 *
 * Exécution : bun run scripts/test-export-anomalies.ts
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { exportAnomalies } from "../src/lib/export-xlsx";
import { mkdirSync, statSync } from "node:fs";
const XLSX = await import("xlsx");

const UP = "/home/z/my-project/upload";
const SCRATCH = "/home/z/my-project/scripts/_export_test";
mkdirSync(SCRATCH, { recursive: true });

let ok = 0;
let ko = 0;
const verifie = (cond: boolean, nom: string) => {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nom}`);
  } else {
    ko++;
    console.error(`  ✗ ÉCHEC : ${nom}`);
  }
};
const espace = (s: string) => String(s).replace(/[\u202F\u00A0\u2009]/g, " ");

// 1. Analyse réelle (mêmes entrées que la session de l'interface).
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

// 2. Appel DIRECT de la fonction du bouton Export (elle écrit
//    Anomalies_BG_<date>.xlsx dans le répertoire courant).
process.chdir(SCRATCH);
const fichier = `Anomalies_BG_${new Date().toISOString().slice(0, 10)}.xlsx`;
exportAnomalies(result);
const taille = statSync(`${SCRATCH}/${fichier}`).size;
console.log(`exportAnomalies() appelée directement → ${SCRATCH}/${fichier} (${taille} octets)`);
verifie(taille > 50_000, `classeur non trivial (${taille} octets)`);

// 3. Reliture du classeur réellement produit par la fonction de l'interface.
const wb = XLSX.readFile(`${SCRATCH}/${fichier}`);
const feuillesAttendues = [
  "Synthèse clients",
  "Vérification familles",
  "Pièces écarts familles",
  "Combinaisons écarts",
  "Variantes d'attribution",
  "RAN tiers 401000-460-411",
  "Écritures à corriger",
  "Comptes à comptes 580001",
  "Schéma des écritures",
  "Banques des sociétés",
  "Plan comptable",
  "Plan tiers",
  "Rapprochement A-B-C",
  "Validation 2026",
  "Validation totaux",
  "Diagnostics 8 écarts",
  "Pièces à demander",
];
for (const f of feuillesAttendues) verifie(!!wb.Sheets[f], `feuille historique présente : « ${f} »`);

// 4. Feuille « Pièces à demander » — 22 demandes, références regroupées.
const demandes = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Pièces à demander"]);
verifie(demandes.length === 22, `22 demandes dans l'export réel (reçu : ${demandes.length})`);
verifie(
  demandes.every((d, i) => Number(d["N°"]) === i + 1),
  "numérotation continue 1…22",
);
verifie(
  new Set(demandes.map((d) => String(d["Pièce à demander"]))).size === 22,
  "aucune pièce identique en double",
);
verifie(
  demandes.some(
    (d) => String(d["Contrôle"]).includes("L471") && String(d["Contrôle"]).includes("L482") && String(d["Pièce à demander"]).includes("512600"),
  ),
  "confirmation 512600 : références L471 ET L482 regroupées sur une seule demande",
);
verifie(
  demandes.some(
    (d) => String(d["Pièce à demander"]).includes("512320") && String(d["Pièce à demander"]).includes("512005") && String(d["Contrôle"]).includes("L358"),
  ),
  "grand livre 512320 + 512005 : références L354 ET L358 regroupées",
);
verifie(
  demandes.filter((d) => /grand livre/i.test(String(d["Pièce à demander"])) && String(d["Pièce à demander"]).includes("467910")).length === 1,
  "un seul grand livre 467910",
);
const comptes = ["512140", "512320", "512005", "512900", "467910", "467102", "467501", "467103", "512000", "467100", "460110", "512110", "512100", "467280", "512220", "513110", "513000"];
verifie(
  comptes.every(
    (c) => demandes.filter((d) => /grand livre/i.test(String(d["Pièce à demander"])) && String(d["Pièce à demander"]).includes(c)).length === 1,
  ),
  "chaque grand livre (17 comptes) demandé exactement une fois",
);
verifie(
  demandes.filter((d) => String(d["Pièce à demander"]).includes("Justificatif de l'ajustement")).length === 2,
  "les deux justificatifs distincts restent séparés",
);

// 5. Feuille « Diagnostics 8 écarts » — constats révisés.
const diags = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Diagnostics 8 écarts"]);
verifie(diags.length === 8, `8 diagnostics dans l'export réel (reçu : ${diags.length})`);
const l354 = diags.find((d) => Number(d["Ligne feuille"]) === 354);
const l471 = diags.find((d) => Number(d["Ligne feuille"]) === 471);
const l482 = diags.find((d) => Number(d["Ligne feuille"]) === 482);
const confirmes354 = espace(l354?.["Éléments confirmés"] ?? "");
verifie(
  confirmes354.includes("+143 772") && confirmes354.includes("+7 442 352") && confirmes354.includes("+7 586 124"),
  "L354 : décomposition +143 772 + 7 442 352 = +7 586 124 dans l'export réel",
);
verifie(
  !confirmes354.includes("-143 772") && !confirmes354.includes("−143 772"),
  "L354 : aucun résiduel négatif −143 772 dans l'export réel",
);
const confirmes471 = espace(l471?.["Éléments confirmés"] ?? "");
verifie(
  confirmes471.includes("ne se réduit PAS") && confirmes471.includes("69 770 274,49") && confirmes471.includes("7 671 903,02"),
  "L471 : résiduel 69 770 274,49 non réduit au solde 512600 (supplément 7 671 903,02)",
);
const confirmes482 = espace(l482?.["Éléments confirmés"] ?? "");
verifie(
  confirmes482.includes("62 098 371,47") && confirmes482.includes("solde du compte 512600"),
  "L482 : résiduel = référence = solde 512600 (62 098 371,47)",
);

console.log(`\n=== EXPORT RÉEL : ${ok} OK, ${ko} échec(s) ===`);
process.exit(ko === 0 ? 0 : 1);
