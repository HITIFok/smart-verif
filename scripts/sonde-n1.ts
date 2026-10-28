/**
 * Sonde : parseBrouillard TS sur le brouillard N-1 réel + volumes pour l'extension.
 * Vérifie la détection d'en-tête 12 colonnes, le lettrage, les RAN N traçables.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const F_N1 = "/home/z/my-project/upload/BROUILLARD 2025 31082025.xlsx";
const F_N = "/home/z/my-project/upload/BROUILLARD 2026 27102026.xlsx";

// Réplique minimale du parseur TS (parseBrouillard) pour sonder l'en-tête N-1.
function sondeEnTete(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, raw: true, blankrows: true });
  const c: Record<string, number> = {};
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    r.forEach((cell, j) => {
      const n = String(cell ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!n) return;
      if (n.includes("code journal") || n === "journal") c.journal = j;
      else if (n === "date") c.date = j;
      else if (n.includes("pièce") || n.includes("piece")) c.piece = j;
      else if (n.includes("facture")) c.facture = j;
      else if (n === "référence" || n === "reference") c.reference = j;
      else if (n.includes("compte général") || n.includes("compte general")) c.compte = j;
      else if (n.includes("compte tiers")) c.tiers = j;
      else if (n.includes("libellé") || n.includes("libelle")) c.libelle = j;
      else if (n.includes("lettrage")) c.lettrage = j;
      else if (n === "débit" || n === "debit") c.debit = j;
      else if (n === "crédit" || n === "credit") c.credit = j;
    });
    if (c.journal !== undefined && c.compte !== undefined && (c.debit !== undefined || c.credit !== undefined)) {
      headerIdx = i;
      break;
    }
  }
  return { headerIdx, cols: c, nbRows: rows.length, wb };
}

const bufN1 = readFileSync(F_N1).buffer as ArrayBuffer;
const { headerIdx, cols } = sondeEnTete(bufN1);
console.log("N-1 : en-tête ligne", headerIdx + 1, "colonnes =", JSON.stringify(cols));

// Parse rapide des lignes de compte pour les volumes
const wb1 = XLSX.read(bufN1, { type: "array", cellDates: true });
const rows1 = XLSX.utils.sheet_to_json<unknown[]>(wb1.Sheets[wb1.SheetNames[0]!]!, { header: 1, raw: true, blankrows: true });
let n = 0, avecLettrage = 0, ran = 0, ranTiers = 0;
let sd = 0, sc = 0;
for (let i = headerIdx + 1; i < rows1.length; i++) {
  const r = rows1[i] ?? [];
  const compte = String(r[cols.compte!] ?? "").replace(/\.0+$/, "").trim();
  if (!/^\d{6}$/.test(compte)) continue;
  n++;
  const d = Number(r[cols.debit!] ?? 0) || 0;
  const c2 = Number(r[cols.credit!] ?? 0) || 0;
  sd += d; sc += c2;
  const l = String(r[cols.lettrage!] ?? "").trim();
  if (l && l !== "*") avecLettrage++;
  const j = String(r[cols.journal!] ?? "").toUpperCase();
  if (j === "RAN") {
    ran++;
    if (/^(401|411|46)/.test(compte)) ranTiers++;
  }
}
console.log(`N-1 : ${n} écritures | ΣD=${sd.toFixed(2)} ΣC=${sc.toFixed(2)} | lettrées=${avecLettrage} | RAN=${ran} (dont tiers 401/411/46x = ${ranTiers})`);

// RAN N sur comptes de tiers 401/411/46x — volume pour le contrôle OUVERTURE
const bufN = readFileSync(F_N).buffer as ArrayBuffer;
const wb2 = XLSX.read(bufN, { type: "array", cellDates: true });
const rows2 = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets[wb2.SheetNames[0]!]!, { header: 1, raw: true, blankrows: true });
// en-tête N
let h2 = -1;
const c2cols: Record<string, number> = {};
for (let i = 0; i < Math.min(rows2.length, 50); i++) {
  const r = rows2[i] ?? [];
  r.forEach((cell, j) => {
    const n2 = String(cell ?? "").toLowerCase().trim();
    if (n2.includes("code journal")) c2cols.journal = j;
    else if (n2 === "date") c2cols.date = j;
    else if (n2.includes("pièce")) c2cols.piece = j;
    else if (n2.includes("facture")) c2cols.facture = j;
    else if (n2.includes("compte général")) c2cols.compte = j;
    else if (n2.includes("compte tiers")) c2cols.tiers = j;
    else if (n2.includes("libellé")) c2cols.libelle = j;
    else if (n2.includes("lettrage")) c2cols.lettrage = j;
    else if (n2 === "débit") c2cols.debit = j;
    else if (n2 === "crédit") c2cols.credit = j;
  });
  if (c2cols.journal !== undefined && c2cols.compte !== undefined) { h2 = i; break; }
}
let ranN = 0, ranNTiers = 0;
const piecesRanTiers = new Set<string>();
for (let i = h2 + 1; i < rows2.length; i++) {
  const r = rows2[i] ?? [];
  const compte = String(r[c2cols.compte!] ?? "").replace(/\.0+$/, "").trim();
  const j = String(r[c2cols.journal!] ?? "").toUpperCase();
  const p = String(r[c2cols.piece!] ?? "").trim();
  if (j === "RAN") {
    ranN++;
    if (/^(401|411|46)/.test(compte)) {
      ranNTiers++;
      piecesRanTiers.add(`${j}|${p}|${r[c2cols.date!]}`);
    }
  }
}
console.log(`N : RAN=${ranN} lignes, sur 401/411/46x = ${ranNTiers} lignes (${piecesRanTiers.size} pièces RAN à tracer)`);
