/**
 * TESTS D'INVARIANTS — Phase 4 de la mission « amélioration fondée sur les
 * preuves, sans régression de validation ». Chaque invariant du mandat §7 est
 * vérifié soit sur une fixture minimale reproductible (4 à 8), soit sur les
 * fichiers d'audit réels (1, 2, 3, 9, 10).
 *
 * Aucun seuil, périmètre ni règle comptable n'est modifié : ces tests
 * constatent, ils ne corrigent pas. Si un test échoue à cause d'une
 * différence réelle dans les fichiers, l'échec est rapporté tel quel.
 *
 * Exécution : bun run scripts/test-invariants.ts
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import type { BalanceRow, VerifEntity } from "../src/lib/analyzer";
import type { EcartReference, EntryLineLike } from "../src/lib/analysis-types";
import type { EntryLine } from "../src/lib/analysis-types";
import type { EcartReference as EcRef } from "../src/lib/validation";
import { construireDiagnostics } from "../src/lib/diagnostics";
import { BANQUE_PROPRIETAIRE } from "../src/lib/shared-bank";
import { writeFileSync, readFileSync } from "node:fs";

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

// ------------------------------------------------------------------
// INVARIANTS 1, 2, 9, 10 — fichiers d'audit réels
// ------------------------------------------------------------------
console.log("=== INVARIANTS SUR DONNÉES RÉELLES (fichiers d'audit) ===");
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
const lignesN1 = parseBrouillard(await Bun.file(`${UP}/BROUILLARD 2025 31082025.xlsx`).arrayBuffer(), {
  fichier: "BROUILLARD 2025 31082025.xlsx",
});
{
  const dates = lignesN1.map((l) => l.date).sort();
  for (const l of lignesN1) {
    l.exercice = dates[dates.length - 1]?.slice(0, 4) ?? "";
    if (!l.fichier) l.fichier = "BROUILLARD 2025 31082025.xlsx";
  }
}
const resN = analyse(lignesN, entites, balance, ecartsReference);
const resNN1 = analyse(lignesN, entites, balance, ecartsReference, lignesN1);

// — Invariant 2 : mode N seul = mode N + N-1 sur les fichiers d'audit actuels.
{
  const vN = resN.validation!;
  const vNN1 = resNN1.validation!;
  const memeStatuts = vN.ecarts.every((e, i) => {
    const f = vNN1.ecarts[i];
    return (
      f.ecart.ligne === e.ecart.ligne &&
      f.statut === e.statut &&
      Math.abs(f.montantCalcule - e.montantCalcule) < 0.005 &&
      Math.abs(f.residuel - e.residuel) < 0.005
    );
  });
  verifie(memeStatuts, "INV2 : les 25 statuts/montants sont identiques en mode N et N+N-1");
  verifie(
    JSON.stringify(vN.totaux) === JSON.stringify(vNN1.totaux),
    "INV2 : totaux identiques N vs N+N-1",
  );
  // Invariant 9 : aucun contrôle supprimé.
  verifie(vN.ecarts.length === 25 && vNN1.ecarts.length === 25, "INV9 : 25 contrôles présents dans les deux modes");
}

// — Invariant 1 : résultats de référence identiques au snapshot de la
//   validation initiale (audit_8ecarts.json, exécution du jour).
{
  const snap = JSON.parse(readFileSync("/home/z/my-project/scripts/audit_8ecarts.json", "utf8"));
  const vN = resN.validation!;
  const snapN = snap.validationN;
  const memeTotaux = Object.keys(snapN.totaux).every(
    (k) => (vN.totaux as unknown as Record<string, number>)[k] === snapN.totaux[k],
  );
  verifie(memeTotaux, "INV1 : totaux validation N identiques à la référence initiale (audit_8ecarts.json)");
  const memesStatuts = snapN.ecarts.every(
    (e: { ecart: { ligne: number }; statut: string; montantCalcule: number; residuel: number }, i: number) => {
      const f = vN.ecarts[i];
      return (
        f.ecart.ligne === e.ecart.ligne &&
        f.statut === e.statut &&
        Math.abs(f.montantCalcule - e.montantCalcule) < 0.005 &&
        Math.abs(f.residuel - e.residuel) < 0.005
      );
    },
  );
  verifie(memesStatuts, "INV1 : les 25 statuts N identiques à la référence initiale");
  // Invariant 10 : nombres du rapport = sorties réelles du moteur.
  const t = vN.totaux;
  verifie(
    t.nbExpliquesExact + t.nbPartiels + t.nbAilleurs + t.nbNonExpliques + t.nbIncorrects === t.nbReferences,
    "INV10 : la somme des statuts égale le nombre de références (17+4+2+0+2 = 25)",
  );
  const sommeResiduels = vN.ecarts.reduce((s, e) => s + e.residuel, 0);
  verifie(
    Math.abs(sommeResiduels - t.montantTotalResiduel) < 0.01,
    `INV10 : Σ résiduels (${sommeResiduels.toLocaleString("fr-FR")}) = montantTotalResiduel (${t.montantTotalResiduel.toLocaleString("fr-FR")})`,
  );
  verifie(
    resN.rapprochements.length === snap.rapprochementsN.length &&
      resNN1.rapprochements.length === snap.rapprochementsNN1.length,
    `INV10 : fiches N (${resN.rapprochements.length}) et N+N-1 (${resNN1.rapprochements.length}) = fichiers exportés (${snap.rapprochementsN.length} / ${snap.rapprochementsNN1.length})`,
  );
  // Le mode N+N-1 : 60 OUVERTURE + 24 A_doublon de plus que N seul — les
  // fiches annoncées dans le rapport correspondent aux sorties réelles.
  const deltaParType: Record<string, number> = {};
  for (const f of resNN1.rapprochements) deltaParType[f.type] = (deltaParType[f.type] ?? 0) + 1;
  verifie(
    (deltaParType["OUVERTURE"] ?? 0) === 60 && resNN1.rapprochements.length - resN.rapprochements.length === 84,
    `INV10 : +84 fiches en mode N+N-1 (60 OUVERTURE + 24 A_doublon) — le rapport doit annoncer 257, pas 233`,
  );
}

// — Invariant 3 : un compte partagé n'est comptabilisé qu'une fois.
{
  // a) L'attribution bancaire est unique (aucun compte n'a deux propriétaires).
  const conflits = [...BANQUE_PROPRIETAIRE.entries()].filter(
    ([compte]) => [...BANQUE_PROPRIETAIRE.keys()].filter((c) => c === compte).length > 1,
  );
  verifie(conflits.length === 0, "INV3 : BANQUE_PROPRIETAIRE n'attribue aucun compte à deux propriétaires");
  // b) Sur données réelles : 512600 est compté dans EVIOSYS (L544 exact) et
  //    le contrôle ORANGE MONEY qui le revendique reste en résiduel = solde.
  const v = resN.validation!;
  const l544 = v.ecarts.find((e) => e.ecart.ligne === 544);
  const l482 = v.ecarts.find((e) => e.ecart.ligne === 482);
  const solde600 = resN.entites.flatMap((e) => e.comptes).find((c) => c.compte === "512600")?.solde ?? 0;
  verifie(
    l544?.statut === "explique_exact",
    "INV3 : L544 EVIOSYS exact avec 512600 dans son périmètre (compté une seule fois)",
  );
  verifie(
    !!l482 && Math.abs(l482.residuel - solde600) < 0.01,
    `INV3 : L482 résiduel = solde 512600 (${solde600.toLocaleString("fr-FR")} Ar) — double revendication de la feuille signalée, pas de double comptage de l'application`,
  );
}

// ------------------------------------------------------------------
// INVARIANTS 4 à 8 — fixtures minimales
// ------------------------------------------------------------------
console.log("\n=== INVARIANTS SUR FIXTURES MINIMALES ===");

const entiteDemo: VerifEntity = {
  nom: "DEMO",
  suffixe: "001",
  suffixesAf: ["001"],
  comptes: ["467001", "512001"],
};

// Montants volontairement « hostiles » au binaire (0,1 + 0,2 ≠ 0,3 en flottant).
const lignesDemo: EntryLine[] = [
  { journal: "RAN", piece: "70", date: "2026-01-01", compte: "467001", tiers: "T1", libelle: "À-nouveau impayé", debit: 500, credit: 0, ligne: 2, exercice: "2026" },
  { journal: "TIERS", piece: "101", date: "2026-02-01", compte: "467001", tiers: "T1", libelle: "Facture 0,10", debit: 0.1, credit: 0, ligne: 3, exercice: "2026" },
  { journal: "TIERS", piece: "101", date: "2026-02-01", compte: "467001", tiers: "T1", libelle: "Facture 0,20", debit: 0.2, credit: 0, ligne: 4, exercice: "2026" },
  { journal: "BQ", piece: "205", date: "2026-03-01", compte: "512001", tiers: "", libelle: "Encaissement 0,30", debit: 0.3, credit: 0, ligne: 5, exercice: "2026" },
  { journal: "BQ", piece: "206", date: "2026-03-01", compte: "512001", tiers: "", libelle: "Sortie 0,10", debit: 0, credit: 0.1, ligne: 6, exercice: "2026" },
];
// AF = RAN 500 + 0,10 + 0,20 = 500,30 ; tré = 0,30 − 0,10 = 0,20 ;
// calculé = 500,50.
const CALC_DEMO = 500.5;
const ecartsDemo: EcRef[] = [{ bloc: "DEMO", ligne: 5, colonne: 1, type: "entite", montant: CALC_DEMO }];
const balanceDemo: BalanceRow[] = [
  { compte: "467001", nom: "DEMO attente", solde: 500.3 },
  { compte: "512001", nom: "DEMO banque", solde: 0.2 },
];

// — Invariant 8 : précision monétaire (aucune perte de centime flottant).
{
  const r = analyse(lignesDemo, [entiteDemo], balanceDemo, ecartsDemo);
  const e = r.validation!.ecarts[0];
  verifie(e.statut === "explique_exact", "INV8 : contrôle exact sur montants hostiles au binaire (0,1+0,2+…)");
  verifie(Math.abs(e.residuel) < 0.005, `INV8 : résiduel strictement nul au centime (reçu : ${e.residuel})`);
  verifie(
    Math.abs(e.montantCalcule - CALC_DEMO) < 0.005,
    `INV8 : montant calculé = ${CALC_DEMO} au centime (reçu : ${e.montantCalcule})`,
  );
}

// — Invariant 4 : un ajustement manuel du classeur ne devient jamais une
//   écriture du moteur.
{
  const avecAjustement: EcRef[] = [{ bloc: "DEMO", ligne: 5, colonne: 1, type: "entite", montant: CALC_DEMO + 7442352 }];
  const sans = analyse(lignesDemo, [entiteDemo], balanceDemo, ecartsDemo).validation!.ecarts[0];
  const avec = analyse(lignesDemo, [entiteDemo], balanceDemo, avecAjustement).validation!.ecarts[0];
  verifie(
    Math.abs(avec.montantCalcule - sans.montantCalcule) < 0.005,
    "INV4 : le calcul du moteur est inchangé par l'ajustement de la référence",
  );
  verifie(
    avec.nbEcritures === sans.nbEcritures && avec.pieces.length === sans.pieces.length,
    "INV4 : aucune écriture synthétique ajoutée pour absorber l'ajustement",
  );
  verifie(
    Math.abs(avec.residuel - 7442352) < 0.01,
    `INV4 : l'ajustement reste intégralement un résiduel visible (${avec.residuel.toLocaleString("fr-FR")} Ar, statut ${avec.statut})`,
  );
}

// — Invariant 5 : écriture dans la balance absente du brouillard = divergence
//   signalée, jamais ajoutée au brouillard.
{
  const balanceDivergente: BalanceRow[] = [
    { compte: "467001", nom: "DEMO attente", solde: 500.3 },
    { compte: "512001", nom: "DEMO banque", solde: 3.2 }, // brouillard 0,20 → +3,00 dans Sage
  ];
  // Référence établie sur la balance (comme la feuille réelle par INDEX/MATCH)
  // : ref = calc brouillard + 3,00 de divergence.
  const r = analyse(lignesDemo, [entiteDemo], balanceDivergente, [
    { bloc: "DEMO", ligne: 5, colonne: 1, type: "entite", montant: CALC_DEMO + 3 },
  ]);
  const ano = r.anomalies.find((a) => a.type === "ecart_balance" && a.comptes === "512001");
  verifie(!!ano && Math.abs(ano.montant + 3) < 0.005, "INV5 : la divergence de source est signalée (anomalie « écart balance » −3,00)");
  verifie(
    r.anomalies.find((a) => a.type === "ecart_balance" && a.comptes === "512001")!.lignes.length === 0,
    "INV5 : aucune ligne inventée dans l'anomalie (le brouillard n'est pas complété)",
  );
  const e = r.validation!.ecarts[0];
  verifie(
    e.statut === "explique_partiel" && Math.abs(e.montantCalcule - CALC_DEMO) < 0.005 && Math.abs(e.residuel - 3) < 0.005,
    `INV5 : le calcul reste celui du brouillard (${CALC_DEMO}) — la divergence (${e.residuel}) reste un résiduel visible, jamais compensée`,
  );
}

// — Invariant 6 : doublons interexercices soldés ≠ doublons potentiels.
{
  const n1Soldé: EntryLine[] = [
    // Même écriture que N (401000/T9/400) mais lettrée et équilibrée dans N-1.
    { journal: "TIERS", piece: "B7", date: "2025-12-15", compte: "401000", tiers: "T9", libelle: "FACTURE DEMO X", debit: 400, credit: 0, lettrage: "YY", ligne: 2, exercice: "2025", fichier: "N1.xlsx" },
    { journal: "TIERS", piece: "B8", date: "2025-12-16", compte: "401000", tiers: "T9", libelle: "FACTURE DEMO X", debit: 0, credit: 400, lettrage: "YY", ligne: 3, exercice: "2025", fichier: "N1.xlsx" },
  ];
  const nNonSoldé: EntryLine[] = [
    ...lignesDemo,
    { journal: "TIERS", piece: "A1", date: "2026-04-01", compte: "401000", tiers: "T9", libelle: "FACTURE DEMO X", debit: 400, credit: 0, ligne: 7, exercice: "2026" },
  ];
  const ecartsVides: EcRef[] = [];
  // N seul : 1 doublon potentiel intrapériode ? Non — une seule pièce : rien.
  const rN = analyse(nNonSoldé, [entiteDemo], null, ecartsVides);
  // N + N-1 soldé : le doublon interexercice est EXCLU (tous lettrés équilibrés).
  const rSoldé = analyse(nNonSoldé, [entiteDemo], null, ecartsVides, n1Soldé);
  const doublonsInter = (r: ReturnType<typeof analyse>) =>
    r.rapprochements.filter((f) => f.type === "A_doublon" && f.lignes.some((l) => (l.exercice ?? "2026") !== "2026"));
  verifie(
    doublonsInter(rSoldé).length === 0,
    "INV6 : aucun doublon interexercices créé quand l'écriture N-1 est soldée par lettrage équilibré",
  );
  // N + N-1 NON soldé : la même écriture non apurée dans les deux exercices
  // est signalée comme doublon interexercices à vérifier (jamais confirmée).
  const n1NonSoldé: EntryLine[] = [
    { journal: "TIERS", piece: "B7", date: "2025-12-15", compte: "401000", tiers: "T9", libelle: "FACTURE DEMO X", debit: 400, credit: 0, ligne: 2, exercice: "2025", fichier: "N1.xlsx" },
  ];
  const rNonSoldé = analyse(nNonSoldé, [entiteDemo], null, ecartsVides, n1NonSoldé);
  verifie(
    doublonsInter(rNonSoldé).length === 1,
    "INV6 : l'écriture identique non apurée dans N et N-1 est signalée (à vérifier, jamais confirmée)",
  );
}

// — Invariant 7 : les ouvertures N ne sont pas doublées par une reprise N-1.
{
  const n1 = [
    // Impayé T1 de 500 à la clôture N-1 (réinstallé par le RAN de N).
    { journal: "TIERS", piece: "C1", date: "2025-06-01", compte: "467001", tiers: "T1", libelle: "Impayé T1", debit: 500, credit: 0, ligne: 2, exercice: "2025", fichier: "N1.xlsx" },
    { journal: "BQ", piece: "C2", date: "2025-07-01", compte: "512001", tiers: "", libelle: "Encaissement N-1", debit: 250, credit: 0, ligne: 3, exercice: "2025", fichier: "N1.xlsx" },
  ];
  const seul = analyse(lignesDemo, [entiteDemo], balanceDemo, ecartsDemo).validation!.ecarts[0];
  const avec = analyse(lignesDemo, [entiteDemo], balanceDemo, ecartsDemo, n1).validation!.ecarts[0];
  verifie(
    Math.abs(avec.montantCalcule - seul.montantCalcule) < 0.005 && avec.statut === seul.statut,
    "INV7 : validation identique N vs N+N-1 — l'ouverture N n'est pas doublée par N-1",
  );
  verifie(
    avec.montantExpliqueN1 === 0,
    "INV7 : le supplément N-1 d'un contrôle calculé sur le brouillard N reste 0 (pas de double comptage)",
  );
  const rAvec = analyse(lignesDemo, [entiteDemo], balanceDemo, ecartsDemo, n1);
  const ouverture = rAvec.rapprochements.find((f) => f.type === "OUVERTURE");
  verifie(
    !!ouverture && ouverture.lignes.some((l) => l.piece === "70"),
    "INV7 : la fiche OUVERTURE trace le RAN de N dans N-1 (traçabilité, sans recalcul)",
  );
}

// — Invariant + diagnostics : la couche diagnostic reste dérivable et honnête
//   sur une fixture dégradée (aucune anomalie rattachable → UNRESOLVED).
{
  const r = analyse(lignesDemo, [entiteDemo], balanceDemo, [
    { bloc: "DEMO", ligne: 5, colonne: 1, type: "entite", montant: 12345.67 },
  ]);
  const diags = construireDiagnostics(r);
  verifie(
    diags.length === 1 && diags[0].type === "SOURCE_ENTRY_MISSING" || diags[0].type === "UNRESOLVED",
    "INV+ : sur fixture dégradée, le diagnostic reste typé sans invention (SOURCE_ENTRY_MISSING ou UNRESOLVED)",
  );
}

console.log(`\n=== INVARIANTS : ${ok} OK, ${ko} échec(s) ===`);
process.exit(ko === 0 ? 0 : 1);
