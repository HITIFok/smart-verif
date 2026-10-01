import * as XLSX from "xlsx";
import type {
  AnalysisResult,
  Anomaly,
  EntitySummary,
  EntryLine,
} from "./analysis-types";
import { detectTransfers } from "./transfers";

const AF = ["460", "461", "462", "467"];
const TR = ["512", "513"];

export interface VerifEntity {
  nom: string;
  suffixe: string;
  comptes: string[];
}

const num = (v: unknown): number => {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
  }
  return 0;
};

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

const isAccount = (v: unknown) => /^\d{6}$/.test(str(v).replace(/\.0$/, ""));

const family = (compte: string): "AF" | "TR" | null => {
  const p = compte.slice(0, 3);
  if (AF.includes(p)) return "AF";
  if (TR.includes(p)) return "TR";
  return null;
};

/** Reads the "Vérification" workbook and extracts the entity -> accounts mapping. */
export function parseVerif(buffer: ArrayBuffer): VerifEntity[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /^\d{4}$/.test(n.trim())) ?? wb.SheetNames[0] ?? "";
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    raw: true,
    blankrows: true,
  });

  const entities: VerifEntity[] = [];
  let current: VerifEntity | null = null;

  for (const row of rows) {
    const c0 = str(row?.[0]);
    const c1 = str(row?.[1]).replace(/\.0$/, "");
    // A row that also carries an account code (e.g. stray "AOUT" on the 467130
    // line of PAMF) is an account row with a stray label, NOT a new entity.
    if (c0 && !isAccount(c0) && !(isAccount(c1) && family(c1))) {
      current = { nom: c0, suffixe: "", comptes: [] };
      entities.push(current);
      continue;
    }
    if (current && isAccount(c1) && family(c1)) {
      if (!current.comptes.includes(c1)) current.comptes.push(c1);
    }
  }

  for (const e of entities) {
    const counts = new Map<string, number>();
    for (const c of e.comptes) {
      const s = c.slice(3);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    e.suffixe = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }

  return entities.filter((e) => e.suffixe);
}

/** Reads the "Brouillard" workbook into normalized entry lines. */
export function parseBrouillard(buffer: ArrayBuffer): EntryLine[] {
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

  return rows
    .map((r): EntryLine => {
      const d = pick(r, "date écheance") ? null : null;
      void d;
      const rawDate = pick(r, "date");
      return {
        journal: str(pick(r, "code journal", "journal")),
        piece: str(pick(r, "pièce", "piece")).replace(/\.0$/, ""),
        date:
          rawDate instanceof Date
            ? rawDate.toISOString().slice(0, 10)
            : str(rawDate).slice(0, 10),
        compte: str(pick(r, "compte général", "compte general")).replace(/\.0$/, ""),
        tiers: str(pick(r, "compte tiers")),
        libelle: str(pick(r, "libellé", "libelle")),
        debit: num(pick(r, "débit", "debit")),
        credit: num(pick(r, "crédit", "credit")),
      };
    })
    .filter((l) => l.compte);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyse(lignes: EntryLine[], verif: VerifEntity[]): AnalysisResult {
  const bySuffix = new Map<string, VerifEntity>();
  for (const e of verif) if (!bySuffix.has(e.suffixe)) bySuffix.set(e.suffixe, e);

  // Account balances
  const soldes = new Map<string, number>();
  for (const l of lignes) {
    const f = family(l.compte);
    if (!f) continue;
    soldes.set(l.compte, (soldes.get(l.compte) ?? 0) + l.debit - l.credit);
  }

  // Group lines by piece
  const pieces = new Map<string, EntryLine[]>();
  for (const l of lignes) {
    const k = `${l.journal}|${l.piece}|${l.date}`;
    const arr = pieces.get(k);
    if (arr) arr.push(l);
    else pieces.set(k, [l]);
  }

  const anomalies: Anomaly[] = [];
  let seq = 0;
  const addAnomaly = (a: Omit<Anomaly, "id">) => {
    anomalies.push({ ...a, id: `A${++seq}` });
  };

  for (const [key, group] of pieces) {
    const parts = key.split("|");
    const journal = parts[0] ?? "";
    const piece = parts[1] ?? "";
    const date = parts[2] ?? "";
    const first = group[0];
    if (!first) continue;
    const tr = group.filter((l) => family(l.compte) === "TR");
    if (tr.length === 0) continue;

    const af = group.filter((l) => family(l.compte) === "AF");
    const trSuffixes = [...new Set(tr.map((l) => l.compte.slice(3)))];

    for (const s of trSuffixes) {
      const ent = bySuffix.get(s);
      if (!ent) continue;
      const trLines = tr.filter((l) => l.compte.slice(3) === s);
      const montantTr = round2(trLines.reduce((t, l) => t + l.debit - l.credit, 0));
      if (montantTr === 0 && af.length > 0) continue;

      const afSameClient = af.filter((l) => l.compte.slice(3) === s);
      const afOther = af.filter((l) => l.compte.slice(3) !== s);
      const trOther = tr.filter((l) => l.compte.slice(3) !== s);

      if (afOther.length > 0 || trOther.length > 0) {
        const autres = [...new Set([...afOther, ...trOther].map((l) => l.compte))];
        const autresNoms = [
          ...new Set(
            autres.map((c) => bySuffix.get(c.slice(3))?.nom ?? `suffixe ${c.slice(3)}`),
          ),
        ];
        addAnomaly({
          type: "mauvais_client",
          entite: ent.nom,
          suffixe: s,
          journal,
          piece,
          date,
          libelle: trLines[0]?.libelle ?? first.libelle,
          comptes: [...new Set(group.map((l) => l.compte))].join(", "),
          montant: montantTr,
          detail: `Mouvement de trésorerie ${ent.nom} soldé sur les comptes de : ${autresNoms.join(", ")}`,
          lignes: group,
        });
        continue;
      }

      if (afSameClient.length === 0) {
        const contreparties = [
          ...new Set(group.filter((l) => !family(l.compte)).map((l) => l.compte)),
        ];
        if (contreparties.length === 0 && montantTr === 0) continue;
        addAnomaly({
          type: "hors_perimetre",
          entite: ent.nom,
          suffixe: s,
          journal,
          piece,
          date,
          libelle: trLines[0]?.libelle ?? first.libelle,
          comptes: [...new Set(group.map((l) => l.compte))].join(", "),
          montant: montantTr,
          detail: contreparties.length
            ? `Contrepartie hors 460/461/462/467 : ${contreparties.join(", ")}`
            : "Aucune contrepartie d'appel de fonds sur cette pièce",
          lignes: group,
        });
        continue;
      }

      const net = round2(
        [...trLines, ...afSameClient].reduce((t, l) => t + l.debit - l.credit, 0),
      );
      if (net !== 0) {
        addAnomaly({
          type: "hors_perimetre",
          entite: ent.nom,
          suffixe: s,
          journal,
          piece,
          date,
          libelle: trLines[0]?.libelle ?? first.libelle,
          comptes: [...new Set(group.map((l) => l.compte))].join(", "),
          montant: net,
          detail: `Écart de ${net.toLocaleString("fr-FR")} entre la trésorerie et l'appel de fonds sur la pièce`,
          lignes: group,
        });
      }
    }
  }

  // Entity summaries + forgotten accounts
  const entites: EntitySummary[] = [];
  for (const e of verif) {
    const comptes = [...soldes.entries()]
      .filter(([c]) => c.slice(3) === e.suffixe && family(c))
      .map(([compte, solde]) => ({
        compte,
        solde: round2(solde),
        listeVerif: e.comptes.includes(compte),
        famille: family(compte) as "AF" | "TR",
      }))
      .sort((a, b) => a.compte.localeCompare(b.compte));

    for (const c of comptes) {
      if (!c.listeVerif && c.solde !== 0) {
        addAnomaly({
          type: "compte_oublie",
          entite: e.nom,
          suffixe: e.suffixe,
          journal: "",
          piece: "",
          date: "",
          libelle: `Compte ${c.compte} absent de la feuille de vérification`,
          comptes: c.compte,
          montant: c.solde,
          detail: `Le compte ${c.compte} a un solde de ${c.solde.toLocaleString("fr-FR")} mais n'est pas repris dans le contrôle de ${e.nom}`,
          lignes: [],
        });
      }
    }

    const appelDeFonds = round2(
      comptes.filter((c) => c.famille === "AF").reduce((t, c) => t + c.solde, 0),
    );
    const tresorerie = round2(
      comptes.filter((c) => c.famille === "TR").reduce((t, c) => t + c.solde, 0),
    );
    const own = anomalies.filter((a) => a.suffixe === e.suffixe);

    entites.push({
      nom: e.nom,
      suffixe: e.suffixe,
      appelDeFonds,
      tresorerie,
      ecart: round2(appelDeFonds + tresorerie),
      anomalies: own.length,
      montantAnomalies: round2(own.reduce((t, a) => t + Math.abs(a.montant), 0)),
      comptes,
    });
  }

  entites.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));
  anomalies.sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));

  const transferts = detectTransfers(
    lignes,
    new Map(verif.map((e) => [e.suffixe, e.nom])),
  );

  return {
    entites,
    anomalies,
    transferts,
    stats: {
      lignes: lignes.length,
      pieces: pieces.size,
      entites: entites.length,
      soldees: entites.filter((e) => Math.abs(e.ecart) < 0.01).length,
      ecartTotal: round2(entites.reduce((t, e) => t + Math.abs(e.ecart), 0)),
      parType: {
        mauvais_client: anomalies.filter((a) => a.type === "mauvais_client").length,
        hors_perimetre: anomalies.filter((a) => a.type === "hors_perimetre").length,
        compte_oublie: anomalies.filter((a) => a.type === "compte_oublie").length,
      },
    },
  };
}
