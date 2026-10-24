/**
 * Comparaison AVANT (comportement actuel : lettrage par montants opposés)
 * / APRÈS (règle lettrage Sage en tête) pour chaque famille réelle.
 * Détermine si la règle Sage régresse des attributions validées.
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

type L = EntryLine & { lettrage?: string };

function parseBrouillardLettrage(buffer: ArrayBuffer): L[] {
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
    .map((r): L => {
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
        ...(String(pick(r, "lettrage") ?? "").trim()
          ? { lettrage: String(pick(r, "lettrage") ?? "").trim() }
          : {}),
      } as L;
    })
    .filter((l) => l.compte);
}

const lignes = parseBrouillardLettrage(buf(BROU));

const groupes = new Map<string, L[]>();
for (const l of lignes) {
  if (!l.lettrage) continue;
  const k = `${l.compte}|${l.tiers}|${l.lettrage}`;
  const arr = groupes.get(k);
  if (arr) arr.push(l);
  else groupes.set(k, [l]);
}
const equilibres = new Map<string, boolean>();
for (const [k, ls] of groupes) {
  equilibres.set(k, Math.round(ls.reduce((t, l) => t + l.debit - l.credit, 0) * 100) === 0);
}

const TRc = (c: string) => c.startsWith("512") || c.startsWith("513");
function pieceSoldeeSage(group: L[]): boolean {
  let nb = 0;
  for (const l of group) {
    if (l.lettrage) {
      if (!equilibres.get(`${l.compte}|${l.tiers}|${l.lettrage}`)) return false;
      nb++;
    } else if (!TRc(l.compte)) return false;
  }
  return nb > 0;
}

const vwb = parseVerif(buf(VERIF));
const res = analyse(lignes, vwb.entites, vwb.balance);

const pieces = new Map<string, L[]>();
for (const l of lignes) {
  const k = `${l.journal}|${l.piece}|${l.date}`;
  const arr = pieces.get(k);
  if (arr) arr.push(l);
  else pieces.set(k, [l]);
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cle = (p: { journal: string; piece: string; date: string }) =>
  `${p.journal}|${p.piece}|${p.date}`;

console.log("=== COMPARAISON PAR FAMILLE (brouillard 20/10) ===\n");
for (const fam of res.familles.filter((f) => !f.soldee)) {
  const soldeeSage = new Set<string>();
  for (const p of fam.pieces) if (pieceSoldeeSage(pieces.get(cle(p))!)) soldeeSage.add(cle(p));

  const cur = fam.combinaisons[0];
  const curTxt = cur
    ? `${cur.pieces.map((p) => `${p.journal} ${p.piece} (${fmt(p.net)})${soldeeSage.has(cle(p)) ? " ⚠SAGE-SOLDÉE" : ""}`).join(" + ")} [${fam.nbVariantesCombinaison} variante(s)]`
    : fam.combinaisonEchec
      ? "échec honnête (résidu)"
      : "?";

  // Simulation APRÈS : soldées Sage d'abord, puis montants opposés
  const clones = fam.pieces.filter((p) => !soldeeSage.has(cle(p))).map((p) => ({ ...p }));
  const resolution = resoudreEcartFamille(clones, fam.ecart, fam.ranNonConsidere);
  const newTxt = resolution.solutions[0]
    ? `${resolution.solutions[0].pieces.map((p) => `${p.journal} ${p.piece} (${fmt(p.net)})`).join(" + ")} [${resolution.nbTotal} variante(s)]`
    : `échec honnête (${resolution.nbNonSoldees} non soldées)`;

  console.log(`■ ${fam.nom} — écart ${fmt(fam.ecart)}`);
  console.log(`   AVANT : ${curTxt}`);
  console.log(`   APRÈS : ${newTxt}`);
  console.log(`   pièces ${fam.pieces.length} | soldéesSage ${soldeeSage.size}\n`);
}
