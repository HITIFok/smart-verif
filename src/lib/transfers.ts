import type { EntryLine } from "./analysis-types";

export type OperationType = "appel_de_fonds" | "paiement" | "honoraires";
export type TransferStatus = "a_creer" | "existe_deja" | "manuel";

export interface TransferLine {
  compte: string;
  sens: "D" | "C";
  montant: number;
}

export interface TransferProposal {
  id: string;
  type: OperationType;
  statut: TransferStatus;
  entite: string;
  journalSource: string;
  journalDestination: string;
  piece: string;
  date: string;
  libelle: string;
  compteTiers: string;
  banqueSource: string;
  banqueDestination: string;
  montant: number;
  motif: string;
  envoyeur: TransferLine[];
  receptionnaire: TransferLine[];
}

const NON_BANK = new Set(["TIERS", "VENTE", "ACHAT", "RAN", "INVENT", "CAISSE", "OD"]);
const TRANSFER = "580001";
const r2 = (n: number) => Math.round(n * 100) / 100;
const isBank = (c: string) => c.startsWith("512") || c.startsWith("513");

/**
 * Detects operations whose funds moved through another bank account/journal than
 * the client's own account, and proposes the compte-à-compte entry via 580001.
 */
export function detectTransfers(
  lignes: EntryLine[],
  nomParSuffixe: Map<string, string>,
): TransferProposal[] {
  const pieces = new Map<string, EntryLine[]>();
  for (const l of lignes) {
    if (l.journal === "RAN") continue;
    const k = `${l.journal}|${l.piece}|${l.date}`;
    const a = pieces.get(k);
    if (a) a.push(l);
    else pieces.set(k, [l]);
  }

  const bankAccounts = new Set(lignes.filter((l) => isBank(l.compte)).map((l) => l.compte));
  // Entités qui partagent le compte 512 d'une autre entité : nom -> suffixe du compte 512 utilisé
  const SHARED_BANK = new Map<string, string>([
    ["PAMF", "190"], // EASY TECH
    ["EVIOSYS", "600"], // ex-SONOCO, compte 512600
    ["INGEDATA", "600"],
    ["CAMUSAT", "600"],
    ["STELLARIX", "210"], // AITS
    ["WELIGHT", "220"], // AXIANSS
    ["MADAGASCO", "220"],
    ["ATSS", "220"],
    ["AXIAN UNIVERSITY", "240"], // TOM
    ["FONDATION AXIAN", "240"],
    ["SANKO", "260"], // FIRST IMMO
    ["FOUNDEVER", "700"], // SMARTONE
    ["KIDS AKADEMY", "800"], // NACRE
    ["NACRE DIR", "800"],
    ["TANJAKA FOOD", "350"], // OMNIVEST
    ["SANLAMALLIANZ AUTOFI", "501"], // compte propre 512501 (BNIALL) depuis 2026
    ["SANLAMALLIANZ COMPAGNIE", "100"], // 512100 SANLAM
    ["JBU", "320"], // compte 512320 de BOOST (BNIJB)
    ["JBS", "320"],
    ["BOOST", "320"],
    ["TAMBOHO", "201"], // compte 512201 de TALYS (BOAGTA)
    ["STMB", "201"],
    ["SOCOTA/LECO", "330"], // compte 512330 de LECOFRUIT (BNILEC)
    ["EVASAN", "140"], // compte 512140 (BOATSA)
  ]);
  const ownBank = (s: string) => {
    const direct = `512${s}`;
    if (bankAccounts.has(direct)) return direct;
    const nom = nomParSuffixe.get(s);
    const aliasSuffix = nom ? SHARED_BANK.get(nom) : undefined;
    const aliasAcc = aliasSuffix ? `512${aliasSuffix}` : null;
    return aliasAcc && bankAccounts.has(aliasAcc) ? aliasAcc : null;
  };

  // MCI own bank account = dominant 512 of a journal named *MCI (bank journal, not MVO)
  const mciCounts = new Map<string, number>();
  for (const l of lignes)
    if (/^(BOA|BNI).*MCI$/.test(l.journal) && l.compte.startsWith("512"))
      mciCounts.set(l.compte, (mciCounts.get(l.compte) ?? 0) + 1);
  const mciBank = [...mciCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Existing 580001 transfers, to avoid duplicates
  const existing = new Map<string, number>();
  const bump = (k: string) => existing.set(k, (existing.get(k) ?? 0) + 1);
  for (const g of pieces.values()) {
    if (!g.some((l) => l.compte === TRANSFER)) continue;
    for (const l of g) {
      if (!isBank(l.compte)) continue;
      if (l.credit) bump(`out|${l.compte}|${r2(l.credit)}`);
      if (l.debit) bump(`in|${l.compte}|${r2(l.debit)}`);
    }
  }
  const consume = (from: string, to: string, m: number) => {
    const ko = `out|${from}|${m}`;
    const ki = `in|${to}|${m}`;
    if ((existing.get(ko) ?? 0) > 0 && (existing.get(ki) ?? 0) > 0) {
      existing.set(ko, existing.get(ko)! - 1);
      existing.set(ki, existing.get(ki)! - 1);
      return true;
    }
    return false;
  };

  // TIERS payments: 401 credit (tiers + amount) -> client suffix of the 467 debit.
  // Two keys: precise (tiers|amount|piece) and loose (tiers|amount) as fallback.
  const paiementClient = new Map<string, string[]>();
  const paiementClientPiece = new Map<string, string[]>();
  for (const g of pieces.values()) {
    if (g[0]?.journal !== "TIERS") continue;
    const s467 = [...new Set(g.filter((l) => l.compte.startsWith("467") && l.debit).map((l) => l.compte.slice(3)))];
    if (s467.length === 0) continue;
    for (const l of g) {
      if (!l.compte.startsWith("401") || !l.credit) continue;
      const base = `${l.tiers || l.compte}|${r2(l.credit)}`;
      const arr = paiementClient.get(base) ?? [];
      arr.push(...s467);
      paiementClient.set(base, arr);
      const kp = `${base}|${g[0]!.piece}`;
      const arrP = paiementClientPiece.get(kp) ?? [];
      arrP.push(...s467);
      paiementClientPiece.set(kp, arrP);
    }
  }

  const out: TransferProposal[] = [];
  let seq = 0;

  const push = (
    p: Omit<TransferProposal, "id" | "statut" | "envoyeur" | "receptionnaire" | "motif">,
    motifBase: string,
    forcedManual?: string,
  ) => {
    let statut: TransferStatus = "a_creer";
    let motif = motifBase;
    if (forcedManual) {
      statut = "manuel";
      motif = forcedManual;
    } else if (consume(p.banqueSource, p.banqueDestination, p.montant)) {
      statut = "existe_deja";
      motif = `${motifBase} — écriture 580001 déjà présente, aucun doublon créé`;
    }
    const ok = statut !== "manuel";
    out.push({
      ...p,
      id: `T${++seq}`,
      statut,
      motif,
      envoyeur: ok
        ? [
            { compte: TRANSFER, sens: "D", montant: p.montant },
            { compte: p.banqueSource, sens: "C", montant: p.montant },
          ]
        : [],
      receptionnaire: ok
        ? [
            { compte: TRANSFER, sens: "C", montant: p.montant },
            { compte: p.banqueDestination, sens: "D", montant: p.montant },
          ]
        : [],
    });
  };

  for (const g of pieces.values()) {
    const first = g[0];
    if (!first || NON_BANK.has(first.journal)) continue;
    if (g.some((l) => l.compte === TRANSFER)) continue; // already a transfer piece
    const banks = [...new Set(g.filter((l) => isBank(l.compte)).map((l) => l.compte))];
    if (banks.length === 0) continue;
    const bank = banks.length === 1 ? banks[0]! : null;
    const base = { journalSource: "", piece: first.piece, date: first.date, libelle: first.libelle };

    for (const l of g) {
      const p3 = l.compte.slice(0, 3);

      // 1. Appel de fonds : 460 C / 512 D
      if (p3 === "460" && l.credit) {
        const s = l.compte.slice(3);
        const m = r2(l.credit);
        const dest = ownBank(s);
        const entite = nomParSuffixe.get(s) ?? `suffixe ${s}`;
        const common = {
          ...base, type: "appel_de_fonds" as const, entite, journalDestination: first.journal,
          compteTiers: l.compte, montant: m,
        };
        if (!bank || !dest) {
          push({ ...common, journalSource: "TIERS", banqueSource: bank ?? banks.join("/"), banqueDestination: dest ?? "?" }, "",
            !bank ? "Plusieurs comptes bancaires sur la pièce" : `Compte 512${s} du client introuvable dans le brouillard`);
        } else if (bank !== dest) {
          push({ ...common, journalSource: first.journal, banqueSource: bank, banqueDestination: dest },
            `Fonds de l'appel ${l.compte} reçus sur ${bank} (${first.journal}) au lieu de ${dest}`);
        }
      }

      // 2. Paiement prestataire : 401 D / 512-513 C
      if (p3 === "401" && l.debit) {
        const m = r2(l.debit);
        const baseKey = `${l.tiers || l.compte}|${m}`;
        // Départage par numéro de pièce d'abord, repli sur tiers+montant
        const cands = [...new Set(
          paiementClientPiece.get(`${baseKey}|${first.piece}`) ?? paiementClient.get(baseKey) ?? [],
        )];
        const s = cands.length === 1 ? cands[0]! : null;
        const src = s ? ownBank(s) : null;
        const common = {
          ...base, type: "paiement" as const, entite: s ? nomParSuffixe.get(s) ?? `suffixe ${s}` : "?",
          journalSource: "TIERS", journalDestination: first.journal,
          compteTiers: l.tiers ? `${l.compte} / ${l.tiers}` : l.compte, montant: m,
        };
        const payBank = bank;
        if (!s || !src || !payBank) {
          if (payBank?.startsWith("513") || (s && payBank && src !== payBank)) {
            push({ ...common, banqueSource: src ?? "?", banqueDestination: payBank ?? banks.join("/") }, "",
              !s ? (cands.length ? "Plusieurs clients possibles pour ce paiement" : "Écriture TIERS 467/401 correspondante introuvable")
                : !payBank ? "Plusieurs comptes bancaires sur la pièce" : `Compte 512${s} du client introuvable`);
          }
        } else if (payBank !== src) {
          push({ ...common, banqueSource: src, banqueDestination: payBank },
            `Paiement réglé par ${payBank} (${first.journal}) au lieu du compte client ${src}`);
        }
      }

      // 3. Honoraires : 411 C / 512 D
      if (p3 === "411" && l.credit) {
        const m = r2(l.credit);
        const common = {
          ...base, type: "honoraires" as const, entite: "MCI", journalSource: "VENTE",
          journalDestination: first.journal, compteTiers: l.compte, montant: m,
        };
        if (!bank || !mciBank) {
          push({ ...common, banqueSource: bank ?? banks.join("/"), banqueDestination: mciBank ?? "?" }, "",
            !bank ? "Plusieurs comptes bancaires sur la pièce" : "Compte bancaire MCI non identifié");
        } else if (bank !== mciBank) {
          push({ ...common, banqueSource: bank, banqueDestination: mciBank },
            `Honoraire encaissé sur ${bank} (${first.journal}) au lieu du compte MCI ${mciBank}`);
        }
      }
    }
  }

  return out.sort((a, b) => b.montant - a.montant);
}
