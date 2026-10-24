/**
 * Diagnostic 24/10 : pipeline réel de l'app (parseVerif + parseBrouillard + analyse)
 * sur les NOUVEAUX fichiers du 24/10, comparé aux écarts de la feuille « 2026 ».
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 24102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 24102026 VF.xlsx";

// Écarts de référence — feuille « 2026 » du 24/10 (blocs « Vérification » imprimés).
const REFERENCE: Record<string, number> = {
  HOLCIM: -1169515.72,
  "DHL INTERNATIONAL": -140559044.15,
  FSS: 0.0,
  "DHL GLOBAL FORWARDING": 0.0,
  "TELMA MONEY": 12212892.44,
  JOVENA: 700000.0,
  MCB: 172800.0,
  "MAD COM": 0.0,
  "EASY TECH": 6471782.6,
  "TELMA SA": -6077998.42, // bloc principal (la variante -5 673 032,30 inclut EVASAN)
  CONNECTEO: 0.36,
  EDM: -140.0,
  BOOST: -15300244.58,
  LECOFRUIT: 29546020.0,
  SOCOLAIT: 0.0,
  OIM: 0.0,
  "OIM EXP": 0.0,
  "ORANGE MADAGASCAR": 7866303.02,
  "ORANGE MONEY MADAGASCAR": 62098371.47,
  NACRE: -2415837.33,
  STAR: 1480139.9,
  TALOUMIS: 0.0,
  "SANLAMALLIANZ AUTOFI": -28185141.44,
  "SANLAMALLIANZ COMPAGNIE": 15446798.9,
};

const verifBuf = fs.readFileSync(VERIF);
const brouBuf = fs.readFileSync(BROU);
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

console.log("\n=== Écarts par entité (app) vs feuille 24/10 ===");
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

console.log("\n=== Familles calculées par l'app (result.familles) ===");
for (const f of result.familles) {
  console.log(
    `${pad(f.nom, 24)} membres=[${f.membres.join(", ")}] écart=${num(f.ecart, 15)} ${f.soldee ? "SOLDÉE" : ""}`,
  );
}

console.log("\n=== Pièces des familles réelles : vivier / soldées Sage / compensées ===");
const reelles = result.familles.filter((f) => !f.soldee);
for (const f of reelles) {
  const somme = f.pieces.reduce((t, p) => t + p.net, 0);
  const nbSage = f.pieces.filter((p) => p.lettreeSage).length;
  const nbComp = f.pieces.filter((p) => p.lettree && !p.lettreeSage).length;
  const nbVivier = f.pieces.length - nbSage - nbComp;
  const sommeVivier = f.pieces.filter((p) => !p.lettree).reduce((t, p) => t + p.net, 0);
  const comb = f.combinaisons[0];
  console.log(
    `${pad(f.nom, 22)} écart=${num(f.ecart, 15)} | pièces=${String(f.pieces.length).padStart(5)} (vivier ${String(nbVivier).padStart(4)}, Sage ${String(nbSage).padStart(4)}, compensées ${String(nbComp).padStart(4)}) | Σvivier+Sage=${num(sommeVivier, 14)} | RAN non cons. ${f.nbRanNonConsidere} (${num(f.ranNonConsidere, 13)}) | Σtot+RAN ${Math.abs(somme + f.ranNonConsidere - f.ecart) < 0.02 ? "✓" : "DIFF!"} | ${comb ? `${comb.pieces.length} pièce(s) [${comb.portee}] ${comb.somme.toFixed(2)} ×${f.nbVariantesCombinaison}` : f.combinaisonEchec ? "ÉCHEC honnête" : "?"}`,
  );
}

console.log("\n=== Détail des combinaisons trouvées ===");
for (const f of reelles) {
  if (f.combinaisons.length === 0) continue;
  const c = f.combinaisons[0]!;
  console.log(
    `${f.nom} (${f.nbVariantesCombinaison} variantes) : ${c.pieces.map((p) => `${p.journal} ${p.piece} (${p.net.toFixed(2)})`).join(" + ")} = ${c.somme.toFixed(2)} [cible ${c.cible.toFixed(2)}, ${c.portee}]`,
  );
}

console.log("\n=== Entités triées par |écart| (top 25) ===");
for (const e of result.entites.slice(0, 25)) {
  console.log(
    `${pad(e.nom, 30)} suf=${pad(e.suffixe, 3)} appel=${num(e.appelDeFonds)} tréso=${num(e.tresorerie, 15)} écart=${num(e.ecart, 15)} ${e.famille ? `[famille ${e.famille}]` : ""}`,
  );
}
