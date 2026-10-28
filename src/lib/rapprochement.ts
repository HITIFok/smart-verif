import type { EntryLine } from "./analysis-types";
import { BANQUE_PAR_COMPTE, BANQUES_PAR_SUFFIXE } from "./banques-societes";
import { SHARED_BANK } from "./shared-bank";
import {
  joursEntre,
  montantCents,
  normaliseJournal,
  normaliseLibelle,
  normaliseReference,
} from "./normalisation";

/**
 * MOTEUR DE RAPPROCHEMENT EXPLICABLE — règles A, B et C du cahier des charges
 * (docs/spec-rapprochement.md). Déterministe et traçable : chaque contrôle
 * porte son montant attendu, rapproché, restant, un statut opposable, une
 * justification, les écritures sources avec leur référence de ligne dans le
 * brouillard et l'action recommandée. L'IA n'intervient pas dans le calcul.
 *
 * Appariement 1-1 / 1-N / N-1 par montants (centimes entiers) sur un registre
 * de consommation partagé : un même mouvement 580001 ne peut jamais expliquer
 * deux contrôles indépendants. Les comparaisons se font au centime via
 * montantCents — aucune tolérance arbitraire ne masque un écart.
 */

/** Fenêtre de recherche des contreparties 580001 (jours). Justifiée par les
 *  données réelles : les appels de fonds / remboursements arrivent jusqu'à
 *  45 jours après l'écriture d'origine (paires observées dans le brouillard
 *  27/10). Configurable en un seul endroit. */
export const FENETRE_JOURS = 45;

export type TypeControle = "A_411" | "A_paiement" | "A_doublon" | "B_460_462" | "C_627";

export type StatutControle =
  | "anomalie_confirmee"
  | "transfert_absent"
  | "transfert_partiel"
  | "transfert_excedentaire"
  | "erreur_imputation_probable"
  | "doublon_potentiel"
  | "ecart_non_explique"
  | "correspondance_trouvee";

export const STATUT_LABELS: Record<StatutControle, string> = {
  anomalie_confirmee: "Anomalie confirmée",
  transfert_absent: "Transfert absent",
  transfert_partiel: "Transfert partiel",
  transfert_excedentaire: "Transfert excédentaire",
  erreur_imputation_probable: "Erreur d'imputation probable",
  doublon_potentiel: "Doublon potentiel",
  ecart_non_explique: "Écart non expliqué",
  correspondance_trouvee: "Correspondance trouvée",
};

export const TYPE_CONTROLE_LABELS: Record<TypeControle, string> = {
  A_411: "Règle A — 411 : transferts honoraires vers MCI CARE",
  A_paiement: "Règle A — 401/467 : paiement imputé hors banque du client",
  A_doublon: "Règle A — doublon potentiel",
  B_460_462: "Règle B — 460/462 : imputation inter-journaux",
  C_627: "Règle C — 627 : frais bancaires à la charge de MCI CARE",
};

/** Niveau de confiance QUALITATIF (jamais une probabilité calibrée) —
 *  toujours accompagné de justificationConfiance. */
export type Confiance = "élevée" | "moyenne" | "faible";

/** Écriture source impliquée dans un contrôle, retrouvable dans le brouillard
 *  d'origine : `ligne` = n° de ligne du fichier Excel (1 = en-tête). */
export interface LigneSource {
  journal: string;
  piece: string;
  date: string;
  compte: string;
  tiers: string;
  libelle: string;
  debit: number;
  credit: number;
  ligne: number;
  facture: string;
}

/** Fiche de contrôle complète (mission §7) : tout ce que le comptable doit
 *  voir pour vérifier humainement le résultat du moteur. */
export interface ControleRapproche {
  id: string;
  type: TypeControle;
  societe: string;
  journal: string;
  compteGeneral: string;
  compteTiers: string;
  refPiece: string;
  refFacture: string;
  date: string;
  libelle: string;
  /** Montant attendu (ce qui devrait être transféré / imputé), en Ariary. */
  montantAttendu: number;
  /** Montant effectivement rapproché dans le brouillard, en Ariary. */
  montantRapproche: number;
  /** Restant à rapprocher (attendu − rapproché, plancher 0 pour les
   *  transferts ; excédent négatif possible), en Ariary. */
  ecartRestant: number;
  sens: "débit" | "crédit" | "";
  statut: StatutControle;
  explication: string;
  confiance: Confiance;
  justificationConfiance: string;
  lignes: LigneSource[];
  action: string;
  /** Fenêtre de recherche appliquée (jours), si pertinent. */
  fenetreJours?: number;
}

/** Contexte fourni par l'analyse principale (analyzer.ts) — évite tout
 *  recalcul quadratique : tout est indexé en amont. */
export interface ContexteRapprochement {
  lignes: EntryLine[];
  /** Pièces du brouillard, clé = `${journal}|${pièce}|${date}` (format brut). */
  pieces: Map<string, EntryLine[]>;
  /** Suffixes 46x légitimes en contrepartie de chaque banque. */
  validAfByBank: Map<string, Set<string>>;
  /** Compte banque → société de rattachement (MCI CARE, TELMA…). */
  banqueSociete: Map<string, string>;
  /** Compte banque → entité propriétaire (nom du bloc Verif). */
  banqueEntite: Map<string, string>;
  /** Suffixe client → banques « propres » (512 + suffixe, banque partagée, M-Vola mappée). */
  banquesDuSuffixe: (suffixe: string) => string[];
  /** Banques de MCI CARE (BOAMCI 512000, BNITEM 512005, MVOMCI 513000). */
  mciBanks: Set<string>;
  /** La pièce est-elle soldée par le lettrage Sage ? (clé pièce). */
  soldeeSage: (keyPiece: string) => boolean;
  /** Nom de l'entité d'un suffixe 46x (pour les messages). */
  nomDeSuffixe: (suffixe: string) => string;
  fenetreJours: number;
}

const isBanque = (c: string) => c.startsWith("512") || c.startsWith("513");
const estLigneSource = (l: EntryLine): LigneSource => ({
  journal: l.journal,
  piece: l.piece,
  date: l.date,
  compte: l.compte,
  tiers: l.tiers,
  libelle: l.libelle,
  debit: l.debit,
  credit: l.credit,
  ligne: l.ligne ?? 0,
  facture: l.facture ?? "",
});

interface Mvt580 {
  compte: string;
  montant: number; // centimes (positif)
  keyPiece: string;
  date: string;
  pris: boolean;
}

/** Registre partagé des mouvements 580001 : `prendre` consomme un mouvement
 *  (le marque pris) — aucune réutilisation entre deux contrôles. */
class Registre580 {
  envois: Mvt580[] = []; // banque créditée (l'argent sort)
  receptions: Mvt580[] = []; // banque débitée (l'argent arrive)
  /** Index : compte → montant → indices (évite tout balayage quadratique). */
  private idxEnvois = new Map<string, Map<number, number[]>>();
  private idxReceptions = new Map<string, Map<number, number[]>>();

  constructor(pieces: Map<string, EntryLine[]>) {
    for (const [key, group] of pieces) {
      // Une pièce de compte-à-compte contient le 580001 ; ses lignes bancaires
      // sont les envois (crédit) et réceptions (débit).
      if (!group.some((l) => l.compte === "580001")) continue;
      for (const l of group) {
        if (!isBanque(l.compte)) continue;
        if (l.credit > 0) this.ajout(this.envois, this.idxEnvois, l, l.credit, key);
        if (l.debit > 0) this.ajout(this.receptions, this.idxReceptions, l, l.debit, key);
      }
    }
  }

  private ajout(
    liste: Mvt580[],
    idx: Map<string, Map<number, number[]>>,
    l: EntryLine,
    montant: number,
    key: string,
  ) {
    const m: Mvt580 = {
      compte: l.compte,
      montant: montantCents(montant),
      keyPiece: key,
      date: l.date,
      pris: false,
    };
    liste.push(m);
    const parMontant = idx.get(l.compte) ?? new Map<number, number[]>();
    const arr = parMontant.get(m.montant) ?? [];
    arr.push(liste.length - 1);
    parMontant.set(m.montant, arr);
    idx.set(l.compte, parMontant);
  }

  /** Cherche un mouvement NON PRIS sur (compte, montant) dont la pièce est
   *  dans la fenêtre de dates. `dateRef` vide = sans contrainte de date. */
  private prendre(
    liste: Mvt580[],
    idx: Map<string, Map<number, number[]>>,
    compte: string,
    montant: number,
    dateRef: string,
    fenetre: number,
  ): Mvt580 | null {
    const cands = idx.get(compte)?.get(montant) ?? [];
    for (const i of cands) {
      const m = liste[i]!;
      if (m.pris) continue;
      if (dateRef && Math.abs(joursEntre(dateRef, m.date)) > fenetre) continue;
      m.pris = true;
      return m;
    }
    return null;
  }

  /** Paire (envoi depuis `from`, réception sur `to`) de même montant, datée
   *  de la pièce de référence ± fenêtre (configurable — l'écriture d'origine
   *  et le compte-à-compte peuvent être décalés de plusieurs semaines ;
   *  `dateRef` vide = sans contrainte de date). */
  paire(
    from: string,
    to: string,
    montantCts: number,
    dateRef: string,
    fenetre: number,
  ): { envoi: Mvt580; reception: Mvt580 } | null {
    const e = this.prendre(this.envois, this.idxEnvois, from, montantCts, dateRef, fenetre);
    if (!e) return null;
    const r = this.prendre(this.receptions, this.idxReceptions, to, montantCts, dateRef, fenetre);
    if (r) return { envoi: e, reception: r };
    e.pris = false;
    return null;
  }

  /** Total des paires (envoi depuis une banque MCI CARE → réception sur
   *  `compte`), consommées au fur et à mesure — remboursements de frais
   *  bancaires (règle C). Renvoie le total rapproché et les pièces utilisées. */
  couvrirDepuisMci(
    compte: string,
    banquesMci: Set<string>,
    besoinCts: number,
  ): { total: number; nbPaires: number; pieces: Set<string> } {
    let total = 0;
    let nbPaires = 0;
    const pieces = new Set<string>();
    const dispos = this.receptions
      .filter((r) => !r.pris && r.compte === compte)
      .sort((a, b) => a.montant - b.montant);
    for (const r of dispos) {
      if (total >= besoinCts) break;
      for (const mci of banquesMci) {
        const e = this.prendre(this.envois, this.idxEnvois, mci, r.montant, "", 0);
        if (!e) continue;
        r.pris = true;
        total += r.montant;
        nbPaires++;
        pieces.add(r.keyPiece);
        pieces.add(e.keyPiece);
        break;
      }
    }
    return { total, nbPaires, pieces };
  }

  /** Total des paires (envoi depuis `from` → réception sur un compte de
   *  `cibles`), consommées au fur et à mesure. Renvoie le total rapproché et
   *  les pièces utilisées. */
  couvrir(
    from: string,
    cibles: Set<string>,
    besoinCts: number,
  ): { total: number; nbPaires: number; pieces: Set<string> } {
    let total = 0;
    let nbPaires = 0;
    const pieces = new Set<string>();
    const parMontant = this.idxEnvois.get(from);
    if (!parMontant) return { total, nbPaires, pieces };
    const montants = [...parMontant.keys()].sort((a, b) => a - b);
    for (const montant of montants) {
      if (total >= besoinCts) break;
      for (const i of parMontant.get(montant) ?? []) {
        const e = this.envois[i]!;
        if (e.pris) continue;
        for (const cible of cibles) {
          const r = this.prendre(this.receptions, this.idxReceptions, cible, montant, "", 0);
          if (r) {
            e.pris = true;
            total += montant;
            nbPaires++;
            pieces.add(e.keyPiece);
            pieces.add(r.keyPiece);
            break;
          }
        }
        if (total >= besoinCts) break;
      }
    }
    return { total, nbPaires, pieces };
  }
}

/** Banques « propres » d'un suffixe client : 512+suffixe, banque partagée
 *  (SHARED_BANK via le nom d'entité), M-Vola mappée (BANQUES_PAR_SUFFIXE). */
export function banquesDuSuffixeFactory(
  bankAccounts: Set<string>,
  nomDeSuffixe: (s: string) => string,
): (suffixe: string) => string[] {
  return (suffixe: string): string[] => {
    const out: string[] = [];
    const direct = `512${suffixe}`;
    if (bankAccounts.has(direct)) out.push(direct);
    const alias = SHARED_BANK.get(nomDeSuffixe(suffixe));
    if (alias) {
      const acc = bankAccounts.has(`512${alias}`) ? `512${alias}` : `513${alias}`;
      if (bankAccounts.has(acc) && !out.includes(acc)) out.push(acc);
    }
    for (const acc of BANQUES_PAR_SUFFIXE.get(suffixe) ?? [])
      if (bankAccounts.has(acc) && !out.includes(acc)) out.push(acc);
    return out;
  };
}

/**
 * Exécute les règles A, B et C sur le brouillard. Renvoie les fiches de
 * contrôle triées par pertinence (écarts décroissants, statut).
 */
export function rapprocher(ctx: ContexteRapprochement): ControleRapproche[] {
  const controles: ControleRapproche[] = [];
  let seq = 0;
  const add = (c: Omit<ControleRapproche, "id">) => {
    controles.push({ ...c, id: `R${++seq}` });
  };
  const registre = new Registre580(ctx.pieces);
  const fen = ctx.fenetreJours;

  // Index des banques présentes + journal dominant de chaque banque.
  const bankAccounts = new Set<string>();
  const journalDeBanque = new Map<string, Map<string, number>>();
  const banqueDuJournal = new Map<string, Map<string, number>>();
  for (const l of ctx.lignes) {
    if (!isBanque(l.compte)) continue;
    bankAccounts.add(l.compte);
    if (l.journal === "RAN") continue;
    const j = journalDeBanque.get(l.compte) ?? new Map<string, number>();
    j.set(l.journal, (j.get(l.journal) ?? 0) + 1);
    journalDeBanque.set(l.compte, j);
    const b = banqueDuJournal.get(l.journal) ?? new Map<string, number>();
    b.set(l.compte, (b.get(l.compte) ?? 0) + 1);
    banqueDuJournal.set(l.journal, b);
  }
  const journalPrincipal = (compte: string) =>
    [...(journalDeBanque.get(compte) ?? new Map<string, number>()).entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? "";
  const estMci = (banque: string) =>
    ctx.mciBanks.has(banque) || ctx.banqueSociete.get(banque) === "MCI CARE";

  // ------------------------------------------------------------------
  // RÈGLE A — paiements 401000+tiers imputés hors banque du client.
  // Une pièce TIERS « 467 D / 401000+tiers C » désigne le client payé ;
  // le règlement banque doit partir de la banque du CLIENT. On construit
  // l'index TIERS (tiers|montant → suffixes 467) puis on contrôle chaque
  // pièce bancaire 401 D.
  // ------------------------------------------------------------------
  const paiementClient = new Map<string, string[]>();
  const paiementClientPiece = new Map<string, string[]>();
  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal !== "TIERS") continue;
    const s467 = [
      ...new Set(
        group.filter((l) => l.compte.startsWith("467") && l.debit).map((l) => l.compte.slice(3)),
      ),
    ];
    if (s467.length === 0) continue;
    for (const l of group) {
      if (!l.compte.startsWith("401") || !l.credit) continue;
      const base = `${l.tiers || l.compte}|${montantCents(l.credit)}`;
      paiementClient.set(base, [...(paiementClient.get(base) ?? []), ...s467]);
      const kp = `${base}|${l.piece}`;
      paiementClientPiece.set(kp, [...(paiementClientPiece.get(kp) ?? []), ...s467]);
    }
  }

  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal === "RAN" || group.some((l) => l.compte === "580001")) continue;
    const banks = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
    if (banks.length !== 1) continue; // ambigu : déjà signalé par les anomalies pièce à pièce
    const bank = banks[0]!;
    if (estMci(bank)) continue; // banque de MCI CARE : rien à imputer ailleurs
    for (const l of group) {
      if (!l.compte.startsWith("401") || !l.debit) continue;
      const base = `${l.tiers || l.compte}|${montantCents(l.debit)}`;
      let cands = [
        ...new Set(paiementClientPiece.get(`${base}|${l.piece}`) ?? paiementClient.get(base) ?? []),
      ];
      if (cands.length > 1) {
        const lib = normaliseLibelle(`${l.libelle} ${group[0]?.libelle ?? ""}`);
        const nommés = cands.filter((c) => {
          const n = normaliseLibelle(ctx.nomDeSuffixe(c));
          return n.length >= 4 && lib.includes(n);
        });
        if (nommés.length === 1) cands = nommés;
      }
      if (cands.length !== 1) continue; // non imputable : pas de fausse accusation
      const suffixe = cands[0]!;
      const propres = ctx.banquesDuSuffixe(suffixe);
      if (propres.includes(bank)) continue; // payé depuis la banque du client : normal
      const montant = montantCents(l.debit);
      // Un compte-à-compte de régularisation a-t-il déjà couvert ce paiement ?
      const couvert = propres.some((p) => registre.paire(bank, p, montant, l.date, fen));
      const pieceKey = key;
      const entite = ctx.nomDeSuffixe(suffixe);
      add({
        type: "A_paiement",
        societe: entite,
        journal,
        compteGeneral: l.compte,
        compteTiers: l.tiers,
        refPiece: l.piece,
        refFacture: l.facture ?? "",
        date: l.date,
        libelle: l.libelle,
        montantAttendu: montant / 100,
        montantRapproche: couvert ? montant / 100 : 0,
        ecartRestant: couvert ? 0 : montant / 100,
        sens: "débit",
        statut: couvert ? "correspondance_trouvee" : "erreur_imputation_probable",
        explication: couvert
          ? `Paiement du prestataire ${l.tiers || l.compte} décaissé par ${bank} (${journal}) au lieu de la banque de ${entite} — un compte-à-compte 580001 de régularisation existe dans la fenêtre de ${fen} jours.`
          : `Paiement du prestataire ${l.tiers || l.compte} décaissé par ${bank} (${journal}) alors que les banques de ${entite} sont : ${propres.join(", ") || "introuvables"} — la pièce TIERS 467/401 désigne ${entite}.`,
        confiance: couvert ? "élevée" : ctx.soldeeSage(pieceKey) ? "élevée" : "moyenne",
        justificationConfiance: couvert
          ? "Paire 580001 appariée au centime entre les deux banques."
          : ctx.soldeeSage(pieceKey)
            ? "Pièce soldée par lettrage Sage (groupes compte+tiers+code équilibrés) : opération régularisée, vérifier seulement l'imputation."
            : "Imputation établie par la pièce TIERS 467/401 (tiers + montant exacts) ; le compte-à-compte de régularisation reste à vérifier dans Sage.",
        lignes: [estLigneSource(l)],
        action: couvert
          ? "Vérifier la paire de compte-à-comptes dans Sage ; aucune écriture à créer."
          : "Vérifier la pièce dans Sage ; si l'imputation est confirmée, régulariser par compte-à-compte 580001 depuis la banque du client.",
        fenetreJours: fen,
      });
      break; // un seul contrôle A_paiement par pièce
    }
  }

  // ------------------------------------------------------------------
  // RÈGLE A — doublons potentiels : même (journal, compte 40x/411, tiers,
  // montant, libellé normalisé) sur PLUSIEURS pièces distinctes non soldées
  // par lettrage Sage. Les opérations récurrentes légitimes (loyers,
  // carburants) diffèrent par le mois dans le libellé — la clé libellé les
  // sépare ; un vrai doublon (ex. réel HOTEL SERENA 6988/7264) reste détecté.
  // ------------------------------------------------------------------
  const groups = new Map<string, { key: string; l: EntryLine }[]>();
  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal === "RAN") continue;
    if (group.some((l) => l.compte === "580001")) continue;
    if (ctx.soldeeSage(key)) continue;
    for (const l of group) {
      if (!(l.compte.startsWith("401") || l.compte.startsWith("411"))) continue;
      const montant = l.debit > 0 ? l.debit : l.credit;
      if (montant <= 0) continue;
      const k = [
        journal,
        l.compte.slice(0, 3),
        l.tiers,
        montantCents(montant),
        normaliseLibelle(l.libelle),
      ].join("|");
      const arr = groups.get(k) ?? [];
      arr.push({ key, l });
      groups.set(k, arr);
    }
  }
  for (const [, arr] of groups) {
    const piecesDistinctes = new Set(arr.map((x) => x.key));
    if (piecesDistinctes.size < 2) continue;
    // Une seule pièce avec plusieurs lignes identiques n'est pas un doublon
    // de saisie ; il faut des PIÈCES distinctes.
    const lignes = arr.slice(0, 8).map((x) => estLigneSource(x.l));
    const premier = arr[0]!.l;
    const montant = (premier.debit > 0 ? premier.debit : premier.credit) ?? 0;
    add({
      type: "A_doublon",
      societe: premier.compte.startsWith("411")
        ? ctx.nomDeSuffixe(premier.compte.slice(3))
        : premier.tiers || premier.journal,
      journal: premier.journal,
      compteGeneral: premier.compte,
      compteTiers: premier.tiers,
      refPiece: [...piecesDistinctes].map((k) => k.split("|")[1]).join(" + "),
      refFacture: [...new Set(lignes.map((x) => x.facture).filter(Boolean))].join(" + "),
      date: premier.date,
      libelle: premier.libelle,
      montantAttendu: (montant / 100) * piecesDistinctes.size,
      montantRapproche: 0,
      ecartRestant: (montant / 100) * piecesDistinctes.size,
      sens: premier.debit > 0 ? "débit" : "crédit",
      statut: "doublon_potentiel",
      explication: `${piecesDistinctes.size} pièces distinctes (${[...piecesDistinctes].map((k) => k.split("|")[1]).join(", ")}) portent la même écriture ${premier.compte} / ${premier.tiers || "—"} de ${(montant / 100).toLocaleString("fr-FR")} avec un libellé identique, sans lettrage Sage qui les solde.`,
      confiance: "moyenne",
      justificationConfiance:
        "Clé de doublon = journal + compte + tiers + montant au centime + libellé normalisé ; les pièces ne sont soldées par aucun lettrage Sage. Une opération récurrente légitime reste possible : à vérifier sur les pièces justificatives.",
      lignes,
      action:
        "Comparer les deux pièces et leurs justificatifs dans Sage ; annuler l'une d'elles si la même opération a été saisie deux fois.",
    });
  }

  // ------------------------------------------------------------------
  // RÈGLE A — 411 : honoraires MCI CARE encaissés sur les banques clients,
  // à reverser à MCI CARE par compte-à-compte 580001. Attendu/rapproché/
  // restant PAR BANQUE (un encaissement peut couvrir plusieurs transferts
  // et un transfert couvre plusieurs encaissements).
  // ------------------------------------------------------------------
  const hono411 = new Map<string, { attendu: number; pieces: Map<string, LigneSource[]> }>();
  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal === "RAN") continue;
    if (group.some((l) => l.compte === "580001")) continue;
    const banks = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
    if (banks.length !== 1) continue;
    const bank = banks[0]!;
    if (estMci(bank)) continue;
    for (const l of group) {
      if (!l.compte.startsWith("411") || !l.credit) continue;
      const e = hono411.get(bank) ?? { attendu: 0, pieces: new Map<string, LigneSource[]>() };
      e.attendu += montantCents(l.credit);
      e.pieces.set(key, [...(e.pieces.get(key) ?? []), estLigneSource(l)]);
      hono411.set(bank, e);
    }
  }
  for (const [bank, e] of hono411) {
    const ciblesMci = new Set([...ctx.mciBanks].filter((b) => bankAccounts.has(b)));
    const { total, nbPaires } = registre.couvrir(bank, ciblesMci, e.attendu);
    const attendu = e.attendu;
    const restant = Math.max(0, attendu - total);
    const statut: StatutControle =
      total === 0
        ? "transfert_absent"
        : restant === 0
          ? nbPaires === 1 && total > attendu
            ? "transfert_excedentaire"
            : "correspondance_trouvee"
          : "transfert_partiel";
    const lignes = [...e.pieces.entries()]
      .sort((a, b) => {
        const sa = a[1].reduce((t, x) => t + x.credit, 0);
        const sb = b[1].reduce((t, x) => t + x.credit, 0);
        return sb - sa;
      })
      .slice(0, 20)
      .flatMap(([, ls]) => ls);
    const nPieces = e.pieces.size;
    add({
      type: "A_411",
      societe: ctx.banqueEntite.get(bank) ?? ctx.banqueSociete.get(bank) ?? bank,
      journal: journalPrincipal(bank),
      compteGeneral: "411",
      compteTiers: `${nPieces} pièce(s) d'encaissement`,
      refPiece: "",
      refFacture: "",
      date: "",
      libelle: `Honoraires 411 encaissés sur ${bank} (${journalPrincipal(bank)})`,
      montantAttendu: attendu / 100,
      montantRapproche: total / 100,
      ecartRestant: restant / 100,
      sens: "crédit",
      statut,
      explication:
        `${nPieces} pièce(s) d'honoraires 411 encaissée(s) sur ${bank} pour ${(attendu / 100).toLocaleString("fr-FR")} Ar ; ` +
        `${(total / 100).toLocaleString("fr-FR")} Ar transféré(s) vers MCI CARE par compte-à-comptes 580001 appariés au centime` +
        (restant > 0
          ? ` — reste ${(restant / 100).toLocaleString("fr-FR")} Ar non transféré(s).`
          : "."),
      confiance: "élevée",
      justificationConfiance:
        "Appariement 1-N des envois 580001 de la banque client vers les banques MCI CARE, sans réutilisation d'un même mouvement ; montants comparés au centime.",
      lignes,
      action:
        restant > 0
          ? `Créer le compte-à-compte : ${bank} 580001 Débit / banque MCI CARE Crédit, puis banque MCI CARE 580001 Débit / ${bank} Crédit pour ${(restant / 100).toLocaleString("fr-FR")} Ar.`
          : "Aucune écriture à créer : les encaissements sont couverts par les comptes-à-comptes passés.",
    });
  }

  // ------------------------------------------------------------------
  // RÈGLE B — 460/462 imputés dans le journal d'un autre client.
  // ------------------------------------------------------------------
  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal === "RAN") continue;
    if (journal === "TIERS") continue; // journal central : 460 D / 467 C normaux
    if (group.some((l) => l.compte === "580001")) continue;
    // La règle B cible les IMPUTATIONS INTER-JOURNAUX BANCAIRES : la pièce
    // doit porter UN SEUL mouvement de trésorerie (comme un encaissement
    // journalisé). Les reclassements d'inventaire multi-banques (INVENT fin
    // de période) et les pièces sans trésorerie ne sont jamais signalés.
    const banksPiece = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
    if (banksPiece.length !== 1) continue;
    const bank = banksPiece[0]!;
    if (estMci(bank)) continue;
    const valid = ctx.validAfByBank.get(bank);
    for (const l of group) {
      if (!(l.compte.startsWith("460") || l.compte.startsWith("462"))) continue;
      const suffixe = l.compte.slice(3);
      const montant = montantCents(l.debit > 0 ? l.debit : l.credit);
      if (montant === 0) continue;
      const sens: "débit" | "crédit" = l.debit > 0 ? "débit" : "crédit";
      const entite = ctx.nomDeSuffixe(suffixe);
      if (valid?.has(suffixe)) {
        // Imputation cohérente avec le propriétaire de la banque : contrôle
        // satisfait — on ne noie pas le comptable, pas de fiche.
        continue;
      }
      if (ctx.soldeeSage(key)) {
        add({
          type: "B_460_462",
          societe: entite,
          journal,
          compteGeneral: l.compte,
          compteTiers: l.tiers,
          refPiece: l.piece,
          refFacture: l.facture ?? "",
          date: l.date,
          libelle: l.libelle,
          montantAttendu: montant / 100,
          montantRapproche: montant / 100,
          ecartRestant: 0,
          sens,
          statut: "correspondance_trouvee",
          explication: `Écriture ${l.compte} (${entite}) passée dans le journal ${journal} (banque ${bank}) mais soldée par le lettrage Sage : l'opération est régularisée, l'imputation reste à vérifier pour l'avenir.`,
          confiance: "élevée",
          justificationConfiance:
            "Toutes les lignes lettrées de la pièce appartiennent à des groupes (compte + tiers + code) équilibrés dans le brouillard.",
          lignes: [estLigneSource(l)],
          action:
            "Aucune correction nécessaire ; vérifier la règle d'imputation avec le comptable.",
        });
        continue;
      }
      // Compte-à-compte de régularisation : du compte imputé vers une banque
      // légitime du suffixe, même montant, fenêtre ± fenêtreJours.
      const propres = ctx.banquesDuSuffixe(suffixe);
      let paire: { envoi: Mvt580; reception: Mvt580 } | null = null;
      for (const p of propres) {
        paire = registre.paire(bank, p, montant, l.date, fen);
        if (paire) break;
      }
      add({
        type: "B_460_462",
        societe: entite,
        journal,
        compteGeneral: l.compte,
        compteTiers: l.tiers,
        refPiece: l.piece,
        refFacture: l.facture ?? "",
        date: l.date,
        libelle: l.libelle,
        montantAttendu: montant / 100,
        montantRapproche: paire ? montant / 100 : 0,
        ecartRestant: paire ? 0 : montant / 100,
        sens,
        statut: paire ? "correspondance_trouvee" : "erreur_imputation_probable",
        explication: paire
          ? `Écriture ${l.compte} (${entite}) encaissée sur ${bank} (journal de ${ctx.banqueEntite.get(bank) ?? journal}) — un transfert 580001 de régularisation vers ${propres.join(", ")} a été identifié dans la fenêtre de ${fen} jours.`
          : `Écriture ${l.compte} (${entite}) encaissée sur ${bank} (journal de ${ctx.banqueEntite.get(bank) ?? journal}) alors que les banques légitimes de ${entite} sont : ${propres.join(", ") || "introuvables"} — aucun compte-à-compte de régularisation trouvé dans la fenêtre de ${fen} jours.`,
        confiance: paire ? "élevée" : "moyenne",
        justificationConfiance: paire
          ? `Paire 580001 appariée au centime (${paire.envoi.keyPiece.split("|")[1]} → ${paire.reception.keyPiece.split("|")[1]}).`
          : "Imputation hors banque du client, sans lettrage Sage ni contrepartie 580001 : une justification comptable peut exister hors périmètre (pièce hors période, accord inter-sociétés) — à vérifier, jamais classée anomalie confirmée.",
        lignes: [estLigneSource(l)],
        action: paire
          ? "Vérifier la paire de compte-à-comptes dans Sage ; l'imputation a été régularisée."
          : "Vérifier la pièce avec le comptable : demande d'appel de fonds d'un autre client régularisée plus tard, ou erreur d'imputation à corriger.",
        fenetreJours: fen,
      });
    }
  }

  // ------------------------------------------------------------------
  // RÈGLE C — 627 : frais bancaires débités sur les banques clients, à la
  // charge de MCI CARE : compte-à-compte de remboursement attendu.
  // ------------------------------------------------------------------
  const frais = new Map<string, { attendu: number; pieces: LigneSource[]; date: string }>();
  for (const [key, group] of ctx.pieces) {
    const journal = group[0]?.journal ?? "";
    if (journal === "RAN") continue;
    if (!group.some((l) => l.compte.startsWith("627"))) continue;
    const banks = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
    if (banks.length !== 1) continue;
    const bank = banks[0]!;
    if (estMci(bank)) continue;
    // Net débit des lignes de frais (627 + TVA 445600) de la pièce.
    let net = 0;
    for (const l of group) {
      if (l.compte.startsWith("627") || l.compte === "445600") net += l.debit - l.credit;
    }
    const cts = montantCents(net);
    if (cts <= 0) continue; // régulation inverse : rien attendu
    const e = frais.get(bank) ?? { attendu: 0, pieces: [], date: "" };
    e.attendu += cts;
    e.pieces.push(estLigneSource(group.find((l) => l.compte.startsWith("627"))!));
    if (!e.date) e.date = group[0]?.date ?? "";
    frais.set(bank, e);
  }
  for (const [bank, e] of frais) {
    // Remboursements reçus : paires 580001 depuis une banque MCI vers bank,
    // plafonnées au total des frais attendus.
    const { total: rapproche, nbPaires } = registre.couvrirDepuisMci(bank, ctx.mciBanks, e.attendu);
    const restant = Math.max(0, e.attendu - rapproche);
    const statut: StatutControle =
      rapproche === 0
        ? "transfert_absent"
        : restant === 0
          ? nbPaires === 1 && rapproche > e.attendu
            ? "transfert_excedentaire"
            : "correspondance_trouvee"
          : "transfert_partiel";
    const lignes = [...e.pieces].sort((a, b) => b.debit - a.debit).slice(0, 20);
    add({
      type: "C_627",
      societe: ctx.banqueEntite.get(bank) ?? ctx.banqueSociete.get(bank) ?? bank,
      journal: journalPrincipal(bank),
      compteGeneral: "627",
      compteTiers: `${e.pieces.length} pièce(s) de frais`,
      refPiece: "",
      refFacture: "",
      date: e.date,
      libelle: `Frais bancaires 627 débités sur ${bank} (${journalPrincipal(bank)})`,
      montantAttendu: e.attendu / 100,
      montantRapproche: rapproche / 100,
      ecartRestant: restant / 100,
      sens: "débit",
      statut,
      explication:
        `Frais bancaires (627 + TVA 445600) débités sur ${bank} pour ${(e.attendu / 100).toLocaleString("fr-FR")} Ar ; ` +
        `${(rapproche / 100).toLocaleString("fr-FR")} Ar remboursé(s) par comptes-à-comptes 580001 depuis les banques MCI CARE` +
        (restant > 0
          ? ` — reste ${(restant / 100).toLocaleString("fr-FR")} Ar non remboursé(s).`
          : "."),
      confiance: rapproche > 0 ? "élevée" : "moyenne",
      justificationConfiance:
        rapproche > 0
          ? "Paires d'envois MCI CARE / réceptions sur la banque client appariées au centime, sans réutilisation."
          : "Aucune contrepartie 580001 depuis une banque MCI CARE dans le périmètre vérifié : des pièces peuvent manquer (hors période) — un transfert absent n'est jamais une erreur comptable confirmée.",
      lignes,
      action:
        restant > 0
          ? `Demander le remboursement par compte-à-compte depuis BOAMCI 512000 : 580001 Débit / 512000 Crédit, puis ${bank} 580001 Crédit / 512... Débit pour ${(restant / 100).toLocaleString("fr-FR")} Ar.`
          : "Aucune écriture à créer : les frais sont couverts par les comptes-à-comptes de remboursement.",
    });
  }

  // Tri : les écarts sérieux d'abord (non expliqués / anomalies), puis par
  // montant décroissant — les « correspondance_trouvee » en queue.
  const rangStatut = (s: StatutControle): number =>
    s === "correspondance_trouvee"
      ? 2
      : s === "doublon_potentiel" || s === "erreur_imputation_probable"
        ? 1
        : 0;
  return controles.sort(
    (a, b) =>
      rangStatut(a.statut) - rangStatut(b.statut) ||
      Math.abs(b.montantAttendu) - Math.abs(a.montantAttendu),
  );
}
