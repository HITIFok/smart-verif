/**
 * TESTS INTEREXERCICES (brouillard N-1) — mission « Rapprochement
 * interexercices avec le brouillard N-1 », cahier de tests §7 (14 situations).
 *
 * Exécution : bun run scripts/test-n1.ts
 * Chaque situation construit un brouillard N (+ N-1 facultatif) synthétique,
 * exécute analyse() du moteur réel et vérifie les comportements opposables :
 * exercices distingués, contreparties justifiées, anti double comptage,
 * écritures annulées, fichier N-1 absent/illisible, traçabilité des lignes
 * Excel d'origine, reproductibilité de la validation.
 */
import { analyse, parseBrouillard, type VerifEntity } from "../src/lib/analyzer";
import type { EntryLine } from "../src/lib/analysis-types";
import * as XLSX from "xlsx";

let pass = 0;
let fail = 0;
const echecs: string[] = [];
function verifie(cond: boolean, nom: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    echecs.push(nom);
    console.error(`  ✗ ${nom}`);
  }
}
function egal<T>(a: T, b: T, nom: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    fail++;
    echecs.push(`${nom} — attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
    console.error(`  ✗ ${nom} — attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
  } else pass++;
}

/** Fabrique une ligne du brouillard N (exercice 2026, fichier N). */
let seqLigne = 0;
function L(
  journal: string,
  piece: string,
  date: string,
  compte: string,
  tiers: string,
  libelle: string,
  debit: number,
  credit: number,
): EntryLine {
  seqLigne++;
  return {
    journal,
    piece,
    date,
    compte,
    tiers,
    libelle,
    debit,
    credit,
    ligne: seqLigne,
    exercice: "2026",
    fichier: "BROUILLARD_2026.xlsx",
  };
}

/** Fabrique une ligne du brouillard N-1 (exercice 2025, fichier N-1) —
 *  comme le fait le worker : exercice déduit de la dernière date, fichier
 *  = nom du fichier importé. */
function LN1(
  journal: string,
  piece: string,
  date: string,
  compte: string,
  tiers: string,
  libelle: string,
  debit: number,
  credit: number,
): EntryLine {
  const l = L(journal, piece, date, compte, tiers, libelle, debit, credit);
  l.exercice = "2025";
  l.fichier = "BROUILLARD_2025.xlsx";
  return l;
}

/** Entité de vérification minimale. */
function E(nom: string, suffixes: string[], banques: string[] = []): VerifEntity {
  const comptes = [...suffixes.flatMap((s) => [`467${s}`, `460${s}`]), ...banques];
  return { nom, suffixe: suffixes[0] ?? "", suffixesAf: [...suffixes], comptes };
}

const VERIF_STD = (): VerifEntity[] => [
  E("HOLCIM", ["110"], ["512110"]),
  E("TELMA", ["140"], ["512140"]),
  E("MCI CARE", [], ["512000"]),
];

function controle(result: ReturnType<typeof analyse>, type: string, societe?: string) {
  return result.rapprochements.filter(
    (c) => c.type === type && (!societe || c.societe === societe),
  );
}

// ====================================================================
// TEST 1 — rapprochement correct dans N sans N-1 (non-régression)
// ====================================================================
console.log("— T1 : rapprochement correct dans N sans N-1");
{
  const lignes = [
    // Honoraires 411 encaissés sur BOAHOL (HOLCIM) puis transférés vers MCI
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const r = analyse(lignes, VERIF_STD());
  const c = controle(r, "A_411", "HOLCIM");
  egal(c.length, 1, "T1 : une fiche A_411 pour HOLCIM");
  egal(c[0]?.statut, "correspondance_trouvee", "T1 : transfert intégral → correspondance");
  egal(c[0]?.montantAttendu, 10_000, "T1 : attendu 10 000 (N seul)");
  egal(c[0]?.montantRapproche, 10_000, "T1 : rapproché 10 000");
  egal(c[0]?.ecartRestant, 0, "T1 : restant 0");
  verifie(r.n1 === null, "T1 : aucun N-1 fourni → result.n1 null");
  verifie(r.n1Erreur === undefined, "T1 : aucune erreur N-1 signalée");
  verifie(!controle(r, "OUVERTURE").length, "T1 : aucun contrôle OUVERTURE sans brouillard N-1");
  verifie(
    !r.rapprochements.some((x) => x.explication.includes("N-1")),
    "T1 : aucune mention N-1 dans les explications",
  );
}

// ====================================================================
// TEST 2 — contrepartie décembre N-1 ↔ janvier N (règle A_411, paire
// interexercices, chronologie envoy avant réception)
// ====================================================================
console.log("— T2 : contrepartie décembre N-1 ↔ janvier N");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "61", "2026-01-10", "512000", "", "", 10_000, 0),
    L("BOAMCI", "61", "2026-01-10", "580001", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const lignesN1 = [
    // Honoraires N-1 encaissés sur BOAHOL, non apurés à la clôture N-1
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 10_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 10_000, 0),
    // Transfert initié fin décembre N-1 (envoi), dénoué en N (réception 62)
    LN1("BOAHOL", "55", "2025-12-20", "580001", "", "", 10_000, 0),
    LN1("BOAHOL", "55", "2025-12-20", "512110", "", "", 0, 10_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c.length, 1, "T2 : une fiche A_411");
  egal(c[0]?.montantAttendu, 20_000, "T2 : attendu 20 000 (10 000 N + 10 000 N-1)");
  egal(c[0]?.montantRapproche, 20_000, "T2 : rapproché 20 000 (paire N + paire interexercice)");
  egal(c[0]?.ecartRestant, 0, "T2 : restant 0");
  egal(c[0]?.montantAttenduN1, 10_000, "T2 : ventilation attendu N-1 = 10 000");
  egal(c[0]?.montantRapprocheN1, 10_000, "T2 : ventilation rapproché N-1 = 10 000");
  egal(c[0]?.statut, "correspondance_trouvee", "T2 : statut correspondance trouvée");
  verifie(
    (c[0]?.explication ?? "").includes("interexercices"),
    "T2 : l'explication cite le transfert interexercices",
  );
  verifie(r.n1 !== null, "T2 : result.n1 renseigné");
  egal(r.n1?.exercice, "2025", "T2 : exercice N-1 = 2025");
  egal(r.n1?.fichier, "BROUILLARD_2025.xlsx", "T2 : fichier N-1 tracé");
}

// ====================================================================
// TEST 3 — solde d'ouverture : à-nouveau RAN de N tracé dans N-1
// (correspondance exacte compte + tiers + montant, JAMAIS une anomalie)
// ====================================================================
console.log("— T3 : solde d'ouverture d'opération antérieure");
{
  const lignesN = [
    // À-nouveau d'ouverture : le solde client 467110 reporté au 01/01
    L("RAN", "R1", "2026-01-01", "467110", "C110", "A NOUVEAU SOLDE", 5_000, 0),
    L("RAN", "R1", "2026-01-01", "512110", "", "A NOUVEAU SOLDE", 0, 5_000),
  ];
  const lignesN1 = [
    // L'opération d'origine existe dans N-1 (même compte, tiers, montant)
    LN1("BOAHOL", "80", "2025-12-31", "467110", "C110", "AVANCE CLIENT", 5_000, 0),
    LN1("BOAHOL", "80", "2025-12-31", "512110", "", "AVANCE CLIENT", 0, 5_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const o = controle(r, "OUVERTURE");
  egal(o.length, 1, "T3 : une fiche OUVERTURE");
  egal(o[0]?.statut, "correspondance_trouvee", "T3 : statut correspondance (jamais une anomalie)");
  egal(o[0]?.societe, "HOLCIM", "T3 : rattachée à HOLCIM (suffixe 46x)");
  egal(o[0]?.montantAttendu, 5_000, "T3 : net de l'à-nouveau 5 000");
  egal(o[0]?.ecartRestant, 0, "T3 : ecartRestant 0 (rien à corriger)");
  verifie(
    (o[0]?.explication ?? "").includes("brouillard N-1"),
    "T3 : l'explication cite le brouillard N-1",
  );
  verifie(
    (o[0]?.lignes ?? []).some((l) => l.exercice === "2025" && l.fichier === "BROUILLARD_2025.xlsx"),
    "T3 : les lignes N-1 citent exercice + fichier",
  );
  egal(r.n1?.ranTraces, 1, "T3 : compteur RAN tracés = 1");
  egal(r.n1?.ranAmbigus, 0, "T3 : compteur RAN ambigus = 0");
}

// ====================================================================
// TEST 4 — opération non apurée à la clôture : l'attendu N-1 résiduel
// s'ajoute honnêtement (transfert partiel, aucun rapprochement inventé)
// ====================================================================
console.log("— T4 : opération non apurée à la clôture");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const lignesN1 = [
    // Encaissement N-1 jamais transféré (aucun envoi N-1, aucune paire)
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 10_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 10_000, 0),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c[0]?.statut, "transfert_partiel", "T4 : statut transfert partiel (honnête)");
  egal(c[0]?.montantAttendu, 20_000, "T4 : attendu 20 000 (N + résidu N-1)");
  egal(c[0]?.montantRapproche, 10_000, "T4 : rapproché 10 000 (paire N seule)");
  egal(c[0]?.ecartRestant, 10_000, "T4 : restant 10 000");
  egal(c[0]?.montantAttenduN1, 10_000, "T4 : attendu N-1 = 10 000");
  egal(c[0]?.montantRapprocheN1, 0, "T4 : rapproché N-1 = 0 (aucune paire inventée)");
  verifie(
    (c[0]?.explication ?? "").includes("non apurés à la clôture N-1"),
    "T4 : l'explication distingue le résidu N-1",
  );
}

// ====================================================================
// TEST 5 — faux rapprochement entre deux exercices : des montants
// égaux ne suffisent JAMAIS (pas de contrepartie 580001 justifiée)
// ====================================================================
console.log("— T5 : pas de faux rapprochement entre exercices");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const lignesN1 = [
    // Honoraires N-1 de 25 000 : même banque, pas de transfert 580001 —
    // aucune contrepartie n'existe, le montant ne rapproche rien.
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 25_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 25_000, 0),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c[0]?.montantAttendu, 35_000, "T5 : attendu 35 000 (10 000 N + 25 000 N-1)");
  egal(c[0]?.montantRapproche, 10_000, "T5 : rapproché 10 000 SEULEMENT (paire N de N)");
  egal(c[0]?.ecartRestant, 25_000, "T5 : restant 25 000 (rien d'inventé)");
  egal(c[0]?.montantRapprocheN1, 0, "T5 : rapproché N-1 = 0");
  egal(c[0]?.statut, "transfert_partiel", "T5 : statut transfert partiel");
  verifie(
    !(c[0]?.explication ?? "").includes("interexercices (envoi N-1"),
    "T5 : aucune couverture interexercices revendiquée",
  );
}

// ====================================================================
// TEST 6 — référence de pièce identique mais tiers différent : la
// justification N-1 exige le MÊME tiers (jamais un homonyme)
// ====================================================================
console.log("— T6 : pièce identique, tiers différent → pas de trace N-1");
{
  const lignesN = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467110", "", "", 0, 1_000_000),
    // La pièce TIERS désigne TELMA (467140) ; le paiement part de BOAHOL
    L("TIERS", "10", "2026-01-05", "467140", "", "Prestataire payé pour TELMA", 500, 0),
    L("TIERS", "10", "2026-01-05", "401000", "T1", "Prestataire payé pour TELMA", 0, 500),
    // Paiement décaissé par la mauvaise banque, sans régularisation
    L("BOAHOL", "11", "2026-01-06", "401000", "T1", "Prestataire payé pour TELMA", 500, 0),
    L("BOAHOL", "11", "2026-01-06", "512110", "", "", 0, 500),
  ];
  // N-1 : une écriture 401 de même MONTANT mais d'un AUTRE tiers →
  // elle ne justifie PAS le paiement (clé tiers + montant).
  const lignesN1 = [
    LN1("BOAHOL", "80", "2025-12-20", "401000", "T9", "Facture autre fournisseur", 0, 500),
    LN1("BOAHOL", "80", "2025-12-20", "512110", "", "Facture autre fournisseur", 500, 0),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_paiement");
  egal(c.length, 1, "T6 : la fiche paiement existe toujours");
  egal(c[0]?.societe, "TELMA", "T6 : rattachée à TELMA (pièce TIERS 467140)");
  egal(c[0]?.statut, "erreur_imputation_probable", "T6 : statut inchangé");
  verifie(
    !(c[0]?.explication ?? "").includes("exercice N-1"),
    "T6 : AUCUNE justification N-1 (tiers différent)",
  );
  verifie(
    !(c[0]?.lignes ?? []).some((l) => l.exercice === "2025"),
    "T6 : aucune ligne N-1 citée en source",
  );
  // Contre-épreuve : avec le BON tiers, la trace N-1 est ajoutée (traçabilité
  // seule) sans changer le statut.
  const lignesN1b = [
    LN1("BOAHOL", "81", "2025-12-20", "401000", "T1", "Prestataire facture", 0, 500),
    LN1("BOAHOL", "81", "2025-12-20", "512110", "", "Prestataire facture", 500, 0),
  ];
  const r2 = analyse(lignesN, VERIF_STD(), null, [], lignesN1b);
  const c2 = controle(r2, "A_paiement");
  egal(c2.length, 1, "T6b : la fiche paiement existe");
  egal(c2[0]?.statut, "erreur_imputation_probable", "T6b : statut INCHANGÉ par la trace N-1");
  verifie(
    (c2[0]?.explication ?? "").includes("exercice N-1"),
    "T6b : la trace N-1 documente l'opération d'origine",
  );
  verifie(
    (c2[0]?.lignes ?? []).some((l) => l.exercice === "2025" && l.piece === "81"),
    "T6b : la pièce N-1 (81) est citée en source traçable",
  );
}

// ====================================================================
// TEST 7 — même montant dans deux sociétés différentes : aucune
// confusion (les paires sont indexées par compte bancaire exact)
// ====================================================================
console.log("— T7 : même montant, deux sociétés → pas de mélange");
{
  const lignes = [
    // HOLCIM : honoraires 10 000 + paire complète
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES HOLCIM", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES HOLCIM", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
    // TELMA : honoraires 10 000 (même montant) SANS aucun transfert
    L("BOATEL", "41", "2026-01-05", "411000", "", "HONORAIRES TELMA", 0, 10_000),
    L("BOATEL", "41", "2026-01-05", "512140", "", "HONORAIRES TELMA", 10_000, 0),
  ];
  const lignesN1 = [
    // N-1 : résidu TELMA de 15 000 jamais transféré
    LN1("BOATEL", "52", "2025-12-15", "411000", "", "HONORAIRES TELMA N-1", 0, 15_000),
    LN1("BOATEL", "52", "2025-12-15", "512140", "", "HONORAIRES TELMA N-1", 15_000, 0),
  ];
  const r = analyse(lignes, VERIF_STD(), null, [], lignesN1);
  const hol = controle(r, "A_411", "HOLCIM");
  const tel = controle(r, "A_411", "TELMA");
  egal(hol.length, 1, "T7 : fiche HOLCIM");
  egal(hol[0]?.montantAttendu, 10_000, "T7 : attendu HOLCIM 10 000");
  egal(hol[0]?.montantRapproche, 10_000, "T7 : rapproché HOLCIM 10 000 (sa propre paire)");
  egal(hol[0]?.statut, "correspondance_trouvee", "T7 : HOLCIM soldée");
  egal(tel.length, 1, "T7 : fiche TELMA");
  egal(tel[0]?.montantAttendu, 25_000, "T7 : attendu TELMA 25 000 (10 000 N + 15 000 N-1)");
  egal(tel[0]?.montantRapproche, 0, "T7 : rapproché TELMA 0 — la paire de HOLCIM ne la couvre pas");
  egal(tel[0]?.ecartRestant, 25_000, "T7 : restant TELMA 25 000");
  egal(tel[0]?.montantAttenduN1, 15_000, "T7 : attendu N-1 TELMA = 15 000");
  egal(tel[0]?.montantRapprocheN1, 0, "T7 : rapproché N-1 TELMA = 0");
  egal(tel[0]?.statut, "transfert_absent", "T7 : TELMA transfert absent (honnête)");
}

// ====================================================================
// TEST 8 — transfert partiellement rapproché N-1/N (fenêtre
// interexercices, chronologie, ventilation N-1 partielle)
// ====================================================================
console.log("— T8 : transfert partiel N-1/N");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
    L("BOAMCI", "61", "2026-01-10", "512000", "", "", 20_000, 0),
    L("BOAMCI", "61", "2026-01-10", "580001", "", "", 0, 20_000),
  ];
  const lignesN1 = [
    // Honoraires N-1 de 30 000 non apurés ; 20 000 transférés fin décembre
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 30_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 30_000, 0),
    LN1("BOAHOL", "55", "2025-12-20", "580001", "", "", 20_000, 0),
    LN1("BOAHOL", "55", "2025-12-20", "512110", "", "", 0, 20_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c[0]?.montantAttendu, 40_000, "T8 : attendu 40 000 (10 000 N + 30 000 N-1)");
  egal(c[0]?.montantRapproche, 30_000, "T8 : rapproché 30 000 (10 000 intra-N + 20 000 inter)");
  egal(c[0]?.ecartRestant, 10_000, "T8 : restant 10 000");
  egal(c[0]?.montantAttenduN1, 30_000, "T8 : attendu N-1 = 30 000");
  egal(c[0]?.montantRapprocheN1, 20_000, "T8 : rapproché N-1 = 20 000");
  egal(c[0]?.statut, "transfert_partiel", "T8 : statut transfert partiel");
  verifie(
    (c[0]?.explication ?? "").includes("par des transferts interexercices"),
    "T8 : l'explication ventile la part interexercices",
  );
}

// ====================================================================
// TEST 9 — écriture annulée/contrepassée : le net N-1 se solde,
// aucun attendu fictif
// ====================================================================
console.log("— T9 : écriture annulée/contrepassée en N-1");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const lignesN1 = [
    // Encaissement N-1 PUIS contrepassation intégrale : net 411 = 0
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES A ANNULER", 0, 10_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES A ANNULER", 10_000, 0),
    LN1("BOAHOL", "51", "2025-12-16", "411000", "", "ANNULATION HONORAIRES", 10_000, 0),
    LN1("BOAHOL", "51", "2025-12-16", "512110", "", "ANNULATION HONORAIRES", 0, 10_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c[0]?.montantAttendu, 10_000, "T9 : attendu 10 000 (l'annulation ne crée rien)");
  egal(c[0]?.montantAttenduN1, undefined, "T9 : aucune ventilation N-1 (net nul)");
  egal(c[0]?.montantRapproche, 10_000, "T9 : rapproché 10 000");
  egal(c[0]?.statut, "correspondance_trouvee", "T9 : statut correspondance trouvée");
  verifie(
    !(c[0]?.explication ?? "").includes("non apurés à la clôture N-1"),
    "T9 : aucune mention de résidu N-1",
  );
}

// ====================================================================
// TEST 10 — absence de fichier N-1 : le moteur fonctionne à
// l'identique (import facultatif, comportement historique)
// ====================================================================
console.log("— T10 : absence de fichier N-1");
{
  const lignes = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
  ];
  const r1 = analyse(lignes, VERIF_STD());
  const r2 = analyse(lignes, VERIF_STD(), null, [], []);
  egal(r1.n1, null, "T10 : sans argument N-1 → n1 null");
  egal(r2.n1, null, "T10 : avec N-1 vide (0 ligne) → n1 null");
  egal(
    JSON.stringify(r1.rapprochements),
    JSON.stringify(r2.rapprochements),
    "T10 : fiches strictement identiques",
  );
  egal(r1.validation, null, "T10 : validation absente sans écarts de référence");
  verifie(
    controle(r1, "A_411", "HOLCIM")[0]?.statut === "transfert_absent",
    "T10 : statut honnête sans N-1 (transfert absent)",
  );
}

// ====================================================================
// TEST 11 — fichier N-1 illisible : erreur propre, l'analyse de N
// continue (le parseur réel échoue ; le worker dégrade sans casser)
// ====================================================================
console.log("— T11 : fichier N-1 incomplet/illisible");
{
  // a) Un xlsx valide mais SANS écritures lisibles → 0 ligne → n1 null
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Export N-1"],
      [],
      [
        "Code journal",
        "Date",
        "N° pièce",
        "N° facture",
        "Référence",
        "N° compte général",
        "N° compte tiers",
        "Libellé écriture",
        "Lettrage montant",
        "Débit",
        "Crédit",
      ],
      [],
      ["ligne sans compte", "2025-12-31", 1, "", "", "XX", "", "", "", "", ""],
    ]),
    "Feuil1",
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const lignesN1 = parseBrouillard(buf, { fichier: "N-1_vide.xlsx" });
  egal(lignesN1.length, 0, "T11 : le brouillard N-1 sans écritures valides → 0 ligne");
  const lignes = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
  ];
  const r = analyse(lignes, VERIF_STD(), null, [], lignesN1);
  egal(r.n1, null, "T11 : N-1 vide → n1 null, analyse N normale");
  egal(
    controle(r, "A_411", "HOLCIM")[0]?.statut,
    "transfert_absent",
    "T11 : le contrôle N reste correct",
  );
  // b) Un vrai fichier corrompu : soit XLSX.read lève une erreur (captée par
  // le worker), soit il est lu comme texte et donne 0 ligne valide — dans les
  // deux cas la dégradation est sûre (analyse continue sur N seul, n1 null).
  let degr1 = "";
  let nbCorrompu = -1;
  try {
    const lc = parseBrouillard(
      new TextEncoder().encode("ceci n'est pas un xlsx").buffer as ArrayBuffer,
      { fichier: "N-1_corrompu.xlsx" },
    );
    nbCorrompu = lc.filter((l) => /^\d{6}$/.test(l.compte)).length;
  } catch (e) {
    degr1 = e instanceof Error ? e.message : String(e);
  }
  verifie(
    degr1.length > 0 || nbCorrompu === 0,
    "T11 : un N-1 corrompu est rejeté proprement (erreur claire ou 0 écriture)",
  );
}

// ====================================================================
// TEST 12 — prévention du double comptage interexercices : une paire
// apurée DANS N-1 ne couvre jamais un besoin de N
// ====================================================================
console.log("— T12 : anti double comptage interexercices");
{
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    // Aucune paire 580001 dans N
  ];
  const lignesN1 = [
    // Honoraires N-1, PUIS paire complète APURÉE DANS N-1 (envoi + réception)
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 10_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 10_000, 0),
    LN1("BOAHOL", "55", "2025-12-20", "580001", "", "", 10_000, 0),
    LN1("BOAHOL", "55", "2025-12-20", "512110", "", "", 0, 10_000),
    LN1("BOAMCI", "56", "2025-12-22", "512000", "", "", 10_000, 0),
    LN1("BOAMCI", "56", "2025-12-22", "580001", "", "", 0, 10_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const c = controle(r, "A_411", "HOLCIM");
  egal(c.length, 1, "T12 : la fiche A_411 existe (honoraires N)");
  egal(c[0]?.montantAttendu, 10_000, "T12 : attendu 10 000 — la paire N-1 apurée n'ajoute RIEN");
  egal(c[0]?.montantRapproche, 0, "T12 : rapproché 0 — la paire N-1 ne couvre pas N");
  egal(c[0]?.montantAttenduN1, undefined, "T12 : aucune ventilation N-1 (déjà apuré en N-1)");
  egal(c[0]?.statut, "transfert_absent", "T12 : statut honnête transfert absent");
  egal(c[0]?.ecartRestant, 10_000, "T12 : restant 10 000 (les honoraires N restent dus)");
}

// ====================================================================
// TEST 13 — conservation des n° de lignes Excel d'origine (parse réel
// du xlsx N-1 + traçabilité dans les fiches)
// ====================================================================
console.log("— T13 : n° de lignes Excel d'origine conservés");
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Export N-1 2025"],
      [],
      [
        "Code journal",
        "Date",
        "N° pièce",
        "N° facture",
        "Référence",
        "N° compte général",
        "N° compte tiers",
        "Libellé écriture",
        "Lettrage montant",
        "Débit",
        "Crédit",
      ],
      ["BOAHOL", "2025-12-31", 80, "", "", "467110", "C110", "AVANCE CLIENT", "", 5000, ""],
      ["BOAHOL", "2025-12-31", 80, "", "", "512110", "", "AVANCE CLIENT", "", "", 5000],
    ]),
    "Feuil1",
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const lignesN1 = parseBrouillard(buf, { fichier: "BROUILLARD 2025.xlsx" });
  egal(lignesN1.length, 2, "T13 : deux lignes importées du xlsx N-1");
  egal(lignesN1[0]?.ligne, 4, "T13 : première écriture à la ligne Excel 4");
  egal(lignesN1[1]?.ligne, 5, "T13 : deuxième écriture à la ligne Excel 5");
  egal(lignesN1[0]?.fichier, "BROUILLARD 2025.xlsx", "T13 : fichier source tracé");
  // Étiquetage exercice comme le worker (dernière date du brouillard)
  const dates = lignesN1
    .map((l) => l.date)
    .filter(Boolean)
    .sort();
  const exerciceN1 = dates[dates.length - 1]?.slice(0, 4) ?? "";
  for (const l of lignesN1) l.exercice = exerciceN1;
  egal(exerciceN1, "2025", "T13 : exercice déduit de la dernière date = 2025");

  const lignesN = [
    L("RAN", "R1", "2026-01-01", "467110", "C110", "A NOUVEAU SOLDE", 5_000, 0),
    L("RAN", "R1", "2026-01-01", "512110", "", "A NOUVEAU SOLDE", 0, 5_000),
  ];
  const r = analyse(lignesN, VERIF_STD(), null, [], lignesN1);
  const o = controle(r, "OUVERTURE");
  egal(o.length, 1, "T13 : fiche OUVERTURE avec le xlsx réel N-1");
  const sourceN1 = (o[0]?.lignes ?? []).find((l) => l.exercice === "2025");
  verifie(!!sourceN1, "T13 : la fiche cite une ligne N-1");
  egal(sourceN1?.fichier, "BROUILLARD 2025.xlsx", "T13 : fichier N-1 dans la fiche");
  egal(sourceN1?.ligne, 4, "T13 : n° de ligne Excel d'origine (4) conservé dans la fiche");
  egal(sourceN1?.piece, "80", "T13 : pièce N-1 (80) citée");
}

// ====================================================================
// TEST 14 — reproductibilité : deux exécutions identiques, et la
// validation (Feuil2) STRICTEMENT inchangée par le brouillard N-1
// ====================================================================
console.log("— T14 : reproductibilité et validation inchangée");
{
  const refs = [
    { bloc: "HOLCIM", ligne: 10, colonne: 1, type: "entite" as const, montant: 10_000 },
  ];
  const lignesN = [
    L("BOAHOL", "40", "2026-01-05", "411000", "", "HONORAIRES JANVIER", 0, 10_000),
    L("BOAHOL", "40", "2026-01-05", "512110", "", "HONORAIRES JANVIER", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "580001", "", "", 10_000, 0),
    L("BOAHOL", "60", "2026-01-15", "512110", "", "", 0, 10_000),
    L("BOAMCI", "62", "2026-01-18", "512000", "", "", 10_000, 0),
    L("BOAMCI", "62", "2026-01-18", "580001", "", "", 0, 10_000),
  ];
  const lignesN1 = [
    LN1("BOAHOL", "50", "2025-12-15", "411000", "", "HONORAIRES DECEMBRE", 0, 10_000),
    LN1("BOAHOL", "50", "2025-12-15", "512110", "", "HONORAIRES DECEMBRE", 10_000, 0),
  ];
  const rA = analyse(lignesN, VERIF_STD(), null, refs, lignesN1);
  const rB = analyse(lignesN, VERIF_STD(), null, refs, lignesN1);
  egal(
    JSON.stringify(rA.rapprochements),
    JSON.stringify(rB.rapprochements),
    "T14 : deux exécutions → fiches identiques (déterminisme)",
  );
  const rSans = analyse(lignesN, VERIF_STD(), null, refs);
  egal(
    JSON.stringify(rSans.validation),
    JSON.stringify(rA.validation),
    "T14 : la validation est STRICTEMENT identique avec et sans N-1",
  );
  egal(rA.validation?.totaux.nbExpliquesParN1, 0, "T14 : nbExpliquesParN1 = 0 (jamais forcé)");
  egal(rA.validation?.ecarts[0]?.montantExpliqueN1, 0, "T14 : ventilation N-1 affichée à 0");
  egal(
    rA.validation?.ecarts[0]?.statut,
    rSans.validation?.ecarts[0]?.statut,
    "T14 : le statut de l'écart de référence est inchangé par N-1",
  );
  verifie(rA.n1 !== null, "T14 : le N-1 est bien chargé (la comparaison est signifiante)");
}

// ====================================================================
// BILAN
// ====================================================================
console.log(`\n=== TESTS N-1 : ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.error("Échecs :");
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
