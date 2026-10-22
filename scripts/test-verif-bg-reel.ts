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
console.log(`parseVerif: ${entites.length} entités ; balance: ${balance?.length ?? 0} comptes ; brouillard: ${lignes.length} lignes`);
const result = analyse(lignes, entites, balance);
console.log(`analyse en ${Date.now() - t0} ms`);
console.log(`stats: ${JSON.stringify(result.stats, null, 1)}`);

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const num = (v: number, w = 16) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(w);

console.log("\n=== Écarts par entité (app) vs feuille 2 ===");
console.log(`${pad("entité", 30)} | ${pad("appel", 16)} | ${pad("tréso", 16)} | ${pad("écart app", 16)} | ${pad("réf feuille", 16)} | ok?`);
const byNom = new Map(result.entites.map((e) => [e.nom, e]));
let ok = 0, ko = 0;
for (const [nom, ref] of Object.entries(REFERENCE)) {
  const e = byNom.get(nom);
  if (!e) {
    console.log(`${pad(nom, 30)} | ABSENTE de l'analyse`);
    ko++;
    continue;
  }
  const match = Math.abs(e.ecart - ref) < 1.0 || Math.abs(e.ecart - ref) < Math.abs(ref) * 0.000001;
  if (match) ok++; else ko++;
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
    f.membres.length === attendu.membres &&
    enfantsAttendus.every((n) => f.membres.includes(n));
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
console.log(`DIFF: ${fKO.length}${extras.length ? ` — familles inattendues: ${extras.map((f) => f.nom).join(", ")}` : ""}`);
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
  console.log(`  [${a.type}] ${a.entite} — ${a.libelle.slice(0, 50)} — ${a.montant.toFixed(2)} — ${a.detail.slice(0, 80)}`);
}

// ============================================================
// Écarts de famille réels : pièces concernées (à corriger dans Sage)
// ============================================================
console.log("\n=== Pièces composant les écarts de famille réels ===");
const reelles = result.familles.filter((f) => !f.soldee);
const soldees = result.familles.filter((f) => f.soldee);
let pOK = 0;
let pKO = 0;
for (const f of reelles) {
  const somme = f.pieces.reduce((t, p) => t + p.net, 0);
  const sommeOK = Math.abs(somme - f.ecart) < 0.02;
  const tousNetNonNul = f.pieces.every((p) => Math.abs(p.net) >= 0.01);
  const triees = f.pieces.every(
    (p, i) => i === 0 || Math.abs(f.pieces[i - 1]!.net) >= Math.abs(p.net),
  );
  if (sommeOK && tousNetNonNul && triees) pOK++;
  else pKO++;
  const roles: Record<string, number> = {};
  for (const p of f.pieces) roles[p.role] = (roles[p.role] ?? 0) + 1;
  console.log(
    `${f.nom.padEnd(22)} écart=${f.ecart.toFixed(2).padStart(13)} | pièces=${String(f.pieces.length).padStart(5)} | Σ=${somme.toFixed(2).padStart(13)} | ${sommeOK ? "Σ=écart ✓" : "Σ DIFF"}${tousNetNonNul ? "" : " | NET NUL !" }${triees ? "" : " | MAL TRIÉ"} | roles=${JSON.stringify(roles)}`,
  );
  for (const p of f.pieces.slice(0, 3)) {
    console.log(
      `    [${p.role}] ${p.date} ${p.journal.padEnd(6)} ${p.piece.padEnd(10)} net=${p.net.toFixed(2).padStart(14)}${p.anomalie ? " [anomalie]" : ""}${p.aussiDans ? ` [aussi ${p.aussiDans.join(",")}]` : ""} ${p.libelle.slice(0, 45)}`,
    );
  }
}
for (const f of soldees) {
  if (f.pieces.length !== 0) {
    pKO++;
    console.log(`  ✗ ${f.nom} : famille soldée avec ${f.pieces.length} pièces (attendu 0)`);
  }
}
console.log(`Familles vérifiées: ${pOK} OK, ${pKO} KO (${reelles.length} réelles + ${soldees.length} soldées à pièces vides)`);

// Référencement croisé : une pièce partagée entre deux familles réelles
const partagees = reelles.flatMap((f) => f.pieces.filter((p) => p.aussiDans).map((p) => ({ f: f.nom, p })));
console.log(`Pièces partagées entre familles réelles : ${partagees.length}`);
for (const { f, p } of partagees.slice(0, 5)) {
  console.log(`  ${f} ↔ ${p.aussiDans!.join(", ")} : ${p.journal} ${p.piece} ${p.date} net=${p.net.toFixed(2)}`);
}

// Anomalies croisées avec les pièces d'écart
const nbAnomalies = reelles.reduce((t, f) => t + f.pieces.filter((p) => p.anomalie).length, 0);
console.log(`Pièces d'écart aussi signalées comme anomalies : ${nbAnomalies}`);
console.log(`Stats.piecesAFixer = ${result.stats.piecesAFixer} (attendu ${reelles.reduce((t, f) => t + f.pieces.length, 0)})`);
