/**
 * Diagnostic EVIOSYS : pourquoi 7130 est marquée erronée alors qu'elle est
 * correcte et lettrée AS dans Sage ?
 * Rejoue le pipeline réel et dump toutes les pièces de la famille EVIOSYS.
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";

const verifBuf = fs.readFileSync(VERIF);
const brouBuf = fs.readFileSync(BROU);
const vwb = parseVerif(
  new Uint8Array(verifBuf).buffer.slice(
    new Uint8Array(verifBuf).byteOffset,
    new Uint8Array(verifBuf).byteOffset + new Uint8Array(verifBuf).byteLength,
  ),
);
const brou = parseBrouillard(
  new Uint8Array(brouBuf).buffer.slice(
    new Uint8Array(brouBuf).byteOffset,
    new Uint8Array(brouBuf).byteOffset + new Uint8Array(brouBuf).byteLength,
  ),
);
const res = analyse(brou, vwb.entites, vwb.balance);

const fam = res.familles.find((f) => f.nom === "EVIOSYS");
if (!fam) {
  console.log("Famille EVIOSYS introuvable. Familles:", res.familles.map((f) => f.nom));
  process.exit(1);
}

console.log("=== FAMILLE", fam.nom, "— membres:", fam.membres.join(", "));
console.log("appel:", fam.appelDeFonds, "| treso:", fam.tresorerie, "| écart:", fam.ecart);
console.log(
  "nb pièces:", fam.pieces.length,
  "| nbNonSoldees:", fam.combinaisonNbNonSoldees ?? "(voir ResolutionEcart)",
  "| combinaisonEchec:", fam.combinaisonEchec,
  "| nbVariantes:", fam.nbVariantesCombinaison,
);
console.log("ranNonConsidere:", fam.ranNonConsidere, "×", fam.nbRanNonConsidere);

const fmt = (n: number) =>
  (n < 0 ? "" : " ") + n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log("\n--- Pièces de la combinaison retenue (marquées erronées) ---");
for (const p of fam.pieces.filter((p) => p.dansCombinaison)) {
  console.log(
    `${p.journal ?? "?"} ${p.piece ?? "?"} ${p.date ?? "?"} | net ${fmt(p.net)} | role ${p.role} | lettree=${p.lettree} | comptes ${[...(p.comptes ?? [])].join("+")} | ${(p.libelle ?? "").slice(0, 70)}`,
  );
}

console.log("\n--- Toutes les pièces dont |net| = 54 000 (candidats au lettrage 54k) ---");
for (const p of fam.pieces.filter((p) => Math.abs(Math.round(p.net * 100)) === 5400000)) {
  console.log(
    `${p.journal ?? "?"} ${p.piece ?? "?"} ${p.date ?? "?"} | net ${fmt(p.net)} | role ${p.role} | lettree=${p.lettree} | dansComb=${p.dansCombinaison} | comptes ${[...(p.comptes ?? [])].join("+")} | ${(p.libelle ?? "").slice(0, 70)}`,
  );
}

console.log("\n--- Les 3 pièces suspectes (10397 / 8131 / 7130 de BOAOMM) ---");
for (const p of fam.pieces.filter((p) => ["10397", "8131", "7130"].includes(String(p.piece)))) {
  console.log(
    `${p.journal ?? "?"} ${p.piece ?? "?"} ${p.date ?? "?"} | net ${fmt(p.net)} | role ${p.role} | lettree=${p.lettree} | dansComb=${p.dansCombinaison} | comptes ${[...(p.comptes ?? [])].join("+")}`,
  );
  console.log("   libellé:", (p.libelle ?? "").slice(0, 100));
}

console.log("\n--- Détail brouillard des pièces 7130/7128 (toutes lignes) ---");
// Réutilise le parseur : retrouve les lignes brutes de ces pièces
const lignes = (brou as unknown as { lignes?: unknown[] }).lignes ?? [];
console.log("(structure brouillard:", typeof brou, Object.keys(brou as object).slice(0, 12).join(","), ")");
void lignes;
