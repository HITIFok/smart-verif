/** Vérifications ponctuelles pour le test de référence 24/10. */
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 24102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 24102026 VF.xlsx";
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { entites, balance } = parseVerif(ab(fs.readFileSync(VERIF)) as ArrayBuffer);
const lignes = parseBrouillard(ab(fs.readFileSync(BROU)) as ArrayBuffer);
const result = analyse(lignes, entites, balance);

// 1. RAN tiers : pièce 27 (401000 -172 800) toujours présente ?
const p27 = result.ranTiers.find((p) => p.piece === "27");
console.log(
  `RAN pièce 27 : ${p27 ? `net=${p27.net} tiers=[${p27.comptesTiers}]` : "ABSENTE"} — ranTiers total ${result.ranTiers.length}, Σ=${result.ranTiers.reduce((t, p) => t + p.net, 0).toFixed(2)}`,
);

// 2. EVIOSYS : règlements BOAOMM (4191/7149/6132/8131/7130/10397) — statut
const ev = result.familles.find((f) => f.nom === "EVIOSYS")!;
const reg = ev.pieces.filter(
  (p) => p.journal === "BOAOMM" && ["4191", "7149", "6132", "8131", "7130", "10397"].includes(p.piece),
);
console.log(
  `EVIOSYS règlements BOAOMM présents : ${reg.map((p) => `${p.piece}(sage=${p.lettreeSage ? 1 : 0},comb=${p.dansCombinaison ? 1 : 0},net=${p.net})`).join(", ") || "AUCUN"} — échec=${ev.combinaisonEchec}, écart=${ev.ecart}`,
);

// 3. EASY TECH : combinaison et variantes
const et = result.familles.find((f) => f.nom === "EASY TECH")!;
console.log(
  `EASY TECH : ${et.combinaisons[0]?.pieces.length} pièce(s), variantes=${et.nbVariantesCombinaison}, toutes non soldées=${et.combinaisons[0]?.pieces.every((p) => !p.lettreeSage && !p.lettree)} — pièces: ${et.combinaisons[0]?.pieces.map((p) => p.piece).join(", ")}`,
);

// 4. TOM : famille soldée ?
const tom = result.familles.find((f) => f.nom === "TOM")!;
console.log(`TOM : soldee=${tom.soldee}, écart=${tom.ecart}, pièces=${tom.pieces.length}`);

// 5. AITS : 2 pièces 0,32+0,08 ?
const aits = result.familles.find((f) => f.nom === "AITS")!;
console.log(
  `AITS : ${aits.combinaisons[0]?.pieces.length} pièce(s) [${aits.combinaisons[0]?.portee}] somme=${aits.combinaisons[0]?.somme}, variantes=${aits.nbVariantesCombinaison}`,
);

// 6. Stats globales
console.log(
  `stats: famillesResolues=${result.stats.famillesResolues}, nonResolues=${result.stats.famillesNonResolues}, erronées=${result.stats.piecesErronees}, candidates=${result.stats.piecesAmbigues}, piecesAFixer=${result.stats.piecesAFixer}`,
);

// 7. Compteurs BOOST précis
const bo = result.familles.find((f) => f.nom === "BOOST")!;
console.log(
  `BOOST : Sage=${bo.pieces.filter((p) => p.lettreeSage).length}, compensées=${bo.pieces.filter((p) => p.lettree && !p.lettreeSage).length}, vivier=${bo.pieces.filter((p) => !p.lettree && !p.lettreeSage).length}, échec=${bo.combinaisonEchec}, Σ!lettree=${bo.pieces.filter((p) => !p.lettree).reduce((t, p) => t + p.net, 0).toFixed(2)}`,
);
