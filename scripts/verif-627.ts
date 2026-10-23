/**
 * Vérification réelle de la règle 627 après implémentation :
 * - anomalies hors_perimetre sur pièces 627 : doit être 0
 * - propositions frais_bancaires : BOAHOL/BOAJOV/BNISAN vers BOAMCI, statuts
 */
import * as fs from "fs";
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const lignes = parseBrouillard(fs.readFileSync(BROU).buffer as ArrayBuffer);
const { entites, balance } = parseVerif(fs.readFileSync(VERIF).buffer as ArrayBuffer);
const res = analyse(lignes, entites, balance);

// 1) Anomalies sur pièces 627 — doit être 0
const cles627 = new Set(
  lignes.filter((l) => l.compte.startsWith("627")).map((l) => `${l.journal}|${l.piece}|${l.date}`),
);
const anom627 = res.anomalies.filter((a) => cles627.has(`${a.journal}|${a.piece}|${a.date}`));
console.log("Anomalies sur pièces 627 :", anom627.length, anom627.length === 0 ? "OK" : "KO !");
for (const a of anom627.slice(0, 5)) console.log("  ", a.type, a.journal, a.piece);

// 2) Propositions frais_bancaires
const frais = res.transferts.filter((t) => t.type === "frais_bancaires");
const parDest = new Map<string, { n: number; aCreer: number; deja: number; total: number }>();
for (const t of frais) {
  const e = parDest.get(t.banqueDestination) ?? { n: 0, aCreer: 0, deja: 0, total: 0 };
  e.n++;
  if (t.statut === "a_creer") e.aCreer++;
  if (t.statut === "existe_deja") e.deja++;
  if (t.statut === "a_creer") e.total = Math.round((e.total + t.montant) * 100) / 100;
  parDest.set(t.banqueDestination, e);
}
console.log("\nPropositions frais_bancaires :", frais.length);
for (const [b, e] of parDest)
  console.log(
    `  → ${b}: ${e.n} pièce(s), ${e.aCreer} à créer (${fmt(e.total)}), ${e.deja} déjà passée(s)`,
  );

console.log("\nExemples BOAHOL/HOLCIM :");
for (const t of frais.filter((t) => t.banqueDestination === "512110").slice(0, 4))
  console.log(
    `  ${t.journalSource}:${t.banqueSource} → ${t.journalDestination}:${t.banqueDestination} | ${fmt(t.montant)} | [${t.statut}] pièce ${t.piece} ${t.date} | ${t.motif.slice(0, 80)}`,
  );
console.log("\nExemples BNISAN (AGIOS) :");
for (const t of frais.filter((t) => t.banqueDestination === "512100").slice(0, 3))
  console.log(`  ${fmt(t.montant)} [${t.statut}] pièce ${t.piece} — ${t.libelle.slice(0, 50)}`);

// 3) Vérification de la cohérence : envoyeur = BOAMCI 580001 D / 512000 C
const t0 = frais.find((t) => t.statut === "a_creer");
if (t0)
  console.log(
    `\nÉcritures proposées (${t0.entite}) :\n  envoyeur: ${t0.envoyeur.map((l) => `${l.compte} ${l.sens} ${fmt(l.montant)}`).join(" / ")}\n  réception: ${t0.receptionnaire.map((l) => `${l.compte} ${l.sens} ${fmt(l.montant)}`).join(" / ")}`,
  );

// 4) Stats générales non régressées
console.log("\nStats anomalies:", JSON.stringify(res.stats.anomalies ?? {}, null, 0).slice(0, 200));
console.log("Total anomalies:", res.anomalies.length, "| transferts:", res.transferts.length);
