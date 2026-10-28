/**
 * VALIDATION SUR DONNÉES RÉELLES — brouillard + Verif BG du 27/10/2026.
 *
 * Exécution : bun run scripts/validate-2710.ts
 *  1. Lit les deux fichiers réels (upload).
 *  2. Exécute le moteur complet (parseVerif + parseBrouillard + analyse).
 *  3. Compare les écarts de référence (feuille « 2026 » ; Feuil1/Feuil2 masquées sans étiquettes) au calcul.
 *  4. Contrôle croisé avec l'extraction Python indépendante.
 *  5. Écrit le rapport JSON dans download/ + résumé console.
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { STATUT_VALIDATION_LABELS } from "../src/lib/validation";
import { STATUT_LABELS } from "../src/lib/rapprochement";
import { writeFileSync, readFileSync } from "node:fs";

const UP = "/home/z/my-project/upload";
const BRO = `${UP}/BROUILLARD 2026 27102026.xlsx`;
const VER = `${UP}/Verif BG 27102026 VF.xlsx`;

const t0 = Date.now();
console.log("Lecture de la feuille de vérification…");
const verifBuf = await Bun.file(VER).arrayBuffer();
const { entites, balance, ecartsReference } = parseVerif(verifBuf);
console.log(
  `  ${entites.length} blocs · ${balance?.length ?? 0} comptes de balance · ${ecartsReference.length} écarts de référence`,
);

console.log("Lecture du brouillard…");
const broBuf = await Bun.file(BRO).arrayBuffer();
const lignes = parseBrouillard(broBuf);
const tLignes = Date.now();
console.log(
  `  ${lignes.length.toLocaleString("fr-FR")} lignes normalisées en ${((tLignes - t0) / 1000).toFixed(1)} s`,
);

console.log("Analyse complète…");
const result = analyse(lignes, entites, balance, ecartsReference);
const tFin = Date.now();
console.log(
  `  analyse en ${((tFin - tLignes) / 1000).toFixed(1)} s (${((tFin - t0) / 1000).toFixed(1)} s au total)\n`,
);

// Contrôle croisé : l'extraction Python indépendante (centimes arrondis pareil)
// Alignement : lignes Python = index 0-based, lignes TS = n° Excel (1-based) → +1.
// Artefact documenté : la ligne Python L169 (SANIFER = TALYS, 38 747 332,43)
// est la valeur latérale attrapée par la règle Python « première numérique à
// droite sans limite de côté » — le TS (et le contenu réel de la feuille)
// n'ont PAS de vérification principale à cette ligne ; le vrai écart est L170.
const refPython = JSON.parse(
  readFileSync("/home/z/my-project/scripts/ecarts_reference_2710.json", "utf8"),
) as { ecarts: { bloc: string; ligne: number; montant: number }[] };
const mapTs = new Map(ecartsReference.map((e) => [`${e.bloc}|${e.ligne}`, e.montant]));
let croise = 0;
let croiseKo = 0;
const artefacts = new Set([169]); // SANIFER : valeur latérale attrapée (règle Python)
for (const e of refPython.ecarts) {
  if (artefacts.has(e.ligne)) continue;
  const v = mapTs.get(`${e.bloc}|${e.ligne + 1}`);
  if (v === undefined) {
    croiseKo++;
    console.error(`  ✗ écart Python absent du TS : ${e.bloc} L${e.ligne} ${e.montant}`);
  } else if (Math.abs(Math.round(v * 100) - Math.round(e.montant * 100)) > 1) {
    croiseKo++;
    console.error(`  ✗ montant divergent : ${e.bloc} L${e.ligne} TS=${v} Py=${e.montant}`);
  } else croise++;
}
console.log(`Contrôle croisé TS/Python : ${croise} concordants, ${croiseKo} divergents\n`);

// ---- Rapport de validation
const v = result.validation!;
console.log("=== VALIDATION FEUILLE 2026 ===");
for (const e of v.ecarts) {
  console.log(
    `  L${String(e.ecart.ligne).padStart(3)} ${e.ecart.type === "famille" ? "FAM " : "ENT "} ${e.ecart.bloc.slice(0, 30).padEnd(30)} ref ${e.ecart.montant.toLocaleString("fr-FR").padStart(18)} · calc ${e.montantCalcule.toLocaleString("fr-FR").padStart(18)} · résid ${e.residuel.toLocaleString("fr-FR").padStart(16)} · ${STATUT_VALIDATION_LABELS[e.statut]}`,
  );
}
console.log("\nTotaux :", JSON.stringify(v.totaux, null, 2));

// ---- Rapprochements A/B/C
console.log("\n=== RAPPROCHEMENT A/B/C ===");
const parStatut = new Map<string, number>();
for (const c of result.rapprochements) parStatut.set(c.statut, (parStatut.get(c.statut) ?? 0) + 1);
for (const [s, n] of [...parStatut.entries()].sort((a, b) => b[1] - a[1]))
  console.log(
    `  ${String(n).padStart(4)} ${s} — ${STATUT_LABELS[s as keyof typeof STATUT_LABELS]}`,
  );

console.log("\nTop 12 contrôles à actionner :");
for (const c of result.rapprochements
  .filter((x) => x.statut !== "correspondance_trouvee")
  .slice(0, 12))
  console.log(
    `  ${c.id} [${c.statut}] ${c.type} · ${c.societe} · ${c.journal} · attendu ${c.montantAttendu.toLocaleString("fr-FR")} · restant ${c.ecartRestant.toLocaleString("fr-FR")}`,
  );

// Familles vs référence — les 3 familles clés du suivi du comptable
console.log("\n=== FAMILLES NON SOLDÉES (règle RAN 401000/460/411) ===");
for (const f of result.familles.filter((f) => !f.soldee).slice(0, 12))
  console.log(
    `  ${f.nom.padEnd(30)} écart ${f.ecart.toLocaleString("fr-FR").padStart(18)} · ${f.pieces.length} pièces · combinaisons ${f.combinaisons.length}${f.combinaisonEchec ? " (échec honnête)" : ""}`,
  );

// ---- Rapport JSON livrable
const rapport = {
  source: { brouillard: BRO, verif: VER, date: new Date().toISOString() },
  perf: { lignes: lignes.length, totalMs: tFin - t0 },
  controleCroise: { concordants: croise, divergents: croiseKo },
  validation: v,
  stats: result.stats,
  rapprochementsParStatut: Object.fromEntries(parStatut),
};
writeFileSync(
  "/home/z/my-project/download/rapport_validation_smartverif_27102026.json",
  JSON.stringify(rapport, null, 1),
);
console.log(
  "\nRapport JSON : /home/z/my-project/download/rapport_validation_smartverif_27102026.json",
);
