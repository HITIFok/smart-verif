import * as XLSX from "xlsx";
import type { AnalysisResult, Anomaly, EntitySummary, EntryLine } from "./analysis-types";
import { detectTransfers } from "./transfers";
import { SHARED_BANK } from "./shared-bank";
import { matchPieceSchema } from "./schema-ecritures";
import { avecLibelle } from "./referentiel";

const AF = ["460", "461", "462", "467"];
const TR = ["512", "513"];
const TRANSFER = "580001";

export interface VerifEntity {
  nom: string;
  /** Suffixe principal : le plus fréquent parmi les comptes 46x du bloc. */
  suffixe: string;
  /** Tous les suffixes des comptes 46x listés dans le bloc. Certains blocs en
   *  regroupent plusieurs (ex. SANLAMALLIANZ COMPAGNIE = 103 + 100 + 501,
   *  ORANGE MADAGASCAR = 500 + la banque 512004). */
  suffixesAf: string[];
  /** Tous les comptes listés dans le bloc (46x + 512/513). */
  comptes: string[];
}

export interface BalanceRow {
  compte: string;
  nom: string;
  solde: number;
}

export interface VerifWorkbook {
  entites: VerifEntity[];
  /** Soldes de la feuille « Balance des comptes » du même classeur, si présente. */
  balance: BalanceRow[] | null;
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

/** Reads the "Vérification" workbook: entity blocks from the yearly sheet + balance sheet. */
export function parseVerif(buffer: ArrayBuffer): VerifWorkbook {
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
      current = { nom: c0, suffixe: "", suffixesAf: [], comptes: [] };
      entities.push(current);
      continue;
    }
    if (current && isAccount(c1) && family(c1)) {
      if (!current.comptes.includes(c1)) current.comptes.push(c1);
    }
  }

  for (const e of entities) {
    const af = e.comptes.filter((c) => family(c) === "AF");
    e.suffixesAf = [...new Set(af.map((c) => c.slice(3)))];
    const counts = new Map<string, number>();
    for (const c of af.length ? af : e.comptes) {
      counts.set(c.slice(3), (counts.get(c.slice(3)) ?? 0) + 1);
    }
    e.suffixe = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }

  // Dédoublonne les blocs qui reprennent le même périmètre (ex. FSS / DHL PRONET
  // partagent le suffixe 124) : le second bloc n'apporte que des comptes
  // supplémentaires éventuels (513124) et est fusionné dans le premier.
  const deduped: VerifEntity[] = [];
  const byKey = new Map<string, VerifEntity>();
  for (const e of entities) {
    if (!e.suffixe) continue;
    const prev = byKey.get(e.suffixe);
    if (prev) {
      for (const c of e.comptes) if (!prev.comptes.includes(c)) prev.comptes.push(c);
      continue;
    }
    byKey.set(e.suffixe, e);
    deduped.push(e);
  }

  return { entites: deduped, balance: parseBalance(wb) };
}

/** Reads the "Balance des comptes" sheet (same workbook) if present. */
export function parseBalance(wb: XLSX.WorkBook): BalanceRow[] | null {
  const sheet = wb.Sheets["Balance des comptes"];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const out: BalanceRow[] = [];
  for (const row of rows) {
    const code = str(row?.[0]).replace(/\.0$/, "");
    if (!isAccount(code)) continue;
    const p = code.slice(0, 3);
    if (!AF.includes(p) && !TR.includes(p)) continue;
    // Colonnes Sage : 14 = solde débit, 17 = solde crédit.
    out.push({
      compte: code,
      nom: str(row?.[2]),
      solde: num(row?.[14]) - num(row?.[17]),
    });
  }
  return out.length ? out : null;
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
      const rawDate = pick(r, "date");
      return {
        journal: str(pick(r, "code journal", "journal")),
        piece: str(pick(r, "pièce", "piece")).replace(/\.0$/, ""),
        date:
          rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : str(rawDate).slice(0, 10),
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

export function analyse(
  lignes: EntryLine[],
  verif: VerifEntity[],
  balance?: BalanceRow[] | null,
): AnalysisResult {
  // Account balances
  const soldes = new Map<string, number>();
  for (const l of lignes) {
    const f = family(l.compte);
    if (!f) continue;
    soldes.set(l.compte, (soldes.get(l.compte) ?? 0) + l.debit - l.credit);
  }
  const soldeOf = (c: string) => round2(soldes.get(c) ?? 0);

  const bankAccounts = new Set(
    [...soldes.keys()].filter((c) => c.startsWith("512") || c.startsWith("513")),
  );

  // Périmètre de chaque entité : les comptes 46x de ses suffixes de bloc, plus
  // les banques listées dans son bloc ou de même suffixe.
  interface Scope {
    e: VerifEntity;
    af: string[];
    trListed: string[];
    trBySuffix: string[];
    trCandidates: string[];
  }
  const scopes: Scope[] = verif.map((e) => {
    const af = [...soldes.keys()].filter(
      (c) => family(c) === "AF" && e.suffixesAf.includes(c.slice(3)),
    );
    const trListed = e.comptes.filter((c) => family(c) === "TR" && bankAccounts.has(c));
    const trBySuffix = [...bankAccounts].filter(
      (c) => !trListed.includes(c) && e.suffixesAf.includes(c.slice(3)),
    );
    return { e, af, trListed, trBySuffix, trCandidates: [...trListed, ...trBySuffix] };
  });

  // Suffixe -> nom d'entité (première entité gagne), pour les messages.
  const suffixToNom = new Map<string, string>();
  for (const s of scopes) {
    for (const suf of [s.e.suffixe, ...s.e.suffixesAf, ...s.e.comptes.map((c) => c.slice(3))]) {
      if (!suffixToNom.has(suf)) suffixToNom.set(suf, s.e.nom);
    }
  }
  const nomDe = (suf: string) => suffixToNom.get(suf) ?? `suffixe ${suf}`;

  // Propriétaire unique de chaque banque : 1re entité qui la liste dans son
  // bloc, sinon 1re entité dont un suffixe 46x correspond au suffixe de la
  // banque, sinon l'entité pointée par SHARED_BANK. La banque compte dans
  // l'écart de son propriétaire UNIQUEMENT (pas de double comptage quand
  // plusieurs entités partagent le même 512, ex. 512600).
  const ownerOf = new Map<string, VerifEntity>();
  for (const b of bankAccounts) {
    const owner =
      scopes.find((s) => s.trListed.includes(b)) ??
      scopes.find((s) => s.e.suffixesAf.includes(b.slice(3))) ??
      scopes.find((s) => SHARED_BANK.get(s.e.nom) === b.slice(3));
    if (owner) ownerOf.set(b, owner.e);
  }

  // Suffixes 46x légitimes en contrepartie de chaque compte 512 (propriétaire
  // + entités partageantes, listées ou via SHARED_BANK).
  const validAfByBank = new Map<string, Set<string>>();
  const addBankUser = (bank: string, e: VerifEntity) => {
    const set = validAfByBank.get(bank) ?? new Set<string>();
    for (const suf of e.suffixesAf) set.add(suf);
    validAfByBank.set(bank, set);
  };
  const bankOfShared = (nom: string): string | null => {
    const suf = SHARED_BANK.get(nom);
    if (!suf) return null;
    return bankAccounts.has(`512${suf}`)
      ? `512${suf}`
      : bankAccounts.has(`513${suf}`)
        ? `513${suf}`
        : null;
  };
  for (const s of scopes) {
    for (const b of s.trCandidates) addBankUser(b, s.e);
    const shared = bankOfShared(s.e.nom);
    if (shared && !s.trCandidates.includes(shared)) addBankUser(shared, s.e);
  }
  for (const b of bankAccounts) {
    if (!validAfByBank.has(b)) validAfByBank.set(b, new Set([b.slice(3)]));
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
    // Virements internes entre comptes de trésorerie (580001) : jamais une
    // anomalie client. Le journal RAN (à-nouveaux d'ouverture) n'est pas
    // actionnable non plus : il ne se corrige pas et ne casse pas le rapprochement.
    if (group.some((l) => l.compte === TRANSFER)) continue;
    if (journal === "RAN") continue;

    const tr = group.filter((l) => family(l.compte) === "TR");
    if (tr.length === 0) continue;
    const af = group.filter((l) => family(l.compte) === "AF");
    const trComptes = [...new Set(tr.map((l) => l.compte))];

    for (const c of trComptes) {
      const ent = ownerOf.get(c);
      if (!ent) continue;
      const trLines = tr.filter((l) => l.compte === c);
      const montantTr = round2(trLines.reduce((t, l) => t + l.debit - l.credit, 0));
      if (montantTr === 0 && af.length > 0) continue;

      const valid = validAfByBank.get(c) ?? new Set([c.slice(3)]);
      const afSameClient = af.filter((l) => valid.has(l.compte.slice(3)));
      const afOther = af.filter((l) => !valid.has(l.compte.slice(3)));
      const trOther = tr.filter((l) => l.compte !== c);

      if (afOther.length > 0 || trOther.length > 0) {
        const autres = [...new Set([...afOther, ...trOther].map((l) => l.compte))];
        const autresNoms = [...new Set(autres.map((l) => nomDe(l.slice(3))))];
        addAnomaly({
          type: "mauvais_client",
          entite: ent.nom,
          suffixe: ent.suffixe,
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
        // Paiement prestataire / client côté banque (schéma du cycle appel de
        // fonds : 401000 + compte tiers au Débit / 512 au Crédit) : écriture
        // normale du cycle, pas une anomalie.
        if (matchPieceSchema(group) === "paiement_banque") continue;
        const contreparties = [
          ...new Set(group.filter((l) => !family(l.compte)).map((l) => l.compte)),
        ];
        if (contreparties.length === 0 && montantTr === 0) continue;
        const has401 = contreparties.some((c) => c.startsWith("401"));
        addAnomaly({
          type: "hors_perimetre",
          entite: ent.nom,
          suffixe: ent.suffixe,
          journal,
          piece,
          date,
          libelle: trLines[0]?.libelle ?? first.libelle,
          comptes: [...new Set(group.map((l) => l.compte))].join(", "),
          montant: montantTr,
          detail:
            (contreparties.length
              ? `Contrepartie hors 460/461/462/467 : ${contreparties.map(avecLibelle).join(", ")}`
              : "Aucune contrepartie d'appel de fonds sur cette pièce") +
            (has401
              ? " — un paiement légitime s'écrit 401000 + compte tiers au Débit / 512 au Crédit"
              : ""),
          lignes: group,
        });
        continue;
      }

      const net = round2([...trLines, ...afSameClient].reduce((t, l) => t + l.debit - l.credit, 0));
      if (net !== 0) {
        addAnomaly({
          type: "hors_perimetre",
          entite: ent.nom,
          suffixe: ent.suffixe,
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

  // Entity summaries + forgotten / orphan accounts
  const entites: EntitySummary[] = [];
  const suffixesConnus = new Set<string>();
  for (const s of scopes) for (const suf of s.e.suffixesAf) suffixesConnus.add(suf);

  for (const s of scopes) {
    const e = s.e;
    const comptes: EntitySummary["comptes"] = [];
    for (const c of s.af) {
      comptes.push({
        compte: c,
        solde: soldeOf(c),
        listeVerif: e.comptes.includes(c),
        famille: "AF",
      });
    }
    for (const b of s.trCandidates) {
      const isOwner = ownerOf.get(b) === e;
      comptes.push({
        compte: b,
        solde: soldeOf(b),
        listeVerif: e.comptes.includes(b) || isOwner,
        famille: "TR",
        ...(isOwner ? {} : { partage: true }),
      });
    }
    // Banque partagée via SHARED_BANK : affichée à titre informatif.
    const sharedBank = bankOfShared(e.nom);
    if (sharedBank && !comptes.some((c) => c.compte === sharedBank)) {
      comptes.push({
        compte: sharedBank,
        solde: soldeOf(sharedBank),
        listeVerif: false,
        famille: "TR",
        partage: true,
      });
    }
    comptes.sort((a, b) => a.compte.localeCompare(b.compte));

    for (const c of comptes) {
      if (!c.listeVerif && !c.partage && c.solde !== 0) {
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

    const appelDeFonds = round2(s.af.reduce((t, c) => t + soldeOf(c), 0));
    const tresorerie = round2(
      s.trCandidates.filter((b) => ownerOf.get(b) === e).reduce((t, b) => t + soldeOf(b), 0),
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

  // Comptes 46x orphelins : aucun bloc ne contrôle leur suffixe.
  for (const c of [...soldes.keys()].sort()) {
    if (family(c) !== "AF" || suffixesConnus.has(c.slice(3))) continue;
    const solde = soldeOf(c);
    if (solde === 0) continue;
    addAnomaly({
      type: "compte_oublie",
      entite: "(hors vérification)",
      suffixe: "",
      journal: "",
      piece: "",
      date: "",
      libelle: `Compte ${c} absent de la feuille de vérification`,
      comptes: c,
      montant: solde,
      detail: `Le compte ${c} a un solde de ${solde.toLocaleString("fr-FR")} mais son suffixe ne figure dans le contrôle d'aucun client`,
      lignes: [],
    });
  }

  // Écart brouillard / balance des comptes : met en évidence les écritures
  // présentes dans la balance mais absentes du brouillard (ou inversément),
  // qui empêchent définitivement le soldage.
  if (balance?.length) {
    const bal = new Map(balance.map((b) => [b.compte, b]));
    const entityOf = (c: string): VerifEntity | null => {
      const listed = scopes.find((s) => s.e.comptes.includes(c));
      if (listed) return listed.e;
      if (family(c) === "AF") {
        return scopes.find((st) => st.e.suffixesAf.includes(c.slice(3)))?.e ?? null;
      }
      return ownerOf.get(c) ?? null;
    };
    for (const c of [...new Set([...soldes.keys(), ...bal.keys()])].sort()) {
      const sb = soldeOf(c);
      const sl = round2(bal.get(c)?.solde ?? 0);
      const diff = round2(sb - sl);
      if (Math.abs(diff) < 0.01) continue;
      const ent = entityOf(c);
      addAnomaly({
        type: "ecart_balance",
        entite: ent?.nom ?? "(hors vérification)",
        suffixe: ent?.suffixe ?? "",
        journal: "",
        piece: "",
        date: "",
        libelle: `Compte ${c}${bal.get(c)?.nom ? ` — ${bal.get(c)!.nom}` : ""}`,
        comptes: c,
        montant: diff,
        detail: `Solde brouillard ${sb.toLocaleString("fr-FR")} ≠ solde balance des comptes ${sl.toLocaleString("fr-FR")} : écriture(s) manquante(s) dans le brouillard ou passée(s) après son export`,
        lignes: [],
      });
    }
  }

  entites.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));
  anomalies.sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));

  const transferts = detectTransfers(lignes, suffixToNom);

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
        ecart_balance: anomalies.filter((a) => a.type === "ecart_balance").length,
      },
    },
  };
}
