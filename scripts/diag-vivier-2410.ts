/**
 * Analyse de la composition des viviers des familles en échec honnête (données 24/10).
 * Répond à : de quoi l'écart résiduel est-il fait ? (RAN à-nouveaux, frais 627,
 * comptes-à-compte 580001, décalages mensuels, autres)
 */
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 24102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 24102026 VF.xlsx";

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { entites, balance } = parseVerif(ab(fs.readFileSync(VERIF)) as ArrayBuffer);
const lignes = parseBrouillard(ab(fs.readFileSync(BROU)) as ArrayBuffer);
const result = analyse(lignes, entites, balance);

const num = (v: number, w = 14) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(w);

for (const f of result.familles.filter((x) => !x.soldee)) {
  const vivier = f.pieces.filter((p) => !p.lettree && !p.lettreeSage);
  const parRole: Record<string, { n: number; somme: number }> = {};
  for (const p of vivier) {
    const r = parRole[p.role] ?? { n: 0, somme: 0 };
    r.n++;
    r.somme += p.net;
    parRole[p.role] = r;
  }
  console.log(
    `\n### ${f.nom} — écart ${f.ecart.toFixed(2)} | vivier ${vivier.length} pièce(s), Σ=${vivier.reduce((t, p) => t + p.net, 0).toFixed(2)}`,
  );
  for (const [role, v] of Object.entries(parRole).sort((a, b) => Math.abs(b[1].somme) - Math.abs(a[1].somme))) {
    console.log(`   ${role.padEnd(16)} ${String(v.n).padStart(4)} pièce(s)  Σ=${num(v.somme)}`);
  }
  // Top pièces non RAN du vivier (les vraies candidates potentielles)
  const nonRan = vivier.filter((p) => p.role !== "a_nouveaux");
  console.log(
    `   Top 10 non-RAN du vivier : ${nonRan
      .slice(0, 10)
      .map((p) => `${p.journal}/${p.piece} (${p.net.toFixed(2)}, ${p.role})`)
      .join(" · ")}`,
  );
  // RAN du vivier : leur somme
  const ran = vivier.filter((p) => p.role === "a_nouveaux");
  console.log(
    `   RAN du vivier : ${ran.length} pièce(s), Σ=${ran.reduce((t, p) => t + p.net, 0).toFixed(2)} — comptes: ${[...new Set(ran.flatMap((p) => p.comptes.split(", ")))].slice(0, 8).join(", ")}`,
  );
}
