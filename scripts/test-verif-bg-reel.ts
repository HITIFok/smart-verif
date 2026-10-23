/**
 * Test de bout en bout : pipeline réel de l'app (parseVerif + parseBrouillard + analyse)
 * sur les fichiers réels, comparé aux écarts de la feuille « 2026 » du Verif BG.
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";

// Écarts de référence — feuille 2 (blocs principaux « Vérification » imprimés).
// ORANGE MONEY : 512600 réattribué à EVIOSYS (formule comptable) -> écart nul.
// SANLAMALLIANZ COMPAGNIE / ORANGE MONEY : écarts feuille du 21/10, brouillard du 20/10.
const REFERENCE: Record<string, number> = {
  HOLCIM: -1169515.72,
  "DHL INTERNATIONAL": -140559044.15,
  "TELMA MONEY": 12212892.44,
  JOVENA: 700000.0,
  MCB: 172800.0,
  "EASY TECH": 13169572.6,
  BOOST: -13966804.58,
  LECOFRUIT: 29546020.0,
  "ORANGE MADAGASCAR": 7866303.02,
  "ORANGE MONEY MADAGASCAR": 0.0,
  NACRE: -2254237.33,
  STAR: 1480139.9,
  "SANLAMALLIANZ AUTOFI": -28185141.44,
  "SANLAMALLIANZ COMPAGNIE": 15446798.9, // brouillard 20/10 (feuille 21/10 : 15 540 398,90)
  CONNECTEO: 0.36,
  EDM: -140.0,
};

// Familles attendues (formules H/G du comptable dans la feuille) : parent -> enfants.
const FAMILLES: Record<string, string[]> = {
  "DHL INTERNATIONAL": ["DHL EXPRESS"],
  FSS: ["MGS"],
  "TELMA SA": ["EVASAN"],
  "EASY TECH": ["PAMF"],
  "SANIFER = TALYS": [
    "SANIFER = TALYS HOSP",
    "SANIFER = TALYS COVID",
    "TAMBOHO",
    "TAMBOHO HOSP",
    "STMB",
    "STMB HOSP",
  ],
  AITS: ["STELLARIX"],
  AXIANSS: ["GES", "WELIGHT", "MADAGASCO", "ATSS", "VIA ASSURANCE"],
  TOM: ["AXIAN UNIVERSITY", "FONDATION AXIAN"],
  NACRE: ["NACRE DIR", "RAHARIVOLA BRUNO", "KIDS AKADEMY"],
  EVIOSYS: ["INGEDATA", "CAMUSAT"],
  BOOST: ["JBU", "JBS"],
  LECOFRUIT: ["SOCOTA/LECO"],
  SMARTONE: ["FOUNDEVER"],
  OMNIVEST: ["TANJAKA FOOD"],
  "FIRST IMMO": ["SANKO"],
};

// Vérifications attendues au niveau famille (notes formules, valeurs brouillard 20/10).
const FAMILLE_ATTENDU: Record<string, { ecart: number; membres: number }> = {
  "DHL INTERNATIONAL": { ecart: -0.2, membres: 2 },
  FSS: { ecart: 0.0, membres: 2 },
  "TELMA SA": { ecart: 1723184.0, membres: 2 },
  "EASY TECH": { ecart: -710540.0, membres: 2 },
  "SANIFER = TALYS": { ecart: 2006.0, membres: 7 },
  AITS: { ecart: 0.4, membres: 2 },
  AXIANSS: { ecart: -144058.16, membres: 6 }, // formule exacte de la feuille (H249) — reproduite depuis le brouillard
  TOM: { ecart: 90000.0, membres: 3 },
  NACRE: { ecart: 0.0, membres: 4 },
  EVIOSYS: { ecart: -4606000.0, membres: 3 },
  BOOST: { ecart: -186186.8, membres: 3 },
  LECOFRUIT: { ecart: 0.0, membres: 2 },
  SMARTONE: { ecart: 0.0, membres: 2 },
  OMNIVEST: { ecart: 0.0, membres: 2 },
  "FIRST IMMO": { ecart: 0.0, membres: 2 },
};

const verifBuf = fs.readFileSync(VERIF);
const brouBuf = fs.readFileSync(BROU);
// ArrayBuffer depuis Buffer (partage mémoire OK en CJS node)
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const t0 = Date.now();
const { entites, balance } = parseVerif(ab(verifBuf) as ArrayBuffer);
const lignes = parseBrouillard(ab(brouBuf) as ArrayBuffer);
console.log(
  `parseVerif: ${entites.length} entités ; balance: ${balance?.length ?? 0} comptes ; brouillard: ${lignes.length} lignes`,
);
const result = analyse(lignes, entites, balance);
console.log(`analyse en ${Date.now() - t0} ms`);
console.log(`stats: ${JSON.stringify(result.stats, null, 1)}`);

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const num = (v: number, w = 16) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(w);

console.log("\n=== Écarts par entité (app) vs feuille 2 ===");
console.log(
  `${pad("entité", 30)} | ${pad("appel", 16)} | ${pad("tréso", 16)} | ${pad("écart app", 16)} | ${pad("réf feuille", 16)} | ok?`,
);
const byNom = new Map(result.entites.map((e) => [e.nom, e]));
let ok = 0,
  ko = 0;
for (const [nom, ref] of Object.entries(REFERENCE)) {
  const e = byNom.get(nom);
  if (!e) {
    console.log(`${pad(nom, 30)} | ABSENTE de l'analyse`);
    ko++;
    continue;
  }
  const match = Math.abs(e.ecart - ref) < 1.0 || Math.abs(e.ecart - ref) < Math.abs(ref) * 0.000001;
  if (match) ok++;
  else ko++;
  console.log(
    `${pad(nom, 30)} | ${num(e.appelDeFonds)} | ${num(e.tresorerie)} | ${num(e.ecart)} | ${num(ref)} | ${match ? "OK" : "DIFF"}`,
  );
}
console.log(`\nRéférence blocs: ${ok} OK, ${ko} DIFF`);

console.log("\n=== Familles calculées par l'app (result.familles) vs notes formules ===");
const famByNom = new Map(result.familles.map((f) => [f.nom, f]));
const fOK: string[] = [];
const fKO: string[] = [];
for (const [parent, enfantsAttendus] of Object.entries(FAMILLES)) {
  const f = famByNom.get(parent);
  if (!f) {
    fKO.push(`${parent} : famille absente du résultat`);
    continue;
  }
  const attendu = FAMILLE_ATTENDU[parent] ?? { ecart: 0, membres: enfantsAttendus.length + 1 };
  const membresOk =
    f.membres.length === attendu.membres && enfantsAttendus.every((n) => f.membres.includes(n));
  const tol = Math.max(0.011, Math.abs(attendu.ecart) * 0.000001);
  const ecartOk = Math.abs(f.ecart - attendu.ecart) < tol;
  const label = `${parent} [${f.membres.join(", ")}] = ${f.ecart.toFixed(2)} (attendu ${attendu.ecart})`;
  if (membresOk && ecartOk) fOK.push(label);
  else
    fKO.push(
      `${label}${membresOk ? "" : ` — membres attendus [${[parent, ...enfantsAttendus].join(", ")}]`}`,
    );
}
// Toute famille supplémentaire inattendue ?
const extras = result.familles.filter((f) => !FAMILLES[f.nom]);
console.log(`OK: ${fOK.length}/${Object.keys(FAMILLES).length}`);
for (const s of fOK) console.log("  ✓", s);
console.log(
  `DIFF: ${fKO.length}${extras.length ? ` — familles inattendues: ${extras.map((f) => f.nom).join(", ")}` : ""}`,
);
for (const s of fKO) console.log("  ✗", s);

// Statut famille porté sur les entités
const badgeOk = result.entites
  .filter((e) => e.famille)
  .every((e) => FAMILLES[e.famille!]?.includes(e.nom));
console.log(`\nBadges famille sur entités enfants : ${badgeOk ? "OK" : "INCOHÉRENT"}`);

console.log("\n=== Toutes les entités triées par |écart| ===");
for (const e of result.entites.slice(0, 40)) {
  console.log(
    `${pad(e.nom, 30)} suf=${pad(e.suffixe, 3)} appel=${num(e.appelDeFonds)} tréso=${num(e.tresorerie, 15)} écart=${num(e.ecart, 15)} ano=${e.anomalies}`,
  );
}

console.log("\n=== Anomalies par type ===");
const parType: Record<string, number> = {};
for (const a of result.anomalies) parType[a.type] = (parType[a.type] ?? 0) + 1;
console.log(parType);
console.log("\nTop 12 anomalies :");
for (const a of result.anomalies.slice(0, 12)) {
  console.log(
    `  [${a.type}] ${a.entite} — ${a.libelle.slice(0, 50)} — ${a.montant.toFixed(2)} — ${a.detail.slice(0, 80)}`,
  );
}

// ============================================================
// Écarts de famille réels : pièces concernées (à corriger dans Sage)
// Règle RAN : seuls les RAN portant sur 401000 / 460 / 411 sont considérés ;
// les RAN 462/467 (comptes d'attente), 512/513 et divers sont résumés à part
// et le rapprochement Σ pièces + RAN non considérés = écart feuille est vérifié.
// ============================================================
console.log("\n=== Pièces composant les écarts de famille réels (règle RAN 401000/460/411) ===");
const reelles = result.familles.filter((f) => !f.soldee);
const soldees = result.familles.filter((f) => f.soldee);
let pOK = 0;
let pKO = 0;
for (const f of reelles) {
  const somme = f.pieces.reduce((t, p) => t + p.net, 0);
  const rapproche = Math.abs(somme + f.ranNonConsidere - f.ecart) < 0.02;
  const tousNetNonNul = f.pieces.every((p) => Math.abs(p.net) >= 0.01);
  // Tri : non soldées d'abord (elles portent l'écart), puis soldées par
  // lettrage — |net| décroissant dans chaque groupe.
  const triees = f.pieces.every((p, i) => {
    if (i === 0) return true;
    const prev = f.pieces[i - 1]!;
    if (Number(prev.lettree ?? false) !== Number(p.lettree ?? false)) return !prev.lettree; // transition autorisée : non soldée → soldée
    return Math.abs(prev.net) >= Math.abs(p.net);
  });
  // Lettrage : une écriture soldée (montant exactement opposé à une autre)
  // n'est JAMAIS candidate de la combinaison — elle se compense.
  const lettrageOk = f.pieces.every((p) => !(p.lettree && p.dansCombinaison));
  // Σ des non soldées (le vivier de la recherche) + RAN non considérés = écart.
  const sommeNonSold = f.pieces.filter((p) => !p.lettree).reduce((t, p) => t + p.net, 0);
  const rapprocheLettrage = Math.abs(sommeNonSold + f.ranNonConsidere - f.ecart) < 0.02;
  // Aucune pièce RAN listée ne doit porter un net sur 462/467/512/513 :
  // ses comptes de périmètre doivent tous être des comptes considérés
  // (401000 / 460 / 411 — en pratique des 460xxx dans le périmètre famille).
  const ranOk = f.pieces
    .filter((p) => p.role === "a_nouveaux")
    .every((p) => p.comptes.split(", ").every((c) => /^(401000|460|411)/.test(c)));
  if (rapproche && tousNetNonNul && triees && ranOk && lettrageOk && rapprocheLettrage) pOK++;
  else pKO++;
  const roles: Record<string, number> = {};
  for (const p of f.pieces) roles[p.role] = (roles[p.role] ?? 0) + 1;
  const nbSold = f.pieces.filter((p) => p.lettree).length;
  console.log(
    `${f.nom.padEnd(22)} écart=${f.ecart.toFixed(2).padStart(13)} | pièces=${String(f.pieces.length).padStart(5)} (non soldées ${String(f.pieces.length - nbSold).padStart(4)}, soldées ${String(nbSold).padStart(4)}) | Σ non sold.=${sommeNonSold.toFixed(2).padStart(13)} | RAN non cons.=${f.nbRanNonConsidere} (${f.ranNonConsidere.toFixed(2)}) | ${rapproche && rapprocheLettrage ? "Σ+RAN=écart ✓" : "RAPPROCHEMENT DIFF"}${tousNetNonNul ? "" : " | NET NUL !"}${triees ? "" : " | MAL TRIÉ"}${ranOk ? "" : " | RAN 462/467 LISTÉ !"}${lettrageOk ? "" : " | SOLDÉE DANS COMBINAISON !"} | roles=${JSON.stringify(roles)}`,
  );
  for (const p of f.pieces.filter((p) => p.role === "a_nouveaux").slice(0, 3)) {
    console.log(
      `    [${p.role}] ${p.date} ${p.journal.padEnd(6)} ${p.piece.padEnd(10)} net=${p.net.toFixed(2).padStart(14)} comptesTous=${p.comptesTous.slice(0, 60)}`,
    );
  }
}
for (const f of soldees) {
  if (f.pieces.length !== 0 || f.nbRanNonConsidere !== 0 || f.ranNonConsidere !== 0) {
    pKO++;
    console.log(
      `  ✗ ${f.nom} : famille soldée avec ${f.pieces.length} pièces / ${f.nbRanNonConsidere} RAN non considérés (attendu 0)`,
    );
  }
}
console.log(
  `Familles vérifiées: ${pOK} OK, ${pKO} KO (${reelles.length} réelles + ${soldees.length} soldées à pièces vides)`,
);
console.log(
  `Stats.piecesAFixer = ${result.stats.piecesAFixer} (attendu ${reelles.reduce((t, f) => t + f.pieces.length, 0)})`,
);

// RAN de tiers hors familles (401000 / 460 / 411) — à considérer
console.log("\n=== RAN de tiers (401000/460/411) hors familles réelles ===");
const ranTiers = result.ranTiers;
const ranTiersOk = ranTiers.every((p) => /^(401000|460|411)/.test(p.comptesTiers));
const piece27 = ranTiers.find((p) => p.piece === "27");
const piece27Ok = piece27 ? Math.abs(piece27.net - -172800) < 0.01 : false;
console.log(
  `stats.ranTiers = ${result.stats.ranTiers} | tous sur 401000/460/411 : ${ranTiersOk ? "OK" : "KO"} | pièce 27 (401000 -172 800) : ${piece27Ok ? "OK" : "ABSENTE/DIFF"}`,
);
for (const p of ranTiers.slice(0, 8)) {
  console.log(
    `    ${p.piece.padEnd(10)} ${p.date} net=${p.net.toFixed(2).padStart(14)} tiers=[${p.comptesTiers}]`,
  );
}

// Référencement croisé : une pièce partagée entre deux familles réelles
const partagees = reelles.flatMap((f) =>
  f.pieces.filter((p) => p.aussiDans).map((p) => ({ f: f.nom, p })),
);
console.log(`Pièces partagées entre familles réelles : ${partagees.length}`);
for (const { f, p } of partagees.slice(0, 5)) {
  console.log(
    `  ${f} ↔ ${p.aussiDans!.join(", ")} : ${p.journal} ${p.piece} ${p.date} net=${p.net.toFixed(2)}`,
  );
}

// Anomalies croisées avec les pièces d'écart
const nbAnomalies = reelles.reduce((t, f) => t + f.pieces.filter((p) => p.anomalie).length, 0);
console.log(`Pièces d'écart aussi signalées comme anomalies : ${nbAnomalies}`);
console.log(
  `Stats.piecesAFixer = ${result.stats.piecesAFixer} (attendu ${reelles.reduce((t, f) => t + f.pieces.length, 0)})`,
);

// ============================================================
// Combinaisons exactes d'écritures erronées (feuille 2 du Verif BG) :
// l'écart peut être composé de PLUSIEURS écritures erronées (ex.
// 90 000 = 48 000 + 2 000 + 40 000) comme d'une seule. L'app détecte la
// plus petite combinaison de pièces dont la somme redonne exactement
// l'écart, au centime, et la pièce de référence TOM (90 000) est vérifiée.
// ============================================================
console.log("\n=== Combinaisons exactes d'écritures erronées par famille ===");
let cOK = 0;
let cKO = 0;
for (const f of reelles) {
  if (f.combinaisons.length === 0) {
    // Échec honnête accepté (écart composé de plus de 4 écritures non
    // soldées) : aucune combinaison annoncée, donc aucune somme fausse.
    if (f.combinaisonEchec && f.nbVariantesCombinaison === 0) cOK++;
    else cKO++;
    console.log(
      `  ${f.nom.padEnd(22)} : aucune combinaison (echec=${f.combinaisonEchec}) ${cOK && !cKO ? "✓" : ""}`,
    );
    continue;
  }
  let ok = true;
  // Au plus UNE solution retenue : les variantes « exactes » sont
  // alternatives et non cumulatives, les marquer toutes serait faux.
  if (f.combinaisons.length > 1) ok = false;
  for (const c of f.combinaisons) {
    // Exactitude au centime : Σ des nets de la combinaison = cible annoncée.
    const sommeCents = Math.round(c.pieces.reduce((t, p) => t + p.net, 0) * 100);
    if (sommeCents !== Math.round(c.cible * 100) || sommeCents !== Math.round(c.somme * 100))
      ok = false;
    // Les pièces de la combinaison sont marquées erronées, appartiennent à
    // la famille et ne sont JAMAIS des écritures soldées par lettrage.
    if (!c.pieces.every((p) => p.dansCombinaison && !p.lettree && f.pieces.includes(p))) ok = false;
    // Portée cohérente : « feuille » vise l'écart complet, « hors_ran » l'écart
    // diminué des RAN non considérés.
    const cibleAttendue =
      c.portee === "feuille" ? f.ecart : Math.round((f.ecart - f.ranNonConsidere) * 100) / 100;
    if (Math.abs(c.cible - cibleAttendue) > 0.005) ok = false;
  }
  if (ok) cOK++;
  else cKO++;
  const c = f.combinaisons[0]!;
  console.log(
    `  ${f.nom.padEnd(22)} : ${c.pieces.length} écriture(s) [${c.portee}] ${c.pieces
      .map((p) => `${p.journal} ${p.piece} (${p.net.toFixed(2)})`)
      .join(
        " + ",
      )} = ${c.somme.toFixed(2)} ✓${f.nbVariantesCombinaison > 1 ? ` (${f.nbVariantesCombinaison} variantes alternatives)` : ""}`,
  );
}
console.log(`Combinaisons : ${cOK} OK, ${cKO} KO sur ${reelles.length} familles réelles`);

// BOOST (cas de l'utilisateur) : après lettrage (420 écritures soldées 2 à 2
// par montant exactement opposé), l'écart -186 186,80 est le résidu des 132
// écritures non soldées — aucune combinaison de 1 à 4 ne l'explique, et les
// fausses pistes mélangeant BOOST + JBS + JBU + SANLAMALLIANZ ont disparu.
const boost = reelles.find((f) => f.nom === "BOOST")!;
const nbSoldBoost = boost.pieces.filter((p) => p.lettree).length;
const nbNonSoldBoost = boost.pieces.length - nbSoldBoost;
const sommeNonSoldBoost = boost.pieces.filter((p) => !p.lettree).reduce((t, p) => t + p.net, 0);
const boostOk =
  boost.combinaisonEchec &&
  boost.combinaisons.length === 0 &&
  nbSoldBoost === 420 &&
  nbNonSoldBoost === 132 &&
  Math.abs(sommeNonSoldBoost - boost.ecart) < 0.02;
console.log(
  `BOOST résidu non soldé : échec honnête ${boost.combinaisonEchec ? "OK" : "KO"}, ${nbSoldBoost} soldées / ${nbNonSoldBoost} non soldées, Σ non soldées = ${sommeNonSoldBoost.toFixed(2)} = écart ${boost.ecart.toFixed(2)} : ${boostOk ? "OK" : "KO"}`,
);

// Cas de référence du comptable : l'écart 90 000 de la famille TOM.
const tom = reelles.find((f) => f.nom === "TOM");
const tomOk =
  tom !== undefined &&
  tom.combinaisons.length >= 1 &&
  tom.combinaisons[0]!.portee === "feuille" &&
  tom.combinaisons[0]!.pieces.length === 1 &&
  Math.round(tom.combinaisons[0]!.pieces[0]!.net * 100) === 9000000;
console.log(
  `TOM 90 000 : combinaison exacte ${tomOk ? "OK" : "KO"} (${tom?.combinaisons[0]?.pieces.map((p) => `${p.journal} ${p.piece} ${p.net}`).join(" + ") ?? "aucune"})`,
);

// AITS : l'écart feuille 0,40 est composé de DEUX écritures (0,32 + 0,08).
const aits = reelles.find((f) => f.nom === "AITS");
const aitsOk =
  aits !== undefined &&
  aits.combinaisons.length >= 1 &&
  aits.combinaisons[0]!.portee === "feuille" &&
  aits.combinaisons[0]!.pieces.length === 2 &&
  Math.round(aits.combinaisons[0]!.somme * 100) === 40;
console.log(
  `AITS 0,40 : combinaison de 2 écritures ${aitsOk ? "OK" : "KO"} (${aits?.combinaisons[0]?.pieces.map((p) => p.net.toFixed(2)).join(" + ") ?? "aucune"})`,
);

// Cohérence des stats de combinaisons
const marquees = new Set(
  reelles.flatMap((f) =>
    f.pieces.filter((p) => p.dansCombinaison).map((p) => `${p.journal}|${p.piece}|${p.date}`),
  ),
).size;
const statsCombOk =
  result.stats.famillesResolues === reelles.filter((f) => f.combinaisons.length > 0).length &&
  result.stats.famillesResolues + result.stats.famillesNonResolues === reelles.length &&
  result.stats.piecesErronees === marquees;
console.log(
  `Stats combinaisons : famillesResolues=${result.stats.famillesResolues} + nonResolues=${result.stats.famillesNonResolues} = ${reelles.length} | piecesErronees=${result.stats.piecesErronees} (marquées ${marquees}) : ${statsCombOk ? "OK" : "KO"}`,
);
