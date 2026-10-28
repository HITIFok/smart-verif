/** Diag qualité : échantillons des contrôles réels par règle. */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const UP = "/home/z/my-project/upload";
const verifBuf = await Bun.file(`${UP}/Verif BG 27102026 VF.xlsx`).arrayBuffer();
const { entites, balance, ecartsReference } = parseVerif(verifBuf);
const broBuf = await Bun.file(`${UP}/BROUILLARD 2026 27102026.xlsx`).arrayBuffer();
const lignes = parseBrouillard(broBuf);
const result = analyse(lignes, entites, balance, ecartsReference);

console.log("=== B_460_462 (erreurs d'imputation probables) ===");
for (const c of result.rapprochements
  .filter((x) => x.type === "B_460_462" && x.statut !== "correspondance_trouvee")
  .slice(0, 12))
  console.log(
    `  [${c.statut}] ${c.societe} · ${c.journal} · ${c.compteGeneral} · pièce ${c.refPiece} · ${c.date} · ${c.montantAttendu.toLocaleString("fr-FR")} · ${c.libelle.slice(0, 50)}`,
  );

console.log("\n=== A_doublon (top 10 par montant) ===");
for (const c of result.rapprochements.filter((x) => x.type === "A_doublon").slice(0, 10))
  console.log(
    `  ${c.societe.slice(0, 20)} · ${c.journal} · ${c.compteGeneral}/${c.compteTiers} · pièces ${c.refPiece} · ${c.montantAttendu.toLocaleString("fr-FR")} · ${c.libelle.slice(0, 45)}`,
  );

console.log("\n=== C_627 (tous) ===");
for (const c of result.rapprochements.filter((x) => x.type === "C_627"))
  console.log(
    `  [${c.statut}] ${c.societe} · ${c.journal} · attendu ${c.montantAttendu.toLocaleString("fr-FR")} · rapproché ${c.montantRapproche.toLocaleString("fr-FR")} · restant ${c.ecartRestant.toLocaleString("fr-FR")}`,
  );

console.log("\n=== A_411 (non soldés) ===");
for (const c of result.rapprochements.filter(
  (x) => x.type === "A_411" && x.statut !== "correspondance_trouvee",
))
  console.log(
    `  [${c.statut}] ${c.societe} · ${c.journal} · attendu ${c.montantAttendu.toLocaleString("fr-FR")} · rapproché ${c.montantRapproche.toLocaleString("fr-FR")} · restant ${c.ecartRestant.toLocaleString("fr-FR")}`,
  );

console.log("\n=== Anomalies écart balance (brouillard ≠ balance) ===");
for (const a of result.anomalies.filter((x) => x.type === "ecart_balance").slice(0, 8))
  console.log(`  ${a.entite} · ${a.comptes} · ${a.montant.toLocaleString("fr-FR")}`);
