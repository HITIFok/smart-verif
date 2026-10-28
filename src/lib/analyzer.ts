import * as XLSX from "xlsx";
import type {
  AnalysisResult,
  Anomaly,
  EntitySummary,
  EntryLine,
  FamilleVerif,
  PieceEcart,
  PieceEcartRole,
  RanTiersPiece,
} from "./analysis-types";
import { detectTransfers } from "./transfers";
import { resoudreEcartFamille } from "./ecarts";
import { BANQUE_PROPRIETAIRE, SHARED_BANK } from "./shared-bank";
import { BANQUE_PAR_COMPTE, BANQUES_PAR_SOCIETE } from "./banques-societes";
import { matchPieceSchema } from "./schema-ecritures";
import { avecLibelle } from "./referentiel";
import {
  banquesDuSuffixeFactory,
  rapprocher,
  tracerOuvertures,
  FENETRE_JOURS,
  FENETRE_N1_JOURS,
} from "./rapprochement";
import { construireValidation, parseEcartsReference, type EcartReference } from "./validation";
import {
  normaliseCompte,
  normaliseDate,
  normaliseJournal,
  normaliseReference,
} from "./normalisation";

const AF = ["460", "461", "462", "467"];
const TR = ["512", "513"];
const TRANSFER = "580001";
/** Règle du comptable : parmi les pièces du journal RAN (à-nouveaux), seules
 *  celles portant sur un compte de tiers réel (401000, 460, 411) sont à
 *  considérer comme écritures à corriger dans Sage. Les RAN sur les comptes
 *  d'attente 462/467 (reclassements d'ouverture), sur les banques 512/513
 *  (soldes d'ouverture) ou sur des comptes divers ne sont pas considérés. */
const RAN_CONSIDERES = ["401000", "460", "411"];
const ranConsidere = (group: EntryLine[]): boolean =>
  group.some((l) => RAN_CONSIDERES.some((p) => l.compte.startsWith(p)));

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
  /** Écarts de référence de la feuille annuelle « 2026 » du classeur de
   *  vérification (les feuilles Feuil1/Feuil2 masquées n'en portent pas) :
   *  lignes Vérification principale (entité) et latérale (famille). */
  ecartsReference: EcartReference[];
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

  const nCols = rows.reduce((t, r) => Math.max(t, r?.length ?? 0), 0);
  return {
    entites: deduped,
    balance: parseBalance(wb),
    ecartsReference: parseEcartsReference(rows, nCols),
  };
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

/**
 * Lit le « Brouillard » et le normalise. Robuste aux lignes de titre, aux
 * lignes vides et aux noms de colonnes variables : la ligne d'en-tête est
 * repérée par son contenu (Code journal + compte général + Débit/Crédit) et
 * aucune ligne sans compte à 6 chiffres n'est convertie en écriture. Chaque
 * écriture garde son n° de ligne Excel (1 = en-tête) pour la traçabilité.
 * `meta` étiquette chaque écriture avec l'exercice d'origine et le nom du
 * fichier source (import interexercices : N et N-1 restent distingués).
 */
export function parseBrouillard(
  buffer: ArrayBuffer,
  meta?: { exercice?: string; fichier?: string },
): EntryLine[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
  });

  const num = (v: unknown): number => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/\s/g, "").replace(",", "."));
      return isFinite(n) ? n : 0;
    }
    return 0;
  };

  // Repérage de l'en-tête (au plus 50 premières lignes).
  interface ColonnesBrouillard {
    journal?: number;
    date?: number;
    piece?: number;
    facture?: number;
    reference?: number;
    compte?: number;
    tiers?: number;
    libelle?: number;
    lettrage?: number;
    debit?: number;
    credit?: number;
  }
  let headerIdx = -1;
  let cols: ColonnesBrouillard = {};
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    const c: ColonnesBrouillard = {};
    r.forEach((cell, j) => {
      const n = String(cell ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
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
    if (
      c.journal !== undefined &&
      c.compte !== undefined &&
      (c.debit !== undefined || c.credit !== undefined)
    ) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  // En-tête introuvable : aucune écriture inventée (une erreur de lecture
  // ne devient jamais une absence d'écriture — l'appelant affiche 0 ligne).
  if (headerIdx === -1) return [];

  const cell = (r: unknown[] | undefined, j?: number): unknown =>
    j === undefined || !r ? "" : (r[j] ?? "");

  const out: EntryLine[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const compte = normaliseCompte(cell(r, cols.compte));
    if (!/^\d{6}$/.test(compte)) continue; // lignes vides, titres, totaux
    const l: EntryLine = {
      journal: normaliseJournal(cell(r, cols.journal)),
      piece: normaliseReference(cell(r, cols.piece)).replace(/\.0$/, ""),
      date: normaliseDate(cell(r, cols.date)),
      compte,
      tiers: String(cell(r, cols.tiers) ?? "")
        .trim()
        .replace(/\.0$/, ""),
      libelle: String(cell(r, cols.libelle) ?? "").trim(),
      debit: num(cell(r, cols.debit)),
      credit: num(cell(r, cols.credit)),
      ligne: i + 1, // n° de ligne Excel (1 = en-tête) — traçabilité
      ...(meta?.exercice ? { exercice: meta.exercice } : {}),
      ...(meta?.fichier ? { fichier: meta.fichier } : {}),
    };
    const lettrage = String(cell(r, cols.lettrage) ?? "").trim();
    if (lettrage && lettrage !== "*") l.lettrage = lettrage;
    const facture = String(cell(r, cols.facture) ?? "").trim();
    if (facture && facture !== "*") l.facture = facture.replace(/\.0$/, "");
    const reference = String(cell(r, cols.reference) ?? "").trim();
    if (reference && reference !== "*" && reference !== "-") l.reference = reference;
    out.push(l);
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lettrage SAGE réel (colonne « Lettrage montant » du brouillard) : les lignes
 * partageant le même (compte général, compte tiers, code) forment un groupe de
 * lettrage ; un groupe dont la somme Débit − Crédit est nulle prouve que
 * l'opération est soldée dans Sage. Renvoie la map groupe → équilibré ?
 * (vide si le brouillard ne porte aucun code de lettrage).
 */
function groupesLettrageSage(lignes: EntryLine[]): Map<string, boolean> {
  const groupes = new Map<string, EntryLine[]>();
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
  return equilibres;
}

/** Pièce soldée par le lettrage SAGE : au moins une ligne lettrée, toutes les
 *  lignes lettrées dans des groupes équilibrés, et toutes les lignes sans
 *  code bancaires (512/513 — le volet trésorerie d'un règlement n'est jamais
 *  lettré). C'est la preuve comptable que la pièce est régularisée : elle ne
 *  doit jamais être désignée comme écriture à corriger. */
function pieceSoldeeSage(group: EntryLine[], equilibres: Map<string, boolean>): boolean {
  let nbLettrées = 0;
  for (const l of group) {
    if (l.lettrage) {
      if (!equilibres.get(`${l.compte}|${l.tiers}|${l.lettrage}`)) return false;
      nbLettrées++;
    } else if (!l.compte.startsWith("512") && !l.compte.startsWith("513")) {
      return false;
    }
  }
  return nbLettrées > 0;
}

export function analyse(
  lignes: EntryLine[],
  verif: VerifEntity[],
  balance?: BalanceRow[] | null,
  ecartsReference: EcartReference[] = [],
  lignesN1?: EntryLine[],
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
    // Rattachement explicite (ex. 512600 -> EVIOSYS, cf. formule du comptable
    // dans la feuille « 2026 » du Verif BG) : prime sur l'ordre des blocs.
    const forcé = BANQUE_PROPRIETAIRE.get(b);
    if (forcé) {
      const scope = scopes.find((s) => s.e.nom === forcé);
      if (scope) {
        ownerOf.set(b, scope.e);
        continue;
      }
    }
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
        // fonds : 401000 + compte tiers au Débit / 512 au Crédit), annulation
        // de paiement (512 au Débit / 401000 + compte tiers au Crédit) et
        // frais bancaires à la charge de MCI CARE (627 + TVA 445600 au Débit /
        // 512 au Crédit, ou la régulation inverse) : écritures normales, pas
        // des anomalies.
        const role = matchPieceSchema(group);
        if (
          role === "paiement_banque" ||
          role === "annulation_paiement" ||
          role === "frais_bancaires"
        )
          continue;
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
              ? " — un paiement légitime s'écrit 401000 + compte tiers au Débit / 512 au Crédit, une annulation de paiement 512 au Débit / 401000 + compte tiers au Crédit"
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

  // Familles : les clients sans banque propre (SHARED_BANK) sont soldés avec la
  // banque de leur parent. C'est le niveau où le comptable conclut dans les
  // notes de la feuille « 2026 » (ex. FSS+MGS = 0, NACRE+DIR+RAHARIVOLA+KIDS = 0,
  // SANIFER+HOSP+COVID+TAMBOHO+STMB = 2 006,00). Une entité qui pointe vers sa
  // propre banque (ex. BOOST -> 320) n'est pas un enfant.
  const byNomEntite = new Map(entites.map((e) => [e.nom, e]));
  const famillesMap = new Map<string, { parent: EntitySummary; enfants: EntitySummary[] }>();
  for (const e of entites) {
    const suf = SHARED_BANK.get(e.nom);
    if (!suf) continue;
    const bank = bankAccounts.has(`512${suf}`)
      ? `512${suf}`
      : bankAccounts.has(`513${suf}`)
        ? `513${suf}`
        : null;
    if (!bank) continue;
    const parent = ownerOf.get(bank);
    if (!parent || parent.nom === e.nom) continue;
    const entry = famillesMap.get(parent.nom) ?? {
      parent: byNomEntite.get(parent.nom)!,
      enfants: [],
    };
    if (!entry.enfants.some((x) => x.nom === e.nom)) entry.enfants.push(e);
    famillesMap.set(parent.nom, entry);
  }
  const familles: FamilleVerif[] = [];
  const ranTiers: RanTiersPiece[] = [];
  for (const { parent, enfants } of famillesMap.values()) {
    const membres = [parent, ...enfants];
    const appel = round2(membres.reduce((t, m) => t + m.appelDeFonds, 0));
    const treso = round2(membres.reduce((t, m) => t + m.tresorerie, 0));
    const ecartFamille = round2(appel + treso);
    familles.push({
      nom: parent.nom,
      membres: membres.map((m) => m.nom),
      appelDeFonds: appel,
      tresorerie: treso,
      ecart: ecartFamille,
      soldee: Math.abs(ecartFamille) < 0.01,
      pieces: [],
      ranNonConsidere: 0,
      nbRanNonConsidere: 0,
      combinaisons: [],
      nbVariantesCombinaison: 0,
      combinaisonEchec: false,
    });
    parent.enfants = membres.map((m) => m.nom);
    for (const enfant of enfants) {
      enfant.famille = parent.nom;
    }
  }
  familles.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));

  // Écarts de famille réels (familles non soldées) : les pièces du brouillard
  // qui les composent. C'est la vérification demandée par le comptable — la
  // somme des mouvements nets de ces pièces sur le périmètre de la famille
  // redonne exactement l'écart de la feuille de vérification. Quand UNE seule
  // décomposition exacte existe, ce sont les écritures fautives ; quand
  // PLUSIEURS décompositions coexistent (variantes alternatives), l'attribution
  // est ambiguë : les pièces citées ne sont que des candidats à rapprocher
  // dans Sage, pas des écritures prouvées erronées.
  // Lettrage SAGE réel : groupes (compte, tiers, code) équilibrés, puis
  // statut « soldée Sage » par pièce (une seule fois pour tout le brouillard).
  // Utilisé par la détection des familles ET par les règles A/B/C du
  // rapprochement explicable.
  const equilibresSage = groupesLettrageSage(lignes);
  const soldeeSagePiece = new Map<string, boolean>();
  if (equilibresSage.size) {
    for (const [key, group] of pieces) {
      if (pieceSoldeeSage(group, equilibresSage)) soldeeSagePiece.set(key, true);
    }
  }

  const famillesReelles = familles.filter((f) => !f.soldee);
  if (famillesReelles.length) {
    const cleAnomalies = new Set(
      anomalies.filter((a) => a.journal || a.piece).map((a) => `${a.journal}|${a.piece}|${a.date}`),
    );
    const scopesFamilles = famillesReelles.map((f) => ({
      f,
      scope: new Set(
        f.membres.flatMap((m) => {
          const e = byNomEntite.get(m);
          if (!e) return [];
          return e.comptes
            .filter((c) => c.famille === "AF" || (c.famille === "TR" && !c.partage))
            .map((c) => c.compte);
        }),
      ),
      acc: new Map<
        string,
        { net: number; libelle: string; comptes: Set<string>; tous: Set<string> }
      >(),
      ranNonConsidere: 0,
      nbRanNonConsidere: 0,
    }));

    const roleDe = (journal: string, group: EntryLine[]): PieceEcartRole => {
      if (journal === "RAN") return "a_nouveaux";
      if (group.some((l) => l.compte === TRANSFER)) return "compte_a_compte";
      return matchPieceSchema(group) ?? "autre";
    };

    for (const [key, group] of pieces) {
      const estRan = (key.split("|")[0] ?? "") === "RAN";
      // Règle du comptable, appliquée au niveau des MOUVEMENTS : dans une
      // pièce RAN, seuls les mouvements portant sur 401000, 460 ou 411
      // (comptes de tiers réels) sont considérés — les mouvements RAN sur les
      // comptes d'attente 462/467, sur les banques 512/513 ou sur 461 ne sont
      // pas des écritures à corriger dans Sage. (Dans le périmètre famille
      // 46x + 512/513, seul 460 est donc « considéré » pour un RAN.)
      for (const sf of scopesFamilles) {
        let netScope = 0;
        let netConsidere = 0;
        const comptes = new Set<string>();
        for (const l of group) {
          if (!sf.scope.has(l.compte)) continue;
          netScope += l.debit - l.credit;
          if (estRan && !RAN_CONSIDERES.some((p) => l.compte.startsWith(p))) continue;
          netConsidere += l.debit - l.credit;
          comptes.add(l.compte);
        }
        const netScopeR = round2(netScope);
        if (netScopeR === 0) continue;
        if (estRan) {
          const netConsidereR = round2(netConsidere);
          if (netConsidereR === 0) {
            // RAN non considéré (462/467, 512/513, 461) : comptabilisé à part
            // pour le rapprochement Σ pièces à corriger + RAN non considérés
            // = écart feuille.
            sf.ranNonConsidere = round2(sf.ranNonConsidere + netScopeR);
            sf.nbRanNonConsidere++;
            continue;
          }
          const reste = round2(netScopeR - netConsidereR);
          if (reste !== 0) {
            // Pièce partiellement considérée (ex. 460 + 467) : la partie RAN
            // 462/467/512/513 reste comptée dans les non considérés.
            sf.ranNonConsidere = round2(sf.ranNonConsidere + reste);
            sf.nbRanNonConsidere++;
          }
          sf.acc.set(key, {
            net: netConsidereR,
            libelle: group.find((l) => l.libelle)?.libelle ?? "",
            comptes,
            tous: new Set(group.map((l) => l.compte)),
          });
          continue;
        }
        sf.acc.set(key, {
          net: netScopeR,
          libelle: group.find((l) => l.libelle)?.libelle ?? "",
          comptes,
          tous: new Set(group.map((l) => l.compte)),
        });
      }
    }

    // Assemblage + référencement croisé (une même pièce peut faire l'écart de
    // deux familles : mauvais client entre familles réelles).
    const famillesParPiece = new Map<string, string[]>();
    for (const sf of scopesFamilles) {
      for (const key of sf.acc.keys()) {
        const arr = famillesParPiece.get(key);
        if (arr) arr.push(sf.f.nom);
        else famillesParPiece.set(key, [sf.f.nom]);
      }
    }
    for (const sf of scopesFamilles) {
      const list: PieceEcart[] = [];
      for (const [key, v] of sf.acc) {
        const parts = key.split("|");
        const group = pieces.get(key)!;
        list.push({
          journal: parts[0] ?? "",
          piece: parts[1] ?? "",
          date: parts[2] ?? "",
          libelle: v.libelle,
          comptes: [...v.comptes].sort().join(", "),
          comptesTous: [...v.tous].sort().join(", "),
          net: v.net,
          role: roleDe(parts[0] ?? "", group),
          anomalie: cleAnomalies.has(key),
          ...(soldeeSagePiece.has(key) ? { lettreeSage: true } : {}),
          ...(famillesParPiece.get(key)!.length > 1
            ? {
                aussiDans: famillesParPiece.get(key)!.filter((n) => n !== sf.f.nom),
              }
            : {}),
        });
      }
      list.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      sf.f.pieces = list;
      sf.f.ranNonConsidere = sf.ranNonConsidere;
      sf.f.nbRanNonConsidere = sf.nbRanNonConsidere;

      // Détection EXACTE des écritures erronées (feuille 2 du Verif BG),
      // méthode du comptable : lettrage par montants exactement opposés
      // (les pièces soldées se compensent et ne sont jamais candidates),
      // puis plus petite combinaison (1 à 4 écritures) parmi les NON soldées
      // dont la somme redonne exactement l'écart — un écart peut être composé
      // de PLUSIEURS écritures erronées (ex. 90 000 = 48 000 + 2 000 + 40 000).
      // Au plus UNE solution retenue (les variantes « exactes » sont
      // alternatives : les marquer toutes erronées serait faux) ; sans
      // combinaison, l'écart est déclaré résidu des écritures non soldées.
      const resolution = resoudreEcartFamille(list, sf.f.ecart, sf.ranNonConsidere);
      sf.f.combinaisons = resolution.solutions;
      sf.f.nbVariantesCombinaison = resolution.nbTotal;
      // Variantes distinctes (la retenue d'abord) : la matière du rapprochement
      // honnête dans Sage quand plusieurs décompositions tombent juste.
      sf.f.variantes = resolution.variantes;
      sf.f.combinaisonEchec = resolution.echec;
      // (la solution retenue marque ses pièces dansCombinaison, le lettrage
      // marque les pièces soldées lettree — dans les deux cas sur la liste)
      // Tri « comme un comptable » : les écritures non soldées (contributeurs
      // de l'écart, à examiner) d'abord, puis les soldées par lettrage SAGE
      // (preuve la plus forte), puis les soldées par compensation (opposé
      // exact) — |net| décroissant dans chaque groupe.
      const rangSolde = (p: PieceEcart) => (p.lettreeSage ? 1 : p.lettree ? 2 : 0);
      list.sort((a, b) => rangSolde(a) - rangSolde(b) || Math.abs(b.net) - Math.abs(a.net));
    }

    // À-nouveaux de tiers hors familles : pièces RAN portant sur 401000, 460
    // ou 411 (comptes de tiers réels à considérer) sans être listée dans
    // aucune famille réelle — c'est-à-dire sans mouvement « considéré » sur
    // un périmètre famille. Ce sont ces RAN-là que le comptable veut voir,
    // par opposition aux milliers de RAN 462/467 (comptes d'attente).
    const scopesToutes = new Set<string>(scopesFamilles.flatMap((sf) => [...sf.scope]));
    for (const [key, group] of pieces) {
      if ((key.split("|")[0] ?? "") !== "RAN") continue;
      if (!ranConsidere(group)) continue;
      // Mouvements considérés (401000/460/411) sur les périmètres des
      // familles réelles : si ≠ 0, la pièce est déjà listée dans la famille.
      const netConsidereScopes = round2(
        group.reduce(
          (t, l) =>
            scopesToutes.has(l.compte) && RAN_CONSIDERES.some((p) => l.compte.startsWith(p))
              ? t + l.debit - l.credit
              : t,
          0,
        ),
      );
      if (netConsidereScopes !== 0) continue;
      const parts = key.split("|");
      const comptesTiers = [
        ...new Set(
          group.map((l) => l.compte).filter((c) => RAN_CONSIDERES.some((p) => c.startsWith(p))),
        ),
      ];
      ranTiers.push({
        journal: parts[0] ?? "",
        piece: parts[1] ?? "",
        date: parts[2] ?? "",
        libelle: group.find((l) => l.libelle)?.libelle ?? "",
        comptesTiers: comptesTiers.join(", "),
        comptesTous: [...new Set(group.map((l) => l.compte))].sort().join(", "),
        net: round2(
          group
            .filter((l) => comptesTiers.includes(l.compte))
            .reduce((t, l) => t + l.debit - l.credit, 0),
        ),
      });
    }
    ranTiers.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  const transferts = detectTransfers(lignes, suffixToNom);

  // -------------------------------------------------------------------
  // RAPPROCHEMENT EXPLICABLE — règles A (411/401/467), B (460/462) et
  // C (627) : fiches attendu/rapproché/restant avec statuts opposables,
  // preuves et références de lignes du brouillard (docs/spec-rapprochement.md).
  // -------------------------------------------------------------------
  const mciCountsR = new Map<string, number>();
  for (const l of lignes)
    if (/^(BOA|BNI).*MCI$/.test(l.journal) && l.compte.startsWith("512"))
      mciCountsR.set(l.compte, (mciCountsR.get(l.compte) ?? 0) + 1);
  const mciBankR = [...mciCountsR.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Banques vues dans N OU dans N-1 : une banque MCI comptabilisée uniquement
  // dans N-1 doit rester une destination de recherche pour l'apurement des
  // résidus N-1 (anti double comptage), sans élargir les contrôles de N.
  const bankAccountsN1R = new Set<string>();
  for (const l of lignesN1 ?? []) if (/^51[23]/.test(l.compte)) bankAccountsN1R.add(l.compte);
  const bankAccountsR = new Set([...bankAccounts, ...bankAccountsN1R]);
  const mciBanksR = new Set<string>(
    [...(BANQUES_PAR_SOCIETE.get("MCI CARE") ?? []), mciBankR].filter(
      (b): b is string => b !== null && bankAccountsR.has(b),
    ),
  );
  const banqueSocieteR = new Map<string, string>();
  for (const [compte, f] of BANQUE_PAR_COMPTE)
    if (bankAccounts.has(compte)) banqueSocieteR.set(compte, f.societe);
  for (const [compte, owner] of ownerOf)
    if (!banqueSocieteR.has(compte)) banqueSocieteR.set(compte, owner.nom);
  const banqueEntiteR = new Map<string, string>();
  for (const [compte, owner] of ownerOf) banqueEntiteR.set(compte, owner.nom);

  // -------------------------------------------------------------------
  // BROUILLARD N-1 (facultatif) : pièces indexées à part (clé préfixée
  // « N1| » — aucune confusion possible entre exercices), lettrage Sage de
  // N-1 calculé séparément, traçage des à-nouveaux d'ouverture partagé.
  // Les soldes, familles et anomalies restent calculés sur le SEUL N.
  // -------------------------------------------------------------------
  // Comptes utiles aux recherches interexercices (règles A/B/C, ouverture,
  // doublons) : familles AF/TR, comptes de tiers 401/411, frais 627+TVA et
  // trésorerie de transfert 580001. Le volume N-1 reste borné au périmètre
  // réel des règles — les autres comptes ne rapprochent jamais rien.
  const n1Filtrees = (lignesN1 ?? []).filter(
    (l) =>
      family(l.compte) !== null ||
      l.compte === "580001" ||
      l.compte.startsWith("401") ||
      l.compte.startsWith("411") ||
      l.compte.startsWith("627") ||
      l.compte === "445600",
  );
  const piecesN1 = new Map<string, EntryLine[]>();
  for (const l of n1Filtrees) {
    const key = `N1|${l.journal}|${l.piece}|${l.date}`;
    const arr = piecesN1.get(key);
    if (arr) arr.push(l);
    else piecesN1.set(key, [l]);
  }
  const equilibresN1 = groupesLettrageSage(n1Filtrees);
  const soldeeSageN1 = (key: string) => {
    const group = piecesN1.get(key);
    if (!group) return false;
    return pieceSoldeeSage(group, equilibresN1);
  };
  const ouverturesN1 = piecesN1.size ? tracerOuvertures(pieces, piecesN1) : null;
  const datesN1 = n1Filtrees
    .map((l) => l.date)
    .filter(Boolean)
    .sort();
  const infoN1 = piecesN1.size
    ? {
        fichier: n1Filtrees.find((l) => l.fichier)?.fichier ?? "",
        exercice: n1Filtrees.find((l) => l.exercice)?.exercice ?? "",
        lignes: n1Filtrees.length,
        pieces: piecesN1.size,
        du: datesN1[0] ?? "",
        au: datesN1[datesN1.length - 1] ?? "",
        ranTraces: ouverturesN1?.nbTraces ?? 0,
        ranAmbigus: ouverturesN1?.nbAmbigus ?? 0,
        ranNonTraces: ouverturesN1?.nbNonTraces ?? 0,
        nbDoublonsInterExercices: 0, // renseigné après rapprocher()
      }
    : null;

  const rapprochements = rapprocher({
    lignes,
    pieces,
    piecesN1: piecesN1.size ? piecesN1 : undefined,
    soldeeSageN1,
    fenetreN1Jours: FENETRE_N1_JOURS,
    ouvertures: ouverturesN1 ?? undefined,
    validAfByBank,
    banqueSociete: banqueSocieteR,
    banqueEntite: banqueEntiteR,
    banquesDuSuffixe: banquesDuSuffixeFactory(bankAccounts, nomDe),
    mciBanks: mciBanksR,
    soldeeSage: (key) => soldeeSagePiece.get(key) ?? false,
    nomDeSuffixe: nomDe,
    fenetreJours: FENETRE_JOURS,
  });
  if (infoN1) {
    infoN1.nbDoublonsInterExercices = rapprochements.filter(
      (c) => c.type === "A_doublon" && c.explication.includes("brouillard N-1"),
    ).length;
  }

  // MODE DE VALIDATION : reproduction des écarts de référence de la feuille
  // « 2026 » du classeur de vérification (lignes Vérification ; audit 28/10 : la
  // feuille réelle est « 2026 », Feuil1/Feuil2 masquées = extraits de brouillard).
  const validation = ecartsReference.length
    ? construireValidation({ entites, familles, anomalies }, ecartsReference)
    : null;

  const famillesNonSoldees = familles.filter((f) => !f.soldee);
  const cleCombinaison = (p: { journal?: string; piece?: string; date?: string }) =>
    `${p.journal}|${p.piece}|${p.date}`;
  // Écritures désignées par une décomposition UNIQUE (attribution certaine).
  const piecesErronees = new Set(
    famillesNonSoldees
      .filter((f) => f.nbVariantesCombinaison <= 1)
      .flatMap((f) => f.combinaisons.flatMap((c) => c.pieces.map(cleCombinaison))),
  );
  // Écritures candidates d'une décomposition AMBIGUÏE (plusieurs décompositions
  // exactes coexistent — aucune ne peut être accusée avec certitude).
  const piecesAmbigues = new Set(
    famillesNonSoldees
      .filter((f) => f.nbVariantesCombinaison > 1)
      .flatMap((f) => f.combinaisons.flatMap((c) => c.pieces.map(cleCombinaison))),
  );

  return {
    entites,
    familles,
    anomalies,
    transferts,
    ranTiers,
    rapprochements,
    validation,
    n1: infoN1,
    stats: {
      lignes: lignes.length,
      pieces: pieces.size,
      entites: entites.length,
      soldees: entites.filter((e) => Math.abs(e.ecart) < 0.01).length,
      familles: familles.length,
      famillesSoldees: familles.filter((f) => f.soldee).length,
      ecartTotal: round2(entites.reduce((t, e) => t + Math.abs(e.ecart), 0)),
      piecesAFixer: familles.filter((f) => !f.soldee).reduce((t, f) => t + f.pieces.length, 0),
      ranTiers: ranTiers.length,
      famillesResolues: famillesNonSoldees.filter((f) => f.combinaisons.length > 0).length,
      famillesNonResolues: famillesNonSoldees.filter(
        (f) => f.combinaisons.length === 0 && f.combinaisonEchec,
      ).length,
      piecesErronees: piecesErronees.size,
      piecesAmbigues: piecesAmbigues.size,
      parType: {
        mauvais_client: anomalies.filter((a) => a.type === "mauvais_client").length,
        hors_perimetre: anomalies.filter((a) => a.type === "hors_perimetre").length,
        compte_oublie: anomalies.filter((a) => a.type === "compte_oublie").length,
        ecart_balance: anomalies.filter((a) => a.type === "ecart_balance").length,
      },
    },
  };
}
