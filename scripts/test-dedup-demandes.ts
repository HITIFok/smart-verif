/**
 * TESTS DE DÉDUPLICATION DES DEMANDES DE PIÈCES — revue finale du
 * 29/10/2026 (commit 1cfc649).
 *
 * La déduplication (src/lib/diagnostics.ts, `documentsDeLaPiece` +
 * `dedupDemandesPieces`) fusionne au niveau DOCUMENT : un même document
 * demandé par plusieurs contrôles = une seule demande, avec TOUTES les
 * références regroupées ; les pièces réellement différentes restent
 * séparées. Ce script éprouve le mécanisme sur des CAS SYNTHÉTIQUES
 * (indépendants des fichiers d'audit) puis re-vérifie la liste réelle :
 *   — document commun (même grand livre, contrôles différents) → fusion,
 *     les deux références sont conservées ;
 *   — pièces distinctes (comptes différents) → demandes séparées ;
 *   — inclusion (demande large 2 comptes ⊃ demande étroite 1 compte) →
 *     fusion dans la plus large, références regroupées ;
 *   — un compte demandé par trois contrôles → une seule demande ;
 *   — justificatifs de montants différents → JAMAIS fusionnés ;
 *   — confirmations comptables du même compte → une seule, références
 *     regroupées ;
 *   — aucune perte : toute référence de contrôle d'entrée ressort.
 * Exécution : bun run scripts/test-dedup-demandes.ts
 */
import { construireDemandesPieces } from "../src/lib/diagnostics";
import type { AnalysisResult } from "../src/lib/analysis-types";
import type { DiagnosticEcart, DemandePiece } from "../src/lib/diagnostics";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

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

/** Résultat moteur minimal : construireDemandesPieces n'utilise que
 *  result.anomalies (anomalies « écart balance ») — vide pour les cas
 *  synthétiques. */
const resultVide = { anomalies: [] } as unknown as AnalysisResult;

const diag = (bloc: string, ligne: number, opts: Partial<DiagnosticEcart> = {}): DiagnosticEcart => ({
  bloc,
  ligne,
  typeControle: "entite",
  statut: "explique_partiel",
  montantReference: 1_000,
  montantCalcule: 0,
  ecartSigne: 1_000,
  type: "SOURCE_ENTRY_MISSING",
  typesSecondaires: [],
  libelle: `Objet ${bloc} (L${ligne})`,
  confiance: "confirmé",
  regle: "Règle A",
  elementsConfirmes: [],
  composants: [],
  ecartRestant: 1_000,
  elementsManquants: [],
  preuvesAudit: [],
  demandesSpecifiques: [],
  actionRecommandee: "Vérification humaine à effectuer.",
  ...opts,
});
const composant = (compte: string) => ({ compte, divergenceSolde: 1_000, contribution: 1_000, explication: `divergence ${compte}` });

/** Toutes les références « BLOC (Lx) » présentes sur les demandes sorties. */
const referencesDe = (demandes: DemandePiece[]) =>
  new Set(demandes.flatMap((d) => d.controle.split(" / ")));
/** Nombre de demandes « grand livre » mentionnant un compte donné. */
const nbGL = (demandes: DemandePiece[], compte: string) =>
  demandes.filter((d) => /grand livre/i.test(d.piece) && d.piece.includes(compte)).length;

console.log("=== CAS SYNTHÉTIQUES DE DÉDUPLICATION ===");

// Cas 1 — DOCUMENT COMMUN : même grand livre demandé par deux contrôles.
{
  const ds = [
    diag("BLOC1", 100, { composants: [composant("512320")] }),
    diag("BLOC2", 200, { composants: [composant("512320")] }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 1, `cas 1 : une seule demande (reçu : ${dem.length})`);
  verifie(nbGL(dem, "512320") === 1, "cas 1 : le grand livre 512320 n'apparaît qu'une fois");
  verifie(
    dem[0]?.controle.includes("BLOC1 (L100)") && dem[0]?.controle.includes("BLOC2 (L200)"),
    "cas 1 : les deux références de contrôle sont regroupées sur la demande fusionnée",
  );
  const refs = referencesDe(dem);
  verifie(refs.has("BLOC1 (L100)") && refs.has("BLOC2 (L200)"), "cas 1 : aucune référence perdue");
}

// Cas 2 — PIÈCES DISTINCTES : comptes différents → demandes séparées.
{
  const ds = [
    diag("BLOC1", 100, { composants: [composant("512140")] }),
    diag("BLOC2", 200, { composants: [composant("512900")] }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 2, `cas 2 : deux demandes séparées (reçu : ${dem.length})`);
  verifie(nbGL(dem, "512140") === 1 && nbGL(dem, "512900") === 1, "cas 2 : chaque grand livre apparaît une fois, sur sa propre demande");
  verifie(
    dem.every((d) => !d.controle.includes(" / ")),
    "cas 2 : aucune fusion — chaque demande porte un seul contrôle",
  );
}

// Cas 3 — INCLUSION : une demande large (2 comptes) absorbe une demande
// étroite (1 des 2 comptes) ; la libellé conservé est le plus large.
{
  const ds = [
    diag("BLOCLARGE", 354, {
      demandesSpecifiques: ["Grand livre Sage des comptes 512320 et 512005 (période du brouillard N)"],
    }),
    diag("BLOCRETROIT", 400, { composants: [composant("512320")] }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 1, `cas 3 : fusion dans la demande la plus large (reçu : ${dem.length})`);
  verifie(
    dem[0]?.piece.includes("512320") && dem[0]?.piece.includes("512005"),
    "cas 3 : le libellé retenu mentionne les DEUX comptes",
  );
  verifie(
    dem[0]?.controle.includes("BLOCLARGE (L354)") && dem[0]?.controle.includes("BLOCRETROIT (L400)"),
    "cas 3 : références des deux contrôles regroupées",
  );
}

// Cas 4 — TROIS CONTRÔLES, MÊME COMPTE : une seule demande, trois références.
{
  const ds = [
    diag("BLOCA", 10, { composants: [composant("512900")] }),
    diag("BLOCB", 20, { composants: [composant("512900")] }),
    diag("BLOCC", 30, { composants: [composant("512900")] }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 1, `cas 4 : une seule demande pour trois contrôles (reçu : ${dem.length})`);
  verifie(dem[0]?.controle.split(" / ").length === 3, "cas 4 : les trois références sont sur la demande fusionnée");
}

// Cas 5 — JUSTIFICATIFS DISTINCTS : montants différents → JAMAIS fusionnés
// (ce sont des pièces réellement différentes, même si le libellé ressemble).
{
  const ds = [
    diag("BLOC1", 354, { type: "REFERENCE_ADJUSTMENT", ecartRestant: 5936056.32 }),
    diag("BLOC2", 358, { type: "REFERENCE_ADJUSTMENT", ecartRestant: 7442352 }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 2, `cas 5 : deux justificatifs distincts restent séparés (reçu : ${dem.length})`);
  // toLocaleString("fr-FR") insère des espaces fines/insécables : normaliser
  // avant la comparaison littérale des montants.
  const norm = (s: string) => s.replace(/[\u202F\u00A0\u2009]/g, " ");
  verifie(
    dem.some((d) => norm(d.piece).includes("5 936 056,32")) && dem.some((d) => norm(d.piece).includes("7 442 352")),
    "cas 5 : chaque justificatif conserve son montant propre",
  );
}

// Cas 6 — CONFIRMATIONS COMPTABLES : même compte en conflit → une seule
// confirmation écrite, références regroupées (miroir de L471/L482).
{
  const ds = [
    diag("BLOC1", 471, { type: "ACCOUNT_OWNERSHIP_CONFLICT", compte: "512600" }),
    diag("BLOC2", 482, { type: "ACCOUNT_OWNERSHIP_CONFLICT", compte: "512600" }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 1, `cas 6 : une seule confirmation 512600 (reçu : ${dem.length})`);
  verifie(
    dem[0]?.controle.includes("L471") && dem[0]?.controle.includes("L482"),
    "cas 6 : références L471 et L482 regroupées sur la confirmation",
  );
}

// Cas 7 — CONFIRMATIONS DE COMPTES DIFFÉRENTS : jamais fusionnées.
{
  const ds = [
    diag("BLOC1", 471, { type: "ACCOUNT_OWNERSHIP_CONFLICT", compte: "512600" }),
    diag("BLOC2", 482, { type: "ACCOUNT_OWNERSHIP_CONFLICT", compte: "512140" }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 2, `cas 7 : confirmations de comptes différents séparées (reçu : ${dem.length})`);
}

// Cas 8 — AUCUNE PERTE GLOBALE : 5 diagnostics, 1 fusion attendue (512320
// commun) → 4 demandes mais 5 références de contrôle présentes en sortie.
{
  const ds = [
    diag("BLOC1", 100, { composants: [composant("512320")] }),
    diag("BLOC2", 200, { composants: [composant("512320")] }),
    diag("BLOC3", 300, { composants: [composant("467910")] }),
    diag("BLOC4", 400, { composants: [composant("467102")] }),
    diag("BLOC5", 500, { composants: [composant("512140")] }),
  ];
  const dem = construireDemandesPieces(ds, resultVide);
  verifie(dem.length === 4, `cas 8 : 5 demandes brutes − 1 doublon = 4 (reçu : ${dem.length})`);
  verifie(referencesDe(dem).size === 5, "cas 8 : les 5 références de contrôle ressortent (aucune perte)");
  verifie(
    ["512320", "467910", "467102", "512140"].every((c) => nbGL(dem, c) === 1),
    "cas 8 : chaque grand livre demandé exactement une fois",
  );
}

console.log("\n=== LISTE RÉELLE (fichiers d'audit du 27/10) ===");
// Re-vérification indépendante sur les données réelles : la déduplication ne
// doit fusionner que les doublons véritables et préserver les pièces
// réellement différentes (L354/L358 fusionnés ; justificatifs séparés).
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
const demandes = construireDemandesPieces(
  (await import("../src/lib/diagnostics")).construireDiagnostics(result),
  result,
);

verifie(demandes.length === 22, `liste réelle : 22 demandes (reçu : ${demandes.length})`);
verifie(
  new Set(demandes.map((d) => d.piece)).size === demandes.length,
  "liste réelle : aucune pièce textuellement identique en double",
);
verifie(
  ["512140", "512320", "512005", "512900", "467910", "467102", "467501", "467103", "512000", "467100", "460110", "512110", "512100", "467280", "512220", "513110", "513000"].every(
    (c) => nbGL(demandes, c) === 1,
  ),
  "liste réelle : chaque compte de grand livre demandé n'apparaît qu'une seule fois (17 comptes)",
);
verifie(
  demandes.some((d) => d.piece.includes("512600") && d.controle.includes("L471") && d.controle.includes("L482")),
  "liste réelle : confirmation 512600 unique portant L471 ET L482",
);
verifie(
  demandes.some((d) => d.piece.includes("512320") && d.piece.includes("512005") && d.controle.includes("L354") && d.controle.includes("L358")),
  "liste réelle : grand livre 512320+512005 unique portant L354 ET L358",
);
verifie(
  demandes.filter((d) => d.piece.includes("Justificatif de l'ajustement")).length === 2,
  "liste réelle : les deux justificatifs (5 936 056,32 ≠ 7 442 352) restent séparés",
);
verifie(
  demandes.filter((d) => /grand livre/i.test(d.piece) && d.piece.includes("467910")).length === 1,
  "liste réelle : un seul grand livre 467910 (le doublon TALOUMIS a été supprimé, pas la pièce)",
);
// Toute référence de contrôle des 8 diagnostics ressort sur au moins une demande.
verifie(
  ["L83", "L525", "L537", "L571", "L354", "L358", "L471", "L482"].every((l) =>
    demandes.some((d) => d.controle.includes(l)),
  ),
  "liste réelle : chaque contrôle concerné (8/8) conserve au moins une demande de pièce",
);

console.log(`\n=== DÉDUPLICATION : ${ok} OK, ${ko} échec(s) ===`);
process.exit(ko === 0 ? 0 : 1);
