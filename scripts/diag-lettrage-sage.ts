/**
 * Diagnostic : lettrage SAGE réel (colonne « Lettrage montant » du brouillard)
 * vs lettrage heuristique actuel (montants exactement opposés).
 *
 * Questions :
 *  1. Les pièces BOAOMM 8131 / 7130 (10397 absent du brouillard 20/10) sont-elles
 *     couvertes par des groupes de lettrage Sage équilibrés sur (compte, tiers, code) ?
 *  2. La règle « pièce soldée Sage = toutes ses lignes lettrées dans des groupes
 *     équilibrés + ses lignes sans lettrage toutes bancaires (512/513) » change-t-elle
 *     le vivier du solveur par famille ?
 *  3. Quel est le nouvel outcome du solveur (EVIOSYS notamment) ?
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
import { analyse, parseVerif } from "../src/lib/analyzer";
import { resoudreEcartFamille } from "../src/lib/ecarts";
import type { EntryLine } from "../src/lib/analysis-types";

const VERIF = "/home/z/my-project/upload/Verif BG 21102026.xlsx";
const BROU = "/home/z/my-project/upload/BROUILLARD 2026 20102026.xlsx";

const buf = (p: string) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

// --- Parse brouillard AVEC lettrage ---
function parseBrouillardLettrage(buffer: ArrayBuffer): EntryLine[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: "" });
  const pick = (r: Record<string, unknown>, ...keys: string[]) => {
    for (const k of Object.keys(r)) {
      const norm = k.toLowerCase().replace(/\s+/g, " ").trim();
      if (keys.some((x) => norm.includes(x))) return r[k];
    }
    return "";
  };
  const num = (v: unknown): number => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/\s/g, "").replace(",", "."));
      return isFinite(n) ? n : 0;
    }
    return 0;
  };
  return rows
    .map((r): EntryLine => {
      const rawDate = pick(r, "date");
      return {
        journal: String(pick(r, "code journal", "journal") ?? "").trim(),
        piece: String(pick(r, "pièce", "piece") ?? "")
          .replace(/\.0$/, "")
          .trim(),
        date:
          rawDate instanceof Date
            ? rawDate.toISOString().slice(0, 10)
            : String(rawDate).slice(0, 10),
        compte: String(pick(r, "compte général", "compte general") ?? "")
          .replace(/\.0$/, "")
          .trim(),
        tiers: String(pick(r, "compte tiers") ?? "").trim(),
        libelle: String(pick(r, "libellé", "libelle") ?? "").trim(),
        debit: num(pick(r, "débit", "debit")),
        credit: num(pick(r, "crédit", "credit")),
        // champ additionnel non standard, porté pour le diagnostic
        ...(String(pick(r, "lettrage") ?? "").trim()
          ? { lettrage: String(pick(r, "lettrage") ?? "").trim() }
          : {}),
      } as EntryLine & { lettrage?: string };
    })
    .filter((l) => l.compte);
}

const lignes = parseBrouillardLettrage(buf(BROU));
console.log(`brouillard: ${lignes.length} lignes`);

const withLettrage = lignes.filter((l) => (l as { lettrage?: string }).lettrage);
console.log(`lignes avec code de lettrage: ${withLettrage.length}`);

// --- Groupes de lettrage (compte | tiers | code) ---
const groupes = new Map<string, EntryLine[]>();
for (const l of lignes) {
  const code = (l as { lettrage?: string }).lettrage;
  if (!code) continue;
  const k = `${l.compte}|${l.tiers}|${code}`;
  const arr = groupes.get(k);
  if (arr) arr.push(l);
  else groupes.set(k, [l]);
}
const centsOf = (ls: EntryLine[]) =>
  Math.round(ls.reduce((t, l) => t + l.debit - l.credit, 0) * 100);
const equilibres = new Map<string, boolean>();
let nbEq = 0;
for (const [k, ls] of groupes) {
  const eq = centsOf(ls) === 0;
  equilibres.set(k, eq);
  if (eq) nbEq++;
}
console.log(`groupes de lettrage: ${groupes.size} dont équilibrés: ${nbEq}`);

// --- Règle « pièce soldée Sage » ---
const TR = (c: string) => c.startsWith("512") || c.startsWith("513");
function pieceSoldeeSage(group: (EntryLine & { lettrage?: string })[]): boolean {
  let nbLettrées = 0;
  for (const l of group) {
    const code = l.lettrage;
    if (code) {
      const k = `${l.compte}|${l.tiers}|${code}`;
      if (!equilibres.get(k)) return false; // lettrage partiel / déséquilibré
      nbLettrées++;
    } else if (!TR(l.compte)) {
      return false; // ligne non bancaire sans lettrage : pas soldée
    }
  }
  return nbLettrées > 0;
}

// --- Pipeline réel ---
const vwb = parseVerif(buf(VERIF));
const res = analyse(lignes as EntryLine[], vwb.entites, vwb.balance);

// Regroupe les lignes par pièce (même clé que l'analyze)
const pieces = new Map<string, (EntryLine & { lettrage?: string })[]>();
for (const l of lignes as (EntryLine & { lettrage?: string })[]) {
  const k = `${l.journal}|${l.piece}|${l.date}`;
  const arr = pieces.get(k);
  if (arr) arr.push(l);
  else pieces.set(k, [l]);
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 1. Vérif ciblée : pièces BOAOMM 8131 / 7130 (et 10397 s'il existait)
console.log("\n=== Pièces BOAOMM CAMUSAT (règlements) ===");
for (const cible of ["8131", "7130", "10397"]) {
  for (const [k, g] of pieces) {
    if (!k.startsWith("BOAOMM|" + cible + "|")) continue;
    const codes = [...new Set(g.map((l) => l.lettrage ?? "").filter(Boolean))];
    console.log(
      `${k} : ${g.length} lignes, Σ ${fmt(g.reduce((t, l) => t + l.debit - l.credit, 0))}, codes lettrage: ${codes.join(",") || "(aucun)"}, soldéeSage=${pieceSoldeeSage(g)}`,
    );
    for (const l of g.slice(0, 20)) {
      console.log(
        `   ${l.compte} ${l.tiers || "  —   "} ${l.lettrage ? `[${l.lettrage}]` : "     "} D=${fmt(l.debit)} C=${fmt(l.credit)} — ${l.libelle.slice(0, 60)}`,
      );
    }
    // groupes correspondants
    for (const l of g) {
      if (!l.lettrage) continue;
      const gk = `${l.compte}|${l.tiers}|${l.lettrage}`;
      const gl = groupes.get(gk)!;
      console.log(
        `      groupe ${gk} : ${gl.length} ligne(s), Σ=${fmt(centsOf(gl) / 100)}, équilibré=${equilibres.get(gk)}`,
      );
    }
  }
}

// 2. Impact par famille : pièces nouvellement soldées + nouvel outcome solveur
console.log("\n=== Impact de la règle par famille réelle ===");
const isTRLine = (c: string) => TR(c);
try {
  for (const fam of res.familles.filter((f) => !f.soldee)) {
    const avant = fam.pieces;
    const nbSoldeesAvant = avant.filter((p) => p.lettree).length;
    // Marque soldée Sage
    const soldeeSage = new Set<string>();
    for (const p of avant) {
      const g = pieces.get(`${p.journal}|${p.piece}|${p.date}`);
      if (g && pieceSoldeeSage(g)) soldeeSage.add(`${p.journal}|${p.piece}|${p.date}`);
    }
    // Nouveau vivier : hors soldées Sage, puis lettrage par montants opposés
    const vivier = avant.filter((p) => !soldeeSage.has(`${p.journal}|${p.piece}|${p.date}`));
    // clone pour ne pas toucher l'état
    const clones = vivier.map((p) => ({ ...p }));
    resoudreEcartFamille(clones, fam.ecart, fam.ranNonConsidere);
    const nbNS = clones.filter((p) => !p.lettree).length;
    console.log(
      `${fam.nom}: écart ${fmt(fam.ecart)} | pièces ${avant.length} | soldéesSage ${soldeeSage.size} | vivier après lettrage opposé: ${nbNS} (avant: ${avant.length - nbSoldeesAvant}) | combinaison: ${
        clones
          .filter((p) => p.dansCombinaison)
          .map((p) => p.journal + " " + p.piece)
          .join(", ") || "AUCUNE (échec honnête)"
      }`,
    );
  }
} catch (e) {
  console.log("ERREUR boucle familles:", (e as Error).stack);
}

// 3. Focus EVIOSYS : avant/après détaillé
const famE = res.familles.find((f) => f.nom === "EVIOSYS");
if (famE) {
  console.log("\n=== EVIOSYS : pièces NON soldées après la règle Sage (vivier) ===");
  const soldeeSage = new Set<string>();
  for (const p of famE.pieces) {
    const g = pieces.get(`${p.journal}|${p.piece}|${p.date}`);
    if (g && pieceSoldeeSage(g)) soldeeSage.add(`${p.journal}|${p.piece}|${p.date}`);
  }
  const clones = famE.pieces
    .filter((p) => !soldeeSage.has(`${p.journal}|${p.piece}|${p.date}`))
    .map((p) => ({ ...p }));
  const resolution = resoudreEcartFamille(clones, famE.ecart, famE.ranNonConsidere);
  for (const p of clones.filter((c) => !c.lettree).slice(0, 25)) {
    console.log(
      `  ${p.journal} ${p.piece} ${p.date} | net ${fmt(p.net)} | role ${p.role} | ${p.libelle.slice(0, 60)}`,
    );
  }
  console.log(
    `  → combinaison retenue: ${resolution.solutions[0]?.pieces.map((p) => `${p.journal} ${p.piece}`).join(" + ") ?? "AUCUNE"} (nb variantes: ${resolution.nbTotal}, échec: ${resolution.echec})`,
  );
  console.log("  variantes:");
  for (const v of resolution.variantes) {
    console.log(
      `    - ${v.pieces.map((p) => `${p.journal} ${p.piece} (${fmt(p.net)})`).join(" + ")}`,
    );
  }
}
