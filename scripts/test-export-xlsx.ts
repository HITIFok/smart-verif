/**
 * Génération locale de l'export Excel sur les données réelles, pour QA des
 * nouvelles feuilles (Variantes d'attribution), formats monétaires et
 * largeurs de colonnes. Exécution :
 *   npx esbuild scripts/test-export-xlsx.ts --bundle --format=cjs \
 *     --platform=node --outfile=/tmp/t-export.cjs && node /tmp/t-export.cjs
 */
import * as fs from "node:fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { exportAnomalies } from "../src/lib/export-xlsx";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { entites, balance } = parseVerif(ab(fs.readFileSync(VERIF)) as ArrayBuffer);
const lignes = parseBrouillard(ab(fs.readFileSync(BROU)) as ArrayBuffer);
const result = analyse(lignes, entites, balance);

const famillesAmbigues = result.familles.filter((f) => (f.nbVariantesCombinaison ?? 0) > 1);
for (const f of famillesAmbigues) {
  console.log(
    `${f.nom}: ${f.nbVariantesCombinaison} variantes, listées=${f.variantes?.length ?? 0}`,
  );
  f.variantes?.forEach((v, i) => {
    console.log(
      `  #${i + 1} ${v.pieces.map((p) => `${p.journal} ${p.piece} (${p.net.toFixed(2)})`).join(" + ")} = ${v.somme.toFixed(2)}`,
    );
  });
}

process.chdir("/tmp");
exportAnomalies(result);
console.log("\nExport écrit : /tmp/Anomalies_BG_" + new Date().toISOString().slice(0, 10) + ".xlsx");
