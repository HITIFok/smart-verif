import type { EntryLine } from "./analysis-types";
import { SHARED_BANK } from "./shared-bank";
import { BANQUES_PAR_SOCIETE, BANQUES_PAR_SUFFIXE } from "./banques-societes";

export type OperationType = "appel_de_fonds" | "paiement" | "honoraires";
export type TransferStatus = "a_creer" | "existe_deja" | "manuel";

/** Libellés affichables des opérations détectées (UI + export Excel). */
export const OPERATION_LABELS: Record<OperationType, string> = {
  appel_de_fonds: "Arrivée des fonds",
  paiement: "Paiement",
  honoraires: "Honoraires / revenus MCI CARE",
};

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
const fmtMad = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  // Journal bancaire de chaque compte 512/513 présent dans le brouillard
  // (ex. 512000 → BOAMCI) : sert à nommer le journal de saisie du
  // compte-à-compte de destination.
  const journalBanque = new Map<string, string>();
  for (const l of lignes) if (isBank(l.compte)) journalBanque.set(l.compte, l.journal);
  // Banques « propres » d'un client : son 512 direct, un 512 partagé
  // (SHARED_BANK) ou sa banque Mobile Money 513 mappée (BANQUES_PAR_SUFFIXE :
  // MVOTEL 513140 pour TELMA, MVOHOL 513110 pour SANLAMALLIANZ COMPAGNIE).
  const ownBanks = (s: string): string[] => {
    const out: string[] = [];
    const direct = `512${s}`;
    if (bankAccounts.has(direct)) out.push(direct);
    const nom = nomParSuffixe.get(s);
    const aliasSuffix = nom ? SHARED_BANK.get(nom) : undefined;
    const aliasAcc = aliasSuffix ? `512${aliasSuffix}` : null;
    if (aliasAcc && bankAccounts.has(aliasAcc) && !out.includes(aliasAcc)) out.push(aliasAcc);
    for (const acc of BANQUES_PAR_SUFFIXE.get(s) ?? [])
      if (bankAccounts.has(acc) && !out.includes(acc)) out.push(acc);
    return out;
  };
  const ownBank = (s: string) => ownBanks(s)[0] ?? null;

  // MCI own bank account = dominant 512 of a journal named *MCI (bank journal, not MVO)
  const mciCounts = new Map<string, number>();
  for (const l of lignes)
    if (/^(BOA|BNI).*MCI$/.test(l.journal) && l.compte.startsWith("512"))
      mciCounts.set(l.compte, (mciCounts.get(l.compte) ?? 0) + 1);
  const mciBank = [...mciCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Banques de la maison MCI CARE : journaux BOA/BNI *MCI + banques mappées
  // (BOAMCI 512000 — BOA, BNITEM 512005 — BNI, MVOMCI 513000 — Mobile Money
  // MVOLA de MCI CARE). Destination des honoraires / revenus (411, 606200).
  const mciBanks = new Set<string>(
    [...(BANQUES_PAR_SOCIETE.get("MCI CARE") ?? []), mciBank].filter(
      (b): b is string => b !== null && bankAccounts.has(b),
    ),
  );
  const honoDest = mciBank ?? [...mciBanks][0] ?? null;

  // Société (client ou maison) rattachée à chaque compte bancaire du
  // brouillard : l'analyse raisonne « comme un comptable », au niveau société —
  // plusieurs banques d'une même société sont interchangeables pour couvrir un
  // compte-à-compte (BNITEM 512005, BOAMCI 512000 et MVOMCI 513000 appartiennent
  // toutes les trois à MCI CARE). La cartographie explicite est prioritaire.
  const societeParBanque = new Map<string, string>();
  for (const [sfx, nom] of nomParSuffixe) {
    const direct = `512${sfx}`;
    if (bankAccounts.has(direct)) societeParBanque.set(direct, nom);
    const aliasSfx = SHARED_BANK.get(nom);
    const aliasAcc = aliasSfx ? `512${aliasSfx}` : null;
    if (aliasAcc && bankAccounts.has(aliasAcc)) societeParBanque.set(aliasAcc, nom);
  }
  for (const [sfx, banques] of BANQUES_PAR_SUFFIXE) {
    const nom = nomParSuffixe.get(sfx);
    if (!nom) continue;
    for (const b of banques) if (bankAccounts.has(b)) societeParBanque.set(b, nom);
  }
  for (const [socNom, banques] of BANQUES_PAR_SOCIETE)
    for (const b of banques) societeParBanque.set(b, socNom);
  const societeDe = (compte: string) => societeParBanque.get(compte) ?? compte;

  // Comptes-à-comptes 580001 déjà passés dans le brouillard : envoi = 580001 D
  // / 512-513 C ; réception = 580001 C / 512-513 D. Sert à reconnaître ce qui
  // est déjà comptabilisé (les « sans erreurs ») et à ne jamais demander un
  // doublon.
  type MouvementExistant = { compte: string; societe: string; montant: number; pris: boolean };
  const envois: MouvementExistant[] = [];
  const receptions: MouvementExistant[] = [];
  for (const g of pieces.values()) {
    if (!g.some((l) => l.compte === TRANSFER)) continue;
    for (const l of g) {
      if (!isBank(l.compte)) continue;
      if (l.credit)
        envois.push({
          compte: l.compte,
          societe: societeDe(l.compte),
          montant: r2(l.credit),
          pris: false,
        });
      if (l.debit)
        receptions.push({
          compte: l.compte,
          societe: societeDe(l.compte),
          montant: r2(l.debit),
          pris: false,
        });
    }
  }

  // Cherche un couple envoi/réception 580001 déjà passé couvrant (from → to,
  // montant m) : d'abord à l'identique, puis au niveau société de chaque côté —
  // un CàC passé depuis une autre banque de la même société (ex. BNITEM 512005
  // au lieu de MVOMCI 513000) couvre tout autant l'écriture.
  const prendre = (
    liste: MouvementExistant[],
    compte: string,
    societe: string,
    m: number,
    auNiveauSociete: boolean,
  ): MouvementExistant | null => {
    const trouve =
      liste.find(
        (x) =>
          !x.pris &&
          x.montant === m &&
          (auNiveauSociete ? x.societe === societe : x.compte === compte),
      ) ?? null;
    if (trouve) trouve.pris = true;
    return trouve;
  };
  const consume = (
    from: string,
    to: string,
    m: number,
  ): { envoi: MouvementExistant; reception: MouvementExistant } | null => {
    const so = societeDe(from);
    const si = societeDe(to);
    for (const nivOut of [false, true])
      for (const nivIn of [false, true]) {
        const e = prendre(envois, from, so, m, nivOut);
        if (!e) continue;
        const r = prendre(receptions, to, si, m, nivIn);
        if (r) return { envoi: e, reception: r };
        e.pris = false; // rendre l'envoi avant d'essayer la combinaison suivante
      }
    return null;
  };

  // Couvre un besoin agrégé (total des honoraires regroupés sur une banque)
  // avec les couples 580001 déjà passés depuis la même société vers une banque
  // MCI. Paires les plus petites d'abord ; une paire plus grande que le reste
  // peut le couvrir en débordant. Retourne le montant couvert et marque les
  // mouvements utilisés (jamais comptés deux fois).
  const couvrirAgrege = (bank: string, besoin: number): number => {
    const so = societeDe(bank);
    let couvert = 0;
    const dispos = envois
      .filter((e) => !e.pris && e.societe === so)
      .sort((a, b) => a.montant - b.montant);
    for (const e of dispos) {
      if (couvert >= besoin) break;
      const resteBesoin = r2(besoin - couvert);
      const r = receptions.find(
        (x) => !x.pris && x.montant === e.montant && mciBanks.has(x.compte),
      );
      if (!r) continue;
      e.pris = true;
      r.pris = true;
      couvert = e.montant <= resteBesoin ? r2(couvert + e.montant) : besoin;
    }
    return couvert;
  };

  // Candidats honoraires/revenus (411, 606200) encaissés hors banques MCI,
  // regroupés par banque d'encaissement après la boucle principale.
  const honoCands: {
    piece: string;
    journal: string;
    date: string;
    libelle: string;
    compteTiers: string;
    m: number;
    bank: string;
  }[] = [];

  const decrireMv = (mv: MouvementExistant) =>
    `${journalBanque.get(mv.compte) ?? mv.societe} ${mv.compte}`.trim();

  // TIERS payments: 401 credit (tiers + amount) -> client suffix of the 467 debit.
  // Two keys: precise (tiers|amount|piece) and loose (tiers|amount) as fallback.
  const paiementClient = new Map<string, string[]>();
  const paiementClientPiece = new Map<string, string[]>();
  for (const g of pieces.values()) {
    if (g[0]?.journal !== "TIERS") continue;
    const s467 = [
      ...new Set(
        g.filter((l) => l.compte.startsWith("467") && l.debit).map((l) => l.compte.slice(3)),
      ),
    ];
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
    statutPredef?: TransferStatus,
  ) => {
    let statut: TransferStatus = statutPredef ?? "a_creer";
    let motif = motifBase;
    if (forcedManual) {
      statut = "manuel";
      motif = forcedManual;
    } else if (!statutPredef) {
      const cov = consume(p.banqueSource, p.banqueDestination, p.montant);
      if (cov) {
        statut = "existe_deja";
        motif = `${motifBase} — compte-à-compte 580001 déjà passé (${decrireMv(cov.envoi)} → ${decrireMv(cov.reception)}) : aucun doublon à créer`;
      }
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
    const base = {
      journalSource: "",
      piece: first.piece,
      date: first.date,
      libelle: first.libelle,
    };

    for (const l of g) {
      const p3 = l.compte.slice(0, 3);

      // 4. Arrivée des fonds en banque : 460 C / 512 D (schéma du cycle :
      // l'appel de fonds lui-même s'écrit en TIERS 460 D / 467 C ; ici on
      // détecte les fonds arrivés sur une autre banque que celle du client).
      if (p3 === "460" && l.credit) {
        const s = l.compte.slice(3);
        const m = r2(l.credit);
        const dest = ownBank(s);
        const entite = nomParSuffixe.get(s) ?? `suffixe ${s}`;
        const common = {
          ...base,
          type: "appel_de_fonds" as const,
          entite,
          journalDestination: first.journal,
          compteTiers: l.compte,
          montant: m,
        };
        if (!bank || !dest) {
          push(
            {
              ...common,
              journalSource: "TIERS",
              banqueSource: bank ?? banks.join("/"),
              banqueDestination: dest ?? "?",
            },
            "",
            !bank
              ? "Plusieurs comptes bancaires sur la pièce"
              : `Compte 512${s} du client introuvable dans le brouillard`,
          );
        } else if (bank && !ownBanks(s).includes(bank)) {
          push(
            {
              ...common,
              journalSource: first.journal,
              banqueSource: bank,
              banqueDestination: dest,
            },
            `Fonds de l'appel ${l.compte} arrivés sur ${bank} (${first.journal}) au lieu de ${dest}`,
          );
        }
      }

      // 3. Paiement prestataire côté banque : 401000 + tiers D / 512-513 C
      // (étape 3 du schéma du cycle appel de fonds).
      if (p3 === "401" && l.debit) {
        const m = r2(l.debit);
        const baseKey = `${l.tiers || l.compte}|${m}`;
        // Départage par numéro de pièce d'abord, repli sur tiers+montant
        let cands = [
          ...new Set(
            paiementClientPiece.get(`${baseKey}|${first.piece}`) ??
              paiementClient.get(baseKey) ??
              [],
          ),
        ];
        // Dernier recours : quand la pièce TIERS couvre plusieurs clients en
        // même temps, le libellé de la ligne bancaire nomme souvent le client.
        if (cands.length > 1) {
          const lib = `${l.libelle} ${first.libelle}`.toUpperCase();
          const nommés = cands.filter((c) => {
            const n = nomParSuffixe.get(c);
            return (
              n &&
              n.length >= 4 &&
              new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lib)
            );
          });
          if (nommés.length === 1) cands = nommés;
        }
        const s = cands.length === 1 ? cands[0]! : null;
        const src = s ? ownBank(s) : null;
        const common = {
          ...base,
          type: "paiement" as const,
          entite: s ? (nomParSuffixe.get(s) ?? `suffixe ${s}`) : "?",
          journalSource: "TIERS",
          journalDestination: first.journal,
          compteTiers: l.tiers ? `${l.compte} / ${l.tiers}` : l.compte,
          montant: m,
        };
        const payBank = bank;
        if (!s || !src || !payBank) {
          if (payBank?.startsWith("513") || (s && payBank && src !== payBank)) {
            push(
              {
                ...common,
                banqueSource: src ?? "?",
                banqueDestination: payBank ?? banks.join("/"),
              },
              "",
              !s
                ? cands.length
                  ? "Plusieurs clients possibles pour ce paiement"
                  : "Écriture TIERS 467/401 correspondante introuvable"
                : !payBank
                  ? "Plusieurs comptes bancaires sur la pièce"
                  : `Compte 512${s} du client introuvable`,
            );
          }
        } else if (!ownBanks(s).includes(payBank)) {
          push(
            { ...common, banqueSource: src, banqueDestination: payBank },
            `Paiement réglé par ${payBank} (${first.journal}) au lieu du compte client ${src}`,
          );
        }
      }

      // 3. Honoraires / revenus MCI CARE : 411 ou 606200 C / 512 D.
      // Les 411 (honoraires) et 606200 (revenus) de MCI CARE encaissés sur la
      // banque d'un client (ex. BOATSA 411140 C / 512140 D) doivent repartir
      // vers une banque de MCI CARE via 580001. Ils ne partent pas un à un :
      // plusieurs écritures peuvent être payées en compte-à-compte ENSEMBLE
      // (ex. deux 411140 de 1 000 → un seul CàC de 2 000). On collecte donc
      // les candidats ; le regroupement par banque se fait après la boucle.
      if ((p3 === "411" || l.compte.startsWith("6062")) && l.credit) {
        const m = r2(l.credit);
        if (!bank || mciBanks.size === 0) {
          push(
            {
              ...base,
              type: "honoraires" as const,
              entite: "MCI",
              journalSource: first.journal,
              journalDestination: (honoDest ? journalBanque.get(honoDest) : undefined) ?? "BANQUE",
              compteTiers: l.compte,
              banqueSource: bank ?? banks.join("/"),
              banqueDestination: mciBank ?? "?",
              montant: m,
            },
            "",
            !bank
              ? "Plusieurs comptes bancaires sur la pièce"
              : "Compte bancaire MCI non identifié",
          );
        } else if (!mciBanks.has(bank)) {
          honoCands.push({
            piece: first.piece,
            journal: first.journal,
            date: first.date,
            libelle: first.libelle,
            compteTiers: l.compte,
            m,
            bank,
          });
        }
      }
    }
  }

  // Regroupement des honoraires/revenus par banque d'encaissement : ils ne
  // partent pas un à un en compte-à-compte mais peuvent être payés ensemble
  // (ex. deux 411140 de 1 000 dans BOATSA → un CàC de 2 000). On compare le
  // total encaissé aux couples 580001 déjà passés depuis la même société vers
  // une banque MCI ; seul le solde non couvert reste à créer, en une écriture.
  const parBanque = new Map<string, typeof honoCands>();
  for (const c of honoCands) {
    const arr = parBanque.get(c.bank);
    if (arr) arr.push(c);
    else parBanque.set(c.bank, [c]);
  }
  if (honoDest) {
    for (const [bank, cands] of parBanque) {
      const total = r2(cands.reduce((s, c) => s + c.m, 0));
      const couvert = couvrirAgrege(bank, total);
      const reste = r2(Math.max(0, total - couvert));
      const n = cands.length;
      const piecesUniques = [...new Set(cands.map((c) => c.piece))];
      const comptesUniques = [...new Set(cands.map((c) => c.compteTiers))];
      push(
        {
          type: "honoraires",
          entite: "MCI",
          journalSource: cands[0]!.journal,
          journalDestination: journalBanque.get(honoDest) ?? "BANQUE",
          piece:
            piecesUniques.length === 1
              ? piecesUniques[0]!
              : `${piecesUniques[0]!} +${piecesUniques.length - 1}`,
          date: cands[0]!.date,
          libelle: cands[0]!.libelle,
          compteTiers:
            comptesUniques.length === 1
              ? comptesUniques[0]!
              : `${comptesUniques[0]!} +${comptesUniques.length - 1}`,
          banqueSource: bank,
          banqueDestination: honoDest,
          montant: reste > 0 ? reste : total,
        },
        reste > 0
          ? `${n} écriture(s) honoraires/revenus regroupée(s) sur ${bank} (total ${fmtMad(total)})` +
              (couvert > 0 ? ` ; ${fmtMad(couvert)} déjà transféré(s) via 580001` : "") +
              ` — reste ${fmtMad(reste)} à transférer vers ${honoDest} en un seul compte-à-compte`
          : `${n} écriture(s) honoraires/revenus regroupée(s) sur ${bank} (total ${fmtMad(total)}) — déjà couverte(s) par les comptes-à-comptes 580001 passés vers ${honoDest}`,
        undefined,
        reste > 0 ? "a_creer" : "existe_deja",
      );
    }
  }

  return out.sort((a, b) => b.montant - a.montant);
}
