/**
 * VALIDATION INTEREXERCICES — brouillard N (2026) + brouillard N-1 (2025)
 * + Verif BG du 27/10/2026.
 *
 * Exécution : bun run scripts/validate-n1.ts
 *  1. Exécute le moteur SANS N-1 (référence « avant »).
 *  2. Charge le brouillard N-1 réel (BROUILLARD 2025 31082025.xlsx).
 *  3. Exécute le moteur AVEC N-1 (état « après »).
 *  4. Compare : fiches A/B/C modifiées par N-1, ventilation N/N-1,
 *     à-nouveaux tracés, doublons interexercices, validation STRICTEMENT
 *     inchangée (N-1 ne modifie jamais un montant de validation), perf.
 *  5. Écrit le rapport JSON de mission dans download/.
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import type { EntryLine } from "../src/lib/analysis-types";
import { STATUT_LABELS } from "../src/lib/rapprochement";
import { writeFileSync } from "node:fs";

const UP = "/home/z/my-project/upload";
const BRO = `${UP}/BROUILLARD 2026 27102026.xlsx`;
const BRO_N1 = `${UP}/BROUILLARD 2025 31082025.xlsx`;
const VER = `${UP}/Verif BG 27102026 VF.xlsx`;

const t0 = Date.now();
console.log("Lecture de la feuille de vérification…");
const verifBuf = await Bun.file(VER).arrayBuffer();
const { entites, balance, ecartsReference } = parseVerif(verifBuf);

console.log("Lecture du brouillard N (2026)…");
const broBuf = await Bun.file(BRO).arrayBuffer();
const lignes = parseBrouillard(broBuf, { fichier: "BROUILLARD 2026 27102026.xlsx" });
const tLignes = Date.now();
console.log(
  `  ${lignes.length.toLocaleString("fr-FR")} lignes en ${((tLignes - t0) / 1000).toFixed(1)} s`,
);

// Étiquetage exercice N comme le worker (dernière date du brouillard)
const datesN = lignes
  .map((l) => l.date)
  .filter(Boolean)
  .sort();
const exerciceN = datesN[datesN.length - 1]?.slice(0, 4) ?? "";
for (const l of lignes) l.exercice = exerciceN;
console.log(`  exercice N = ${exerciceN}`);

console.log("\n=== AVANT (N seul) ===");
const avant = analyse(lignes, entites, balance, ecartsReference);
const tAvant = Date.now();
const fichesAvant = new Map(
  avant.rapprochements.map((c) => [
    `${c.type}|${c.societe}|${c.journal}|${c.refPiece}|${c.date}|${c.libelle}`,
    c,
  ]),
);
console.log(
  `  fiches A/B/C : ${avant.rapprochements.length} · validation : ${avant.validation?.totaux.nbExpliquesExact}/${avant.validation?.totaux.nbReferences} exacts`,
);

console.log("\nLecture du brouillard N-1 (2025)…");
const tN1 = Date.now();
const bufN1 = await Bun.file(BRO_N1).arrayBuffer();
const lignesN1: EntryLine[] = parseBrouillard(bufN1, { fichier: "BROUILLARD 2025 31082025.xlsx" });
const tN1Fin = Date.now();
const datesN1 = lignesN1
  .map((l) => l.date)
  .filter(Boolean)
  .sort();
const exerciceN1 = datesN1[datesN1.length - 1]?.slice(0, 4) ?? "";
for (const l of lignesN1) {
  l.exercice = exerciceN1;
  if (!l.fichier) l.fichier = "BROUILLARD 2025 31082025.xlsx";
}
console.log(
  `  ${lignesN1.length.toLocaleString("fr-FR")} lignes en ${((Date.now() - tN1) / 1000).toFixed(1)} s · exercice N-1 = ${exerciceN1} · période ${datesN1[0] ?? "?"} → ${datesN1[datesN1.length - 1] ?? "?"}`,
);

console.log("\n=== APRÈS (N + N-1) ===");
const apres = analyse(lignes, entites, balance, ecartsReference, lignesN1);
const tFin = Date.now();

// ---- Invariants de sécurité
console.log("\n— Invariants");
const vAvant = avant.validation;
const vApres = apres.validation;
egal("validation strictement identique", JSON.stringify(vAvant), JSON.stringify(vApres));
egal("balance identique", JSON.stringify(avant.balance), JSON.stringify(apres.balance));
egal("entités identiques", JSON.stringify(avant.entites), JSON.stringify(apres.entites));
egal("familles identiques", JSON.stringify(avant.familles), JSON.stringify(apres.familles));
egal("anomalies identiques", JSON.stringify(avant.anomalies), JSON.stringify(apres.anomalies));

function egal(nom: string, a: unknown, b: unknown) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`  ${ok ? "✓" : "✗ INVIOLÉ"} ${nom}`);
  if (!ok) process.exitCode = 1;
}

// ---- Ventilation N-1 sur les fiches
console.log("\n— Fiches modifiées par N-1 (ventilation attendu/rapproché N-1)");
const ficheN1 = apres.rapprochements.filter(
  (c) => (c.montantAttenduN1 ?? 0) !== 0 || (c.montantRapprocheN1 ?? 0) !== 0,
);
console.log(`  ${ficheN1.length} fiche(s) portant un montant N-1 :`);
for (const c of ficheN1.slice(0, 15)) {
  console.log(
    `  ${c.id} [${c.statut}] ${c.type} · ${c.societe} · attendu ${c.montantAttendu.toLocaleString("fr-FR")} (dont N-1 ${(c.montantAttenduN1 ?? 0).toLocaleString("fr-FR")}) · rapproché ${c.montantRapproche.toLocaleString("fr-FR")} (dont N-1 ${(c.montantRapprocheN1 ?? 0).toLocaleString("fr-FR")}) · restant ${c.ecartRestant.toLocaleString("fr-FR")}`,
  );
  console.log(`      ${c.explication.slice(0, 300)}`);
}

// ---- Fiches dont le STATUT a changé
console.log("\n— Fiches dont le statut a changé (N seul → N+N-1)");
let changées = 0;
for (const [key, a] of fichesAvant) {
  const b = apres.rapprochements.find(
    (c) => `${c.type}|${c.societe}|${c.journal}|${c.refPiece}|${c.date}|${c.libelle}` === key,
  );
  if (b && b.statut !== a.statut) {
    changées++;
    console.log(
      `  ${a.statut} → ${b.statut} : ${a.type} · ${a.societe} · ${a.journal} · ${a.refPiece || a.libelle.slice(0, 40)}`,
    );
  }
}
if (changées === 0) console.log("  (aucun statut changé — les statuts restent opposables)");

// ---- Nouveaux contrôles N-1
const ouvertures = apres.rapprochements.filter((c) => c.type === "OUVERTURE");
const doublonsInter = apres.rapprochements.filter(
  (c) => c.type === "A_doublon" && c.explication.includes("brouillard N-1"),
);
console.log("\n— Nouveaux contrôles interexercices");
console.log(
  `  OUVERTURE : ${ouvertures.length} fiche(s) affichées (${apres.n1?.ranTraces} RAN tracés non ambigus, ${apres.n1?.ranAmbigus} ambigus, ${apres.n1?.ranNonTraces} non retracés)`,
);
console.log(`  Doublons interexercices : ${doublonsInter.length}`);
for (const d of doublonsInter.slice(0, 8)) {
  console.log(
    `    ${d.societe} · ${d.journal} · pièce ${d.refPiece} · ${d.montantAttendu.toLocaleString("fr-FR")} Ar · ${d.date}`,
  );
  console.log(`      ${d.explication.slice(0, 260)}`);
}

// ---- Trace N-1 dans les fiches A_paiement / B (justification documentée)
const traces = apres.rapprochements.filter(
  (c) => c.type !== "OUVERTURE" && (c.lignes ?? []).some((l) => l.exercice === exerciceN1),
);
console.log(`\n  Fiches citant une écriture N-1 en source (traçabilité) : ${traces.length}`);
for (const c of traces.slice(0, 8)) {
  const lN1 = c.lignes.filter((l) => l.exercice === exerciceN1).slice(0, 2);
  console.log(
    `    ${c.id} ${c.type} · ${c.societe} · pièce ${c.refPiece || "—"} — N-1 : ${lN1.map((l) => `${l.journal}/${l.piece} L${l.ligne} ${l.date}`).join(" ; ")}`,
  );
}

// ---- Diff globale des fiches : les contrôles N-1 (OUVERTURE, doublons
// interexercices) AJOUTENT des fiches par conception — l'invariant porte sur
// les fiches des contrôles historiques (A_411/A_paiement/A_doublon intra-N/
// B/C), qui doivent rester strictement identiques.
console.log("\n— Comparaison globale des fiches A/B/C");
const typesHistoriques = (c: { type: string; explication: string }) =>
  c.type !== "OUVERTURE" && !(c.type === "A_doublon" && c.explication.includes("brouillard N-1"));
const histAvant = avant.rapprochements.filter(typesHistoriques);
const histApres = apres.rapprochements.filter(typesHistoriques);
const cleFiche = (c: (typeof histAvant)[number]) =>
  `${c.type}|${c.societe}|${c.journal}|${c.refPiece}|${c.refFacture}|${c.date}|${c.sens}|${c.libelle}`;
const mapAvant = new Map(histAvant.map((c) => [cleFiche(c), c]));
const mapApres = new Map(histApres.map((c) => [cleFiche(c), c]));
egal(
  "mêmes clés de fiches historiques",
  [...mapAvant.keys()].sort().join("§"),
  [...mapApres.keys()].sort().join("§"),
);
const familleTransfert = new Set([
  "correspondance_trouvee",
  "transfert_partiel",
  "transfert_absent",
  "transfert_excedentaire",
]);
let decisionsInchangees = 0;
let decisionsViaN1 = 0;
let traceAjoutee = 0;
const violations: string[] = [];
for (const [k, a] of mapAvant) {
  const b = mapApres.get(k)!;
  const decisionA = [a.montantAttendu, a.montantRapproche, a.ecartRestant, a.statut, a.confiance];
  const decisionB = [b.montantAttendu, b.montantRapproche, b.ecartRestant, b.statut, b.confiance];
  if (JSON.stringify(decisionA) === JSON.stringify(decisionB)) {
    decisionsInchangees++;
    if (JSON.stringify(a.lignes) !== JSON.stringify(b.lignes)) traceAjoutee++;
    continue;
  }
  // Changement de décision AUTORISÉ seulement via la ventilation N-1
  // documentée : attendu = attendu N + attendu N-1 exact, couverture jamais
  // réduite, statut confined à la famille des transferts (jamais transformé
  // en erreur/doublon par N-1).
  const n1 = b.montantAttenduN1 ?? 0;
  const attenduCoherent =
    Math.round((a.montantAttendu + n1) * 100) === Math.round(b.montantAttendu * 100);
  const couvertureNonReduite = b.montantRapproche >= a.montantRapproche;
  const statutConfine = familleTransfert.has(a.statut) && familleTransfert.has(b.statut);
  if (n1 > 0 && attenduCoherent && couvertureNonReduite && statutConfine) {
    decisionsViaN1++;
  } else {
    violations.push(
      `${k} — avant ${JSON.stringify(decisionA)} après ${JSON.stringify(decisionB)} N1=${n1}`,
    );
  }
}
egal("aucune violation d'invariant", violations.length, 0);
console.log(
  `  décisions inchangées : ${decisionsInchangees} · changées VIA ventilation N-1 documentée : ${decisionsViaN1} · traçabilité ajoutée sans changement : ${traceAjoutee}`,
);
for (const v of violations.slice(0, 5)) console.error(`  ✗ ${v}`);
const parStatutAvant = new Map<string, number>();
const parStatutApres = new Map<string, number>();
for (const c of avant.rapprochements)
  parStatutAvant.set(c.statut, (parStatutAvant.get(c.statut) ?? 0) + 1);
for (const c of apres.rapprochements)
  parStatutApres.set(c.statut, (parStatutApres.get(c.statut) ?? 0) + 1);
console.log(`  avant : ${JSON.stringify(Object.fromEntries(parStatutAvant))}`);
console.log(`  après : ${JSON.stringify(Object.fromEntries(parStatutApres))}`);

// ---- Perf
console.log("\n— Performances");
console.log(`  parse N : ${((tLignes - t0) / 1000).toFixed(1)} s`);
console.log(`  analyse SANS N-1 : ${(tAvant - tLignes).toFixed(0)} ms`);
console.log(
  `  parse N-1 : ${((tN1Fin - tN1) / 1000).toFixed(1)} s · analyse AVEC N-1 : ${((tFin - tN1Fin) / 1000).toFixed(1)} s`,
);
console.log(
  `  surcoût analyse N-1 : ${((tFin - tN1 - (tAvant - tLignes)) / 1000).toFixed(1)} s pour ${lignesN1.length.toLocaleString("fr-FR")} lignes supplémentaires`,
);

// ---- Rapport JSON de mission
const rapport = {
  mission: "Rapprochement interexercices avec le brouillard N-1",
  source: {
    brouillardN: BRO,
    brouillardN1: BRO_N1,
    verif: VER,
    date: new Date().toISOString(),
  },
  n1: apres.n1,
  invariants: {
    validationInchangee: JSON.stringify(vAvant) === JSON.stringify(vApres),
    anomaliesInchangees: JSON.stringify(avant.anomalies) === JSON.stringify(apres.anomalies),
    famillesInchangees: JSON.stringify(avant.familles) === JSON.stringify(apres.familles),
  },
  fichesAvecMontantN1: ficheN1.map((c) => ({
    id: c.id,
    type: c.type,
    societe: c.societe,
    statut: c.statut,
    montantAttendu: c.montantAttendu,
    montantAttenduN1: c.montantAttenduN1 ?? 0,
    montantRapproche: c.montantRapproche,
    montantRapprocheN1: c.montantRapprocheN1 ?? 0,
    ecartRestant: c.ecartRestant,
  })),
  fichesHistoriquesInchangees:
    JSON.stringify(
      avant.rapprochements.filter(
        (c) =>
          c.type !== "OUVERTURE" &&
          !(c.type === "A_doublon" && c.explication.includes("brouillard N-1")),
      ),
    ) ===
    JSON.stringify(
      apres.rapprochements.filter(
        (c) =>
          c.type !== "OUVERTURE" &&
          !(c.type === "A_doublon" && c.explication.includes("brouillard N-1")),
      ),
    ),
  ouverturesAffichees: ouvertures.length,
  doublonsInterExercices: doublonsInter.map((d) => ({
    societe: d.societe,
    journal: d.journal,
    piece: d.refPiece,
    montant: d.montantAttendu,
    date: d.date,
    explication: d.explication,
  })),
  fichesCitantN1: traces.length,
  parStatutAvant: Object.fromEntries(parStatutAvant),
  parStatutApres: Object.fromEntries(parStatutApres),
  perf: {
    parseNMs: tLignes - t0,
    analyseSansN1Ms: tAvant - tLignes,
    parseN1Ms: tN1Fin - tN1,
    analyseAvecN1Ms: tFin - tN1Fin,
    lignesN1: lignesN1.length,
  },
  validation: vApres,
};
writeFileSync(
  "/home/z/my-project/download/rapport_n1_smartverif.json",
  JSON.stringify(rapport, null, 1),
);
console.log("\nRapport JSON : /home/z/my-project/download/rapport_n1_smartverif.json");
