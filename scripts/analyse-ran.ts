/**
 * Analyse des RAN dans les pièces d'écart de famille réelles (app pipeline réel).
 * Quantifie : pièces RAN sur 467/462 (à exclure) vs RAN sur 401000/460/411 (à considérer).
 */
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const { entites, balance } = parseVerif(ab(fs.readFileSync(VERIF)) as ArrayBuffer);
const lignes = parseBrouillard(ab(fs.readFileSync(BROU)) as ArrayBuffer);
const result = analyse(lignes, entites, balance);

const cat = (c: string) =>
  /^(460|461)/.test(c)
    ? "460/461"
    : /^462/.test(c)
      ? "462"
      : /^467/.test(c)
        ? "467"
        : /^401/.test(c)
          ? "401"
          : /^411/.test(c)
            ? "411"
            : /^(512|513)/.test(c)
              ? "512/513"
              : "autre";

console.log(`piecesAFixer actuel = ${result.stats.piecesAFixer}`);
const reelles = result.familles.filter((f) => !f.soldee);
let totalRan = 0,
  totalRan467_462 = 0,
  totalRanAutres = 0,
  totalNonRan = 0;
for (const f of reelles) {
  const ran = f.pieces.filter((p) => p.role === "a_nouveaux");
  const nonRan = f.pieces.filter((p) => p.role !== "a_nouveaux");
  const sumRan = ran.reduce((t, p) => t + p.net, 0);
  const sumNonRan = nonRan.reduce((t, p) => t + p.net, 0);
  // RAN : comptes périmètre par catégorie
  let ran467462 = 0,
    ranAutres = 0,
    n467 = 0,
    nAutres = 0;
  for (const p of ran) {
    const comptes = p.comptes.split(", ");
    const seulement467_462 = comptes.length > 0 && comptes.every((c) => /^(462|467)/.test(c));
    if (seulement467_462) {
      ran467462 += p.net;
      n467++;
    } else {
      ranAutres += p.net;
      nAutres++;
    }
  }
  totalRan += ran.length;
  totalRan467_462 += n467;
  totalRanAutres += nAutres;
  totalNonRan += nonRan.length;
  console.log(
    `${f.nom.padEnd(22)} écart=${f.ecart.toFixed(2).padStart(13)} | pièces=${String(f.pieces.length).padStart(5)} (RAN=${ran.length} dont 462/467 seul=${n467}, autres=${nAutres} ; non-RAN=${nonRan.length}) | Σ RAN=${sumRan.toFixed(2)} | Σ non-RAN=${sumNonRan.toFixed(2)} | écart-nonRan=${(f.ecart - sumNonRan).toFixed(2)}`,
  );
}
console.log(
  `\nTOTAL : pièces=${totalRan + totalNonRan} | RAN=${totalRan} (462/467 seul=${totalRan467_462}, autres=${totalRanAutres}) | non-RAN=${totalNonRan}`,
);

// RAN pieces NOT on 462/467 only : what accounts do they touch ?
console.log("\n=== Pièces RAN ne touchant PAS QUE 462/467 (détail comptes) ===");
for (const f of reelles) {
  for (const p of f.pieces.filter((p) => p.role === "a_nouveaux")) {
    const comptes = p.comptes.split(", ");
    if (comptes.every((c) => /^(462|467)/.test(c))) continue;
    console.log(
      `  [${f.nom}] ${p.journal} ${p.piece} ${p.date} net=${p.net.toFixed(2)} comptes=[${p.comptes}] tous=[${p.comptesTous}]`,
    );
  }
}

// RAN pieces anywhere in brouillard touching 401000/460/411 (et leur rapport aux familles réelles)
console.log("\n=== Pièces RAN touchant 401000/460/411 dans tout le brouillard (50 premières) ===");
const parPiece = new Map<
  string,
  { journal: string; piece: string; date: string; comptes: Map<string, number> }
>();
for (const l of lignes) {
  const k = `${l.journal}|${l.piece}|${l.date}`;
  const e = parPiece.get(k) ?? {
    journal: l.journal,
    piece: l.piece,
    date: l.date,
    comptes: new Map<string, number>(),
  };
  e.comptes.set(l.compte, (e.comptes.get(l.compte) ?? 0) + l.debit - l.credit);
  parPiece.set(k, e);
}
let n = 0;
for (const [k, e] of parPiece) {
  if (e.journal !== "RAN") continue;
  const cible = [...e.comptes.keys()].filter((c) => /^(401000|460|411)/.test(c));
  if (!cible.length) continue;
  const tot = [...e.comptes.values()].reduce((t, v) => t + v, 0);
  console.log(
    `  ${e.piece.padEnd(12)} ${e.date} net_total=${tot.toFixed(2).padStart(14)} | ${cible.map((c) => `${c}:${e.comptes.get(c)!.toFixed(2)}`).join(" ")}${tot !== 0 ? "  << DÉSÉQUILIBRÉE" : ""}`,
  );
  if (++n >= 50) break;
}
