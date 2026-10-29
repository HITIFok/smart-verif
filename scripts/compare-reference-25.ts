/**
 * COMPARATEUR DES 25 CONTRÔLES AUX RÉSULTATS DE RÉFÉRENCE — revue finale
 * du 29/10/2026 (commit 1cfc649).
 *
 * Compare, en modes N seul ET N+N-1, chaque contrôle de référence de
 * audit_8ecarts.json (produit par scripts/audit-8ecarts.ts sur les fichiers
 * réels) aux résiduels et statuts de référence de la mission du 29/10/2026
 * (état validé au centime, inchangé depuis l'audit du 28/10) :
 *   17 exacts · 4 partiels (L83 +3 000 / L525 −3 000 / L537 +182 000 /
 *   L571 +23 400) · 2 ailleurs (L471 69 770 274,49 / L482 62 098 371,47) ·
 *   2 incorrects (L354 +7 586 124 / L358 +7 586 124) — 0 non expliqué.
 *
 * AUCUNE tolérance : égalité stricte au centime (comparaison en centimes
 * entiers après arrondi bancalier), statut identique, dans les DEUX modes.
 * Exécution : bun run scripts/compare-reference-25.ts
 */
import { readFileSync } from "node:fs";

/** Référence de la mission 29/10/2026 : { ligne → [résiduel, statut] }. */
const REFERENCE: Record<number, [number, string]> = {
  10: [0, "explique_exact"],
  20: [0, "explique_exact"],
  21: [0, "explique_exact"],
  83: [3000, "explique_partiel"],
  104: [0, "explique_exact"],
  130: [0, "explique_exact"],
  152: [0, "explique_exact"],
  154: [0, "explique_exact"],
  171: [0, "explique_exact"],
  223: [0, "explique_exact"],
  249: [0, "explique_exact"],
  291: [0, "explique_exact"], // ref 0,36 = calc 0,36 → résiduel 0 (la somme des résiduels de référence 147 246 293,96 le confirme)
  326: [0, "explique_exact"],
  354: [7586124, "correspondance_incorrecte"],
  358: [7586124, "correspondance_incorrecte"],
  381: [0, "explique_exact"],
  469: [0, "explique_exact"],
  471: [69770274.49, "explique_ailleurs"],
  482: [62098371.47, "explique_ailleurs"],
  494: [0, "explique_exact"],
  525: [-3000, "explique_partiel"],
  537: [182000, "explique_partiel"],
  544: [0, "explique_exact"],
  571: [23400, "explique_partiel"],
  591: [0, "explique_exact"],
};

const TOTAUX_REFERENCE = {
  nbReferences: 25,
  nbExpliquesExact: 17,
  nbPartiels: 4,
  nbAilleurs: 2,
  nbNonExpliques: 0,
  nbIncorrects: 2,
  montantTotalReferences: 196297285.71,
  montantTotalResiduel: 147246293.96,
};

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
const cents = (n: number) => Math.round(n * 100);

const audit = JSON.parse(readFileSync("/home/z/my-project/scripts/audit_8ecarts.json", "utf8"));
const modes: [string, unknown][] = [
  ["N seul", audit.validationN],
  ["N+N-1", audit.validationNN1],
];

for (const [nomMode, v] of modes) {
  console.log(`\n=== COMPARAISON AU RÉFÉRENTIEL — MODE ${nomMode} ===`);
  const ecarts = v.ecarts ?? [];
  verifie(ecarts.length === 25, `25 contrôles présents (reçu : ${ecarts.length})`);
  for (const e of ecarts) {
    const ligne = e.ecart.ligne as number;
    const [refRes, refStatut] = REFERENCE[ligne] ?? [NaN, "?"];
    const bloc = `${e.ecart.bloc} (L${ligne})`;
    verifie(
      cents(e.residuel) === cents(refRes) && e.statut === refStatut,
      `${bloc} : résiduel ${e.residuel} Ar / statut ${e.statut} = référence (${refRes} Ar / ${refStatut})`,
    );
  }
  const t = v.totaux ?? {};
  for (const [cle, valeurRef] of Object.entries(TOTAUX_REFERENCE)) {
    const recu = t[cle];
    const egal =
      typeof valeurRef === "number" && !Number.isInteger(valeurRef)
        ? cents(recu) === cents(valeurRef)
        : recu === valeurRef;
    verifie(egal, `totaux.${cle} : ${recu} = référence (${valeurRef})`);
  }
  // Les deux modes doivent être identiques entre eux (aucune régression N-1).
}

console.log("\n=== IDENTICITÉ DES DEUX MODES ===");
const N = audit.validationN.ecarts;
const NN1 = audit.validationNN1.ecarts;
verifie(
  N.length === NN1.length && N.every((e: unknown, i: number) => {
    const a = e as { residuel: number; statut: string };
    const b = (NN1 as { residuel: number; statut: string }[])[i]!;
    return cents(a.residuel) === cents(b.residuel) && a.statut === b.statut;
  }),
  "modes N et N+N-1 : mêmes statuts et mêmes résiduels au centime (25/25)",
);

console.log(`\n=== COMPARATEUR 25 CONTRÔLES : ${ok} OK, ${ko} échec(s) ===`);
process.exit(ko === 0 ? 0 : 1);
