/**
 * TESTS DIAGNOSTIC (Phase 3/4) — la couche diagnostic doit reproduire, depuis
 * les données réellement importées, la décomposition attendue des 8 contrôles
 * non exacts. Aucun montant n'est codé en dur côté lib : les attendus ci-
 * dessous sont ceux de l'audit du 28/10/2026, revérifiés au centime.
 *
 * Exécution : bun run scripts/test-diagnostics.ts
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { construireDiagnostics, construireDemandesPieces } from "../src/lib/diagnostics";
import type { DiagnosticEcart } from "../src/lib/diagnostics";
import { writeFileSync } from "node:fs";

const UP = "/home/z/my-project/upload";
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
const parLigne = (ds: DiagnosticEcart[], ligne: number) => ds.find((d) => d.ligne === ligne);
// toLocaleString("fr-FR") insère des espaces fines/insécables comme
// séparateurs de milliers : normalisation pour les comparaisons littérales.
const espace = (s: string) => s.replace(/[\u202F\u00A0\u2009]/g, " ");

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

console.log("=== DIAGNOSTICS DES CONTRÔLES NON EXACTS (données réelles) ===");
verifie(diagnostics.length === 8, `exactement 8 diagnostics (reçu : ${diagnostics.length})`);

// L83 TELMA SA
{
  const d = parLigne(diagnostics, 83);
  verifie(!!d, "L83 : diagnostic présent");
  if (d) {
    verifie(d.type === "SOURCE_ENTRY_MISSING", `L83 : type SOURCE_ENTRY_MISSING (reçu : ${d.type})`);
    verifie(d.confiance === "confirmé", "L83 : confiance confirmée");
    verifie(d.composants.length === 1 && d.composants[0].compte === "512140", "L83 : composant unique 512140");
    verifie(Math.abs(d.composants[0].contribution - 3000) < 0.01, "L83 : contribution +3 000,00");
    verifie(Math.abs(d.ecartRestant) < 0.01, "L83 : écart restant nul");
    verifie(d.preuvesAudit.some((p) => (p.source + p.detail).includes("4540")), "L83 : hypothèse pièce 4540 documentée");
  }
}
// L525 STAR
{
  const d = parLigne(diagnostics, 525);
  verifie(!!d && d.type === "SOURCE_ENTRY_MISSING", "L525 : SOURCE_ENTRY_MISSING");
  if (d) {
    verifie(d.composants[0]?.compte === "512900", "L525 : composant 512900");
    verifie(Math.abs(d.composants[0]?.contribution - -3000) < 0.01, "L525 : contribution −3 000,00");
    verifie(d.preuvesAudit.some((p) => (p.source + p.detail).includes("charge croisée")), "L525 : hypothèse charge croisée documentée");
  }
}
// L537 TALOUMIS
{
  const d = parLigne(diagnostics, 537);
  verifie(!!d && d.type === "SOURCE_ENTRY_MISSING", "L537 : SOURCE_ENTRY_MISSING");
  if (d) {
    verifie(d.composants[0]?.compte === "467910", "L537 : composant 467910");
    verifie(Math.abs(d.composants[0]?.contribution - 182000) < 0.01, "L537 : contribution +182 000,00");
    verifie(d.preuvesAudit.some((p) => p.detail.includes("aucun double comptage d'ouverture")), "L537 : cohérence RAN/clôture N-1 documentée");
  }
}
// L571 AUTOFI
{
  const d = parLigne(diagnostics, 571);
  verifie(!!d && d.type === "SOURCE_ENTRY_MISSING", "L571 : SOURCE_ENTRY_MISSING");
  if (d) {
    verifie(d.composants[0]?.compte === "467102", "L571 : composant 467102");
    verifie(Math.abs(d.composants[0]?.contribution - 23400) < 0.01, "L571 : contribution +23 400,00");
    verifie(d.typesSecondaires.includes("DUPLICATE_POTENTIAL"), "L571 : doublon potentiel (pièces 63/3540) en type secondaire distinct");
  }
}
// L354 BOOST / L358 JBU — cause commune.
// Revue finale 29/10 : variables nommées d'après le diagnostic ciblé
// (boost = diagnostic L354, jbu = diagnostic L358) — aucune assertion
// L354 ne peut plus porter par mégarde sur L358 ni inversement.
{
  const boost = parLigne(diagnostics, 354);
  const jbu = parLigne(diagnostics, 358);
  verifie(!!boost, "L354 : diagnostic présent");
  verifie(!!jbu, "L358 : diagnostic présent");
  if (boost) {
    verifie(boost.type === "REFERENCE_ADJUSTMENT", `L354 : type REFERENCE_ADJUSTMENT (reçu : ${boost.type})`);
    verifie(boost.composants.some((c) => c.compte === "512320"), "L354 : composant 512320 (virements croisés absents)");
    verifie(Math.abs(boost.composants.find((c) => c.compte === "512320")?.contribution - 143772) < 0.01, "L354 : contribution 512320 = +143 772,00");
    verifie(Math.abs(boost.ecartRestant - 7442352) < 0.01, `L354 : écart restant = ajustement manuel 7 442 352,00 (reçu : ${boost.ecartRestant})`);
    verifie(boost.preuvesAudit.some((p) => p.detail.includes("5 936 056,32")), "L354 : montant non tracé 5 936 056,32 présenté séparément");
    verifie(boost.elementsConfirmes.some((x) => x.includes("L358")), "L354 : cause commune avec L358 documentée");
    // Révision 29/10/2026 : la décomposition affichée reconstitue le résiduel
    // au centime, avec le signe correct (+143 772 au sens balance − brouillard).
    const dec = boost.elementsConfirmes.find((x) => x.includes("Décomposition du résiduel"));
    verifie(
      !!dec && espace(dec).includes("+143 772") && espace(dec).includes("+7 442 352") && espace(dec).includes("+7 586 124"),
      `L354 : décomposition affichée +143 772 + 7 442 352 = +7 586 124 (reçu : ${dec ?? "absente"})`,
    );
    verifie(
      !boost.elementsConfirmes.some((x) => x.includes("-143 772") || x.includes("−143 772")),
      "L354 : plus aucune part de résiduel affichée en négatif (−143 772) — signe corrigé",
    );
  }
  if (jbu) {
    verifie(jbu.type === "REFERENCE_ADJUSTMENT", `L358 : type REFERENCE_ADJUSTMENT (reçu : ${jbu.type})`);
    verifie(jbu.elementsConfirmes.some((x) => x.includes("L354")), "L358 : lié à L354 (pas une seconde anomalie indépendante)");
  }
}
// L471 / L482 ORANGE — conflit d'affectation.
// Revue finale 29/10 : variables nommées d'après le diagnostic ciblé
// (orangeMad = diagnostic L471 ORANGE MADAGASCAR, orangeMoney = diagnostic
// L482 ORANGE MONEY MADAGASCAR) — les assertions L482 ne peuvent plus
// être confondues avec celles de L471 (ni avec le bloc L354/L358).
{
  const orangeMad = parLigne(diagnostics, 471);
  const orangeMoney = parLigne(diagnostics, 482);
  verifie(!!orangeMad && orangeMad.type === "ACCOUNT_OWNERSHIP_CONFLICT", `L471 : ACCOUNT_OWNERSHIP_CONFLICT (reçu : ${orangeMad?.type})`);
  verifie(!!orangeMoney && orangeMoney.type === "ACCOUNT_OWNERSHIP_CONFLICT", `L482 : ACCOUNT_OWNERSHIP_CONFLICT (reçu : ${orangeMoney?.type})`);
  if (orangeMad) {
    verifie(orangeMad.compte === "512600", "L471 : compte en conflit = 512600");
    verifie(orangeMad.actionRecommandee.includes("par écrit"), "L471 : confirmation écrite exigée (pas d'attribution arbitraire)");
    // Révision 29/10/2026 : le résiduel L471 ne se réduit PAS au solde du
    // seul compte 512600 (il agrège quatre postes de la feuille) ; le calcul
    // de l'application est 0 — le résiduel s'identifie à la référence.
    verifie(
      orangeMad.elementsConfirmes.some(
        (x) =>
          espace(x).includes("ne se réduit PAS") &&
          espace(x).includes("62 098 371,47") &&
          espace(x).includes("7 671 903,02"),
      ),
      "L471 : résiduel 69 770 274,49 non réduit au solde 512600 (62 098 371,47) — supplément 7 671 903,02 documenté",
    );
    verifie(
      orangeMad.elementsConfirmes.some((x) => x.includes("Montant calculé par l'application")),
      "L471 : montant calculé (0) distingué du montant de référence",
    );
    verifie(
      orangeMad.preuvesAudit.some((p) => p.detail.includes("H471") && p.detail.includes("E480")),
      "L471 : décomposition H471 = E463 + E467 + E478 + E480 documentée comme hypothèse d'audit",
    );
    verifie(
      !orangeMad.elementsConfirmes.some((x) => x.includes("correspond au centime au solde du compte 512600")),
      "L471 : l'ancienne affirmation (résiduel = solde 512600) a disparu",
    );
  }
  if (orangeMoney) {
    verifie(
      orangeMoney.elementsConfirmes.some(
        (x) => espace(x).includes("solde du compte 512600") && espace(x).includes("62 098 371,47"),
      ),
      "L482 : résiduel = référence E482 = solde 512600 (62 098 371,47) — égalité vérifiée au centime",
    );
    verifie(
      orangeMoney.elementsConfirmes.some((x) => x.includes("Montant calculé par l'application")),
      "L482 : montant calculé (0) distingué du montant de référence",
    );
  }
}
// Mission §4 invariant 9 : aucun contrôle historique supprimé du rapport.
verifie(
  result.validation?.ecarts.length === 25,
  "les 25 contrôles restent présents dans la validation",
);
// Mission §4 invariant 6 : doublons interexercices soldés ≠ doublons potentiels.
verifie(
  result.validation?.totaux.nbExpliquesParN1 === 0,
  "aucun écart porté par N-1 sur les fichiers d'audit actuels (48 clés communes toutes apurées)",
);

// Demandes de pièces (mission §9)
console.log("\n=== DEMANDES DE PIÈCES ===");
const motifs = demandes.map((x) => x.piece);
verifie(motifs.some((m) => m.includes("512140")), "demande : grand livre 512140");
verifie(motifs.some((m) => m.includes("512900")), "demande : grand livre 512900");
verifie(motifs.some((m) => m.includes("467910")), "demande : grand livre 467910");
verifie(motifs.some((m) => m.includes("467102")), "demande : grand livre 467102");
verifie(motifs.some((m) => m.includes("512320")), "demande : grand livre 512320");
verifie(motifs.some((m) => m.includes("512005")), "demande : grand livre 512005");
verifie(motifs.some((m) => m.includes("propriétaire du compte 512600")), "demande : confirmation écrite 512600");
verifie(motifs.some((m) => m.includes("5 936 056,32")), "demande : justificatif ajustement 5 936 056,32");
verifie(
  !demandes.some((x) => /écriture (corrective|automatique)|passer l'écriture|suggestion d'écriture/i.test(x.motif)),
  "aucune écriture corrective Sage proposée (mission : interdit)",
);
// Révision 29/10/2026 : déduplication au niveau document — 31 demandes
// brutes, 9 doublons véritables supprimés, 22 demandes, toutes références
// conservées ; les pièces différentes restent séparées.
verifie(demandes.length === 22, `demandes dédupliquées : 22 (31 brutes − 9 doublons véritables) — reçu : ${demandes.length}`);
verifie(
  new Set(demandes.map((x) => x.piece)).size === demandes.length,
  "aucune pièce textuellement identique demandée deux fois",
);
verifie(
  demandes.some((x) => x.controle.includes("L471") && x.controle.includes("L482") && x.piece.includes("512600")),
  "demande fusionnée : confirmation 512600 référencée pour L471 ET L482",
);
verifie(
  demandes.some(
    (x) => x.piece.includes("512320") && x.piece.includes("512005") && x.controle.includes("L358"),
  ),
  "demande fusionnée : grand livre 512320 + 512005 référencé pour L354 et L358",
);
verifie(
  demandes.filter((x) => /grand livre/i.test(x.piece) && x.piece.includes("467910")).length === 1,
  "un seul grand livre 467910 demandé (doublon TALOUMIS supprimé)",
);
verifie(
  ["512140", "512320", "512005", "512900", "467910", "467102", "467501", "467103", "512000", "467100", "460110", "512110", "512100", "467280", "512220", "513110", "513000"].every(
    (c) => demandes.filter((x) => /grand livre/i.test(x.piece) && x.piece.includes(c)).length === 1,
  ),
  "chaque grand livre de compte n'est demandé qu'une seule fois (17 comptes)",
);
verifie(
  demandes.filter((x) => x.piece.includes("Justificatif de l'ajustement")).length === 2,
  "les deux justificatifs distincts restent séparés (composante 5 936 056,32 ≠ ajustement total 7 442 352)",
);

// Sérialisation pour le rapport final
writeFileSync(
  "/home/z/my-project/scripts/diagnostics_8ecarts.json",
  JSON.stringify({ diagnostics, demandesPieces: demandes }, null, 1),
);
console.log(`\n=== DIAGNOSTICS : ${ok} OK, ${ko} échec(s) — JSON : diagnostics_8ecarts.json ===`);
process.exit(ko === 0 ? 0 : 1);
