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

/** Fenêtre de recherche des contreparties 580001 de l'exercice N-1 (jours).
 *  Couvre le couloir de fin d'exercice : un transfert initié en octobre N-1
 *  peut se dénouer jusqu'au printemps N (paire réelle 17/09/2025 →
 *  22/01/2026 = 127 jours). Les critères restent forts : même banque, même
 *  montant au centime, chronologie respectée (envoi avant réception) et
 *  aucune réutilisation — la fenêtre seule ne rapproche rien. */
export const FENETRE_N1_JOURS = 180;

/** Exercice d'origine d'un mouvement / d'une écriture. « N » = exercice
 *  contrôlé (brouillard principal), « N-1 » = exercice précédent (brouillard
 *  complémentaire facultatif). */
export type Exercice = "N" | "N-1";

export type TypeControle =
  "A_411" | "A_paiement" | "A_doublon" | "B_460_462" | "C_627" | "OUVERTURE";

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
  OUVERTURE: "Solde d'ouverture — détail retrouvé dans N-1",
};

/** Niveau de confiance QUALITATIF (jamais une probabilité calibrée) —
 *  toujours accompagné de justificationConfiance. */
export type Confiance = "élevée" | "moyenne" | "faible";

/** Écriture source impliquée dans un contrôle, retrouvable dans le brouillard
 *  d'origine : `ligne` = n° de ligne du fichier Excel (1 = en-tête).
 *  `exercice` / `fichier` distinguent les écritures du brouillard N de celles
 *  du brouillard N-1 (traçabilité obligatoire en interexercices). */
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
  exercice?: string;
  fichier?: string;
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
  /** Part du montant ATTENDU issue d'écritures N-1 non apurées à la clôture
   *  N-1 (encaissements/frais reportés), en Ariary. 0/absent = contrôle
   *  entièrement de l'exercice N. */
  montantAttenduN1?: number;
  /** Part du montant RAPPROCHÉ grâce à des écritures de l'exercice N-1
   *  (paires inter-exercices), en Ariary — ventilation exigée par la mission :
   *  le comptable voit ce que N a expliqué et ce que N-1 a apporté. */
  montantRapprocheN1?: number;
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
  /** Pièces du brouillard N-1 (facultatif), clé préfixée
   *  `N1|${journal}|${pièce}|${date}` — absent/vide = aucune recherche
   *  interexercices (comportement historique, import facultatif). */
  piecesN1?: Map<string, EntryLine[]> | undefined;
  /** La pièce N-1 est-elle soldée par le lettrage Sage de N-1 ? */
  soldeeSageN1?: ((keyPiece: string) => boolean) | undefined;
  /** Fenêtre interexercices (jours) — par défaut FENETRE_N1_JOURS. */
  fenetreN1Jours?: number | undefined;
  /** Traçage des à-nouveaux d'ouverture précalculé (partagé avec analyse()). */
  ouvertures?: ResultatOuverture | undefined;
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
  ...(l.exercice ? { exercice: l.exercice } : {}),
  ...(l.fichier ? { fichier: l.fichier } : {}),
});

interface Mvt580 {
  compte: string;
  montant: number; // centimes (positif)
  keyPiece: string;
  date: string;
  pris: boolean;
  /** Exercice du brouillard d'origine (« N » ou « N-1 ») : une écriture N-1
   *  apurée en N-1 ne peut jamais couvrir un écart de N (anti double
   *  comptage interexercices). */
  exercice: Exercice;
  fichier: string;
}

/** Registre partagé des mouvements 580001 : `prendre` consomme un mouvement
 *  (le marque pris) — aucune réutilisation entre deux contrôles, et un
 *  mouvement N-1 apuré en N-1 ne réapparaît jamais côté N. */
class Registre580 {
  envois: Mvt580[] = []; // banque créditée (l'argent sort)
  receptions: Mvt580[] = []; // banque débitée (l'argent arrive)
  /** Index : compte → montant → indices (évite tout balayage quadratique). */
  private idxEnvois = new Map<string, Map<number, number[]>>();
  private idxReceptions = new Map<string, Map<number, number[]>>();

  constructor(pieces: Map<string, EntryLine[]>, piecesN1?: Map<string, EntryLine[]>) {
    for (const [key, group] of pieces) {
      // Une pièce de compte-à-compte contient le 580001 ; ses lignes bancaires
      // sont les envois (crédit) et réceptions (débit).
      if (!group.some((l) => l.compte === "580001")) continue;
      for (const l of group) {
        if (!isBanque(l.compte)) continue;
        if (l.credit > 0) this.ajout(this.envois, this.idxEnvois, l, l.credit, key, "N", "");
        if (l.debit > 0) this.ajout(this.receptions, this.idxReceptions, l, l.debit, key, "N", "");
      }
    }
    // Brouillard N-1 (facultatif) : mouvements tracés et étiquetés « N-1 ».
    for (const [key, group] of piecesN1 ?? new Map<string, EntryLine[]>()) {
      if (!group.some((l) => l.compte === "580001")) continue;
      const fichier = group.find((l) => l.fichier)?.fichier ?? "";
      for (const l of group) {
        if (!isBanque(l.compte)) continue;
        if (l.credit > 0) this.ajout(this.envois, this.idxEnvois, l, l.credit, key, "N-1", fichier);
        if (l.debit > 0)
          this.ajout(this.receptions, this.idxReceptions, l, l.debit, key, "N-1", fichier);
      }
    }
  }

  private ajout(
    liste: Mvt580[],
    idx: Map<string, Map<number, number[]>>,
    l: EntryLine,
    montant: number,
    key: string,
    exercice: Exercice,
    fichier: string,
  ) {
    const m: Mvt580 = {
      compte: l.compte,
      montant: montantCents(montant),
      keyPiece: key,
      date: l.date,
      pris: false,
      exercice,
      fichier,
    };
    liste.push(m);
    const parMontant = idx.get(l.compte) ?? new Map<number, number[]>();
    const arr = parMontant.get(m.montant) ?? [];
    arr.push(liste.length - 1);
    parMontant.set(m.montant, arr);
    idx.set(l.compte, parMontant);
  }

  /** Cherche un mouvement NON PRIS sur (compte, montant) dont la pièce est
   *  dans la fenêtre de dates. `dateRef` vide = sans contrainte de date.
   *  `exercices` restreint l'exercice d'origine des mouvements (par défaut :
   *  tous — équivalent à N seul quand aucun N-1 n'est chargé). */
  private prendre(
    liste: Mvt580[],
    idx: Map<string, Map<number, number[]>>,
    compte: string,
    montant: number,
    dateRef: string,
    fenetre: number,
    exercices?: ReadonlySet<Exercice>,
  ): Mvt580 | null {
    const cands = idx.get(compte)?.get(montant) ?? [];
    for (const i of cands) {
      const m = liste[i]!;
      if (m.pris) continue;
      if (exercices && !exercices.has(m.exercice)) continue;
      if (dateRef && Math.abs(joursEntre(dateRef, m.date)) > fenetre) continue;
      m.pris = true;
      return m;
    }
    return null;
  }

  /** Paire (envoi depuis `from`, réception sur `to`) de même montant, datée
   *  de la pièce de référence ± fenêtre (configurable — l'écriture d'origine
   *  et le compte-à-compte peuvent être décalés de plusieurs semaines ;
   *  `dateRef` vide = sans contrainte de date). `exEnvoi` / `exReception`
   *  restreignent l'exercice des mouvements (défaut : N seul — les
   *  régularisations d'une écriture de N sont toujours postérieures, donc
   *  intra-N ; une paire interexercices passe explicitement N-1 en envoi). */
  paire(
    from: string,
    to: string,
    montantCts: number,
    dateRef: string,
    fenetre: number,
    exEnvoi: Exercice = "N",
    exReception: Exercice = "N",
  ): { envoi: Mvt580; reception: Mvt580 } | null {
    const EX_N = new Set<Exercice>([exEnvoi]);
    const EX_R = new Set<Exercice>([exReception]);
    const e = this.prendre(this.envois, this.idxEnvois, from, montantCts, dateRef, fenetre, EX_N);
    if (!e) return null;
    const r = this.prendre(
      this.receptions,
      this.idxReceptions,
      to,
      montantCts,
      dateRef,
      fenetre,
      EX_R,
    );
    if (r) return { envoi: e, reception: r };
    e.pris = false;
    return null;
  }

  /** Total des paires (envoi depuis une banque MCI CARE → réception sur
   *  `compte`), consommées au fur et à mesure — remboursements de frais
   *  bancaires (règle C). Renvoie le total rapproché et les pièces utilisées.
   *  `exEnvoi`/`exRecep` restreignent les exercices (défaut : N/N). */
  couvrirDepuisMci(
    compte: string,
    banquesMci: Set<string>,
    besoinCts: number,
    exEnvoi: Exercice = "N",
    exRecep: Exercice = "N",
    plafond = false,
  ): { total: number; nbPaires: number; pieces: Set<string> } {
    let total = 0;
    let nbPaires = 0;
    const pieces = new Set<string>();
    const EX_R = new Set<Exercice>([exRecep]);
    const dispos = this.receptions
      .filter((r) => !r.pris && r.compte === compte && EX_R.has(r.exercice))
      .sort((a, b) => a.montant - b.montant);
    const EX_E = new Set<Exercice>([exEnvoi]);
    for (const r of dispos) {
      if (total >= besoinCts) break;
      // Plafond strict (apurements N-1) : une paire qui dépasserait le besoin
      // n'est PAS consommée — l'apurement ne peut jamais excéder le résidu.
      if (plafond && total + r.montant > besoinCts) continue;
      for (const mci of banquesMci) {
        const e = this.prendre(this.envois, this.idxEnvois, mci, r.montant, "", 0, EX_E);
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
   *  les pièces utilisées. `exEnvoi`/`exRecep` restreignent les exercices
   *  (défaut : N/N). */
  couvrir(
    from: string,
    cibles: Set<string>,
    besoinCts: number,
    exEnvoi: Exercice = "N",
    exRecep: Exercice = "N",
    plafond = false,
  ): { total: number; nbPaires: number; pieces: Set<string> } {
    let total = 0;
    let nbPaires = 0;
    const pieces = new Set<string>();
    const parMontant = this.idxEnvois.get(from);
    if (!parMontant) return { total, nbPaires, pieces };
    const EX_E = new Set<Exercice>([exEnvoi]);
    const EX_R = new Set<Exercice>([exRecep]);
    const montants = [...parMontant.keys()].sort((a, b) => a - b);
    for (const montant of montants) {
      if (total >= besoinCts) break;
      // Plafond strict (apurements N-1) : au-delà du besoin, rien n'est consommé.
      if (plafond && total + montant > besoinCts) continue;
      for (const i of parMontant.get(montant) ?? []) {
        const e = this.envois[i]!;
        if (e.pris) continue;
        if (!EX_E.has(e.exercice)) continue;
        for (const cible of cibles) {
          const r = this.prendre(this.receptions, this.idxReceptions, cible, montant, "", 0, EX_R);
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

  /** Paires INTEREXERCICES (envoi N-1 → réception N) : transferts initiés
   *  avant la clôture N-1 et dénoués en N. Chronologie imposée (l'envoi
   *  précède la réception, dans la fenêtre interexercices) — un envoi N ne
   *  peut jamais être apparié à une réception N-1. Couvre au plus `besoinCts`. */
  couvrirInterExercices(
    from: string,
    cibles: Set<string>,
    besoinCts: number,
    fenetreN1: number,
  ): { total: number; nbPaires: number; pieces: Set<string> } {
    let total = 0;
    let nbPaires = 0;
    const pieces = new Set<string>();
    const EX_E = new Set<Exercice>(["N-1"]);
    const EX_R = new Set<Exercice>(["N"]);
    const dispos = this.receptions
      .filter((r) => !r.pris && EX_R.has(r.exercice) && cibles.has(r.compte))
      .sort((a, b) => a.montant - b.montant);
    for (const r of dispos) {
      if (total >= besoinCts) break;
      // Plafond strict : une paire qui dépasserait le besoin n'est pas
      // consommée (la couverture interexercices n'excède jamais le résidu).
      if (total + r.montant > besoinCts) continue;
      const e = this.prendre(this.envois, this.idxEnvois, from, r.montant, r.date, fenetreN1, EX_E);
      if (!e) continue;
      // Chronologie : l'envoi N-1 doit précéder la réception N (sinon le
      // mouvement est libéré pour les paires suivantes).
      const delta = joursEntre(e.date, r.date);
      if (delta < 0 || delta > fenetreN1) {
        e.pris = false;
        continue;
      }
      e.pris = true;
      r.pris = true;
      total += r.montant;
      nbPaires++;
      pieces.add(e.keyPiece);
      pieces.add(r.keyPiece);
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

/** Trace brut d'un à-nouveau d'ouverture : la pièce RAN de N et la(les)
 *  pièce(s) N-1 retrouvées par correspondance exacte (compte + tiers +
 *  montant au centime, désambiguïsation par libellé). */
export interface TraceOuverture {
  /** Clé de la pièce RAN de N. */
  keyRan: string;
  /** Clé(s) N-1 candidate(s) — une seule si la trace est non ambiguë. */
  clesN1: string[];
  /** Ambigu : plusieurs pièces N-1 de même clé (compte, tiers, montant). */
  ambigu: boolean;
  /** Net du compte de tiers porté par l'à-nouveau (Ariary). */
  net: number;
}

export interface ResultatOuverture {
  traces: TraceOuverture[];
  nbTraces: number;
  nbAmbigus: number;
  nbNonTraces: number;
}

/** Comptes de tiers dont l'ouverture est tracée (à-nouveaux RAN portant sur
 *  des comptes réels 401/411/46x — pas les banques ni les comptes de charge). */
const COMPTE_OUVERTURE = (c: string) => /^(401|411|46)/.test(c);

/**
 * Trace les à-nouveaux d'ouverture du journal RAN de N dans le brouillard
 * N-1 : un RAN est « tracé » quand une pièce N-1 porte la même écriture de
 * tiers (même compte, même tiers, même montant au centime, même sens) ;
 * plusieurs candidates ⇒ trace ambiguë (la plus proche par libellé est
 * retenue pour l'affichage, la fiche reste honnête sur l'ambiguïté).
 * Aucun seuil arbitraire : la correspondance est exacte ou n'existe pas.
 */
export function tracerOuvertures(
  pieces: Map<string, EntryLine[]>,
  piecesN1: Map<string, EntryLine[]>,
): ResultatOuverture {
  // Index N-1 : compte|tiers|montantCts(signé) → candidates (clé, lignes).
  const idxN1 = new Map<string, { key: string; libelle: string; lignes: EntryLine[] }[]>();
  for (const [key, group] of piecesN1) {
    for (const l of group) {
      if (!COMPTE_OUVERTURE(l.compte)) continue;
      const net = l.debit - l.credit;
      if (net === 0) continue;
      const k = `${l.compte}|${l.tiers}|${montantCents(net)}`;
      const arr = idxN1.get(k) ?? [];
      arr.push({ key, libelle: normaliseLibelle(l.libelle), lignes: group });
      idxN1.set(k, arr);
    }
  }
  const traces: TraceOuverture[] = [];
  let nbTraces = 0;
  let nbAmbigus = 0;
  let nbNonTraces = 0;
  for (const [key, group] of pieces) {
    if ((group[0]?.journal ?? "") !== "RAN") continue;
    let trouve = false;
    let ambigu = false;
    let net = 0;
    let meilleure: { key: string; libelle: string } | null = null;
    let scoreMeilleure = -1;
    const libRan = normaliseLibelle(group.find((l) => l.libelle)?.libelle ?? "");
    for (const l of group) {
      if (!COMPTE_OUVERTURE(l.compte)) continue;
      const m = l.debit - l.credit;
      if (m === 0) continue;
      net += m;
      const cands = idxN1.get(`${l.compte}|${l.tiers}|${montantCents(m)}`);
      if (!cands || cands.length === 0) continue;
      trouve = true;
      const clesDistinctes = new Set(cands.map((c) => c.key));
      if (clesDistinctes.size > 1) ambigu = true;
      // Désambiguïsation par libellé : la candidate la plus proche (score =
      // longueur du préfixe commun) — heuristique d'AFFICHAGE uniquement,
      // la fiche cite toutes les candidates en cas d'ambiguïté.
      for (const c of cands) {
        let s = 0;
        while (s < Math.min(libRan.length, c.libelle.length) && libRan[s] === c.libelle[s]) s++;
        if (s > scoreMeilleure) {
          scoreMeilleure = s;
          meilleure = c;
        }
      }
    }
    if (!trouve) {
      nbNonTraces++;
      continue;
    }
    if (ambigu) nbAmbigus++;
    else nbTraces++;
    traces.push({
      keyRan: key,
      clesN1: meilleure ? [meilleure.key] : [],
      ambigu,
      net: Math.round(net * 100) / 100,
    });
  }
  return { traces, nbTraces, nbAmbigus, nbNonTraces };
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
  const piecesN1 = ctx.piecesN1 ?? new Map<string, EntryLine[]>();
  const aN1 = piecesN1.size > 0; // import N-1 facultatif : sans lui, tout est intra-N
  const registre = new Registre580(ctx.pieces, aN1 ? piecesN1 : undefined);
  const fen = ctx.fenetreJours;
  const fenN1 = ctx.fenetreN1Jours ?? FENETRE_N1_JOURS;

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

  // Banques MCI présentes en N OU en N-1 : l'apurement des résidus N-1
  // (couvrir intra-N-1) doit pouvoir trouver les réceptions MCI comptabilisées
  // dans N-1 même quand la banque MCI n'apparaît pas dans N — sinon une paire
  // pourtant apurée dans N-1 rejaillirait à tort comme attendu résiduel.
  const bankAccountsN1 = new Set<string>();
  for (const group of piecesN1.values())
    for (const l of group) if (isBanque(l.compte)) bankAccountsN1.add(l.compte);
  const ciblesMciN1 = new Set(
    [...ctx.mciBanks].filter((b) => bankAccounts.has(b) || bankAccountsN1.has(b)),
  );

  // ------------------------------------------------------------------
  // N-1 — index des factures antérieures (401 créditées en N-1) pour la
  // justification « opération de N qui solde un compte ouvert en N-1 ».
  // Aucun statut ne change sur cette base : c'est de la TRAÇABILITÉ.
  // ------------------------------------------------------------------
  const factureN1 = new Map<string, { key: string; l: EntryLine }[]>();
  if (aN1) {
    for (const [key, group] of piecesN1) {
      const journal = group[0]?.journal ?? "";
      if (journal === "RAN") continue;
      for (const l of group) {
        if (!l.compte.startsWith("401") || !l.credit) continue;
        const base = `${l.tiers || l.compte}|${montantCents(l.credit)}`;
        const arr = factureN1.get(base) ?? [];
        arr.push({ key, l });
        factureN1.set(base, arr);
      }
    }
  }
  /** Trace N-1 d'un paiement (mêmes tiers + montant au centime) : texte et
   *  lignes justificatives, ou null. */
  const traceFactureN1 = (tiers: string, montantCts: number) => {
    if (!aN1) return null;
    const cands = factureN1.get(`${tiers}|${montantCts}`) ?? [];
    if (cands.length === 0) return null;
    const c = cands[0]!;
    const amb =
      cands.length > 1
        ? ` (${cands.length} écritures N-1 de même clé — celle-ci est la plus proche par libellé, à vérifier)`
        : "";
    return {
      texte: `Opération d'origine dans l'exercice N-1${amb} : pièce ${c.l.piece} du ${c.l.date} (journal ${c.l.journal}, ligne ${c.l.ligne} du fichier ${c.l.fichier || "N-1"}) — paiement d'une écriture antérieure non apurée à la clôture.`,
      lignes: cands.slice(0, 1).map((x) => estLigneSource(x.l)),
    };
  };

  // N-1 — index des imputations 460/462 (appel de fonds d'origine) pour la
  // justification des fiches B dont la contrepartie N est introuvable.
  const imputationN1 = new Map<string, { key: string; l: EntryLine }[]>();
  if (aN1) {
    for (const [key, group] of piecesN1) {
      const journal = group[0]?.journal ?? "";
      if (journal === "RAN") continue;
      for (const l of group) {
        if (!(l.compte.startsWith("460") || l.compte.startsWith("462"))) continue;
        const m = l.debit > 0 ? l.debit : l.credit;
        if (m <= 0) continue;
        const base = `${l.compte}|${montantCents(m)}`;
        const arr = imputationN1.get(base) ?? [];
        arr.push({ key, l });
        imputationN1.set(base, arr);
      }
    }
  }

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
      // Sans contrepartie intra-N : l'opération d'origine est-elle dans N-1
      // (paiement d'une écriture antérieure non apurée) ? Traçabilité seule —
      // le statut d'imputation ne change pas.
      const traceN1 = couvert ? null : traceFactureN1(l.tiers || l.compte, montant);
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
          : `Paiement du prestataire ${l.tiers || l.compte} décaissé par ${bank} (${journal}) alors que les banques de ${entite} sont : ${propres.join(", ") || "introuvables"} — la pièce TIERS 467/401 désigne ${entite}.` +
            (traceN1 ? ` ${traceN1.texte}` : ""),
        confiance: couvert ? "élevée" : ctx.soldeeSage(pieceKey) ? "élevée" : "moyenne",
        justificationConfiance: couvert
          ? "Paire 580001 appariée au centime entre les deux banques."
          : ctx.soldeeSage(pieceKey)
            ? "Pièce soldée par lettrage Sage (groupes compte+tiers+code équilibrés) : opération régularisée, vérifier seulement l'imputation."
            : "Imputation établie par la pièce TIERS 467/401 (tiers + montant exacts) ; le compte-à-compte de régularisation reste à vérifier dans Sage.",
        lignes: [estLigneSource(l), ...(traceN1?.lignes ?? [])],
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
  // N-1 — doublons INTEREXERCICES : la même écriture (journal + compte +
  // tiers + montant au centime + libellé normalisé) existe dans N ET N-1,
  // sans lettrage Sage dans aucun des deux exercices : reclassement
  // d'exercice (pièce déplacée d'un brouillard à l'autre) ou double saisie
  // de fin d'exercice. Jamais classé anomalie confirmée — à vérifier.
  // ------------------------------------------------------------------
  if (aN1) {
    const idxDoublonN1 = new Map<string, { key: string; l: EntryLine }[]>();
    for (const [key, group] of piecesN1) {
      const journal = group[0]?.journal ?? "";
      if (journal === "RAN") continue;
      if (group.some((l) => l.compte === "580001")) continue;
      if (ctx.soldeeSageN1?.(key)) continue;
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
        const arr = idxDoublonN1.get(k) ?? [];
        arr.push({ key, l });
        idxDoublonN1.set(k, arr);
      }
    }
    const doublonsN1: {
      k: string;
      n: { key: string; l: EntryLine };
      a: { key: string; l: EntryLine }[];
    }[] = [];
    for (const [k, arr] of groups) {
      const n1 = idxDoublonN1.get(k);
      if (!n1) continue;
      doublonsN1.push({ k, n: arr[0]!, a: n1 });
    }
    doublonsN1.sort((a, b) => {
      const ma = a.n.l.debit > 0 ? a.n.l.debit : a.n.l.credit;
      const mb = b.n.l.debit > 0 ? b.n.l.debit : b.n.l.credit;
      return mb - ma;
    });
    for (const d of doublonsN1.slice(0, 100)) {
      const premier = d.n.l;
      const montant = (premier.debit > 0 ? premier.debit : premier.credit) ?? 0;
      add({
        type: "A_doublon",
        societe: premier.compte.startsWith("411")
          ? ctx.nomDeSuffixe(premier.compte.slice(3))
          : premier.tiers || premier.journal,
        journal: premier.journal,
        compteGeneral: premier.compte,
        compteTiers: premier.tiers,
        refPiece: premier.piece,
        refFacture: premier.facture ?? "",
        date: premier.date,
        libelle: premier.libelle,
        montantAttendu: montant / 100,
        montantRapproche: 0,
        ecartRestant: montant / 100,
        sens: premier.debit > 0 ? "débit" : "crédit",
        statut: "doublon_potentiel",
        explication: `La même écriture ${premier.compte} / ${premier.tiers || "—"} de ${(montant / 100).toLocaleString("fr-FR")} Ar avec un libellé identique figure dans le brouillard N (pièce ${premier.piece} du ${premier.date}, ligne ${premier.ligne ?? 0}) ET dans le brouillard N-1 (pièce ${d.a[0]!.l.piece} du ${d.a[0]!.l.date}, ligne ${d.a[0]!.l.ligne ?? 0} du fichier ${d.a[0]!.l.fichier || "N-1"})${d.a.length > 1 ? ` — ${d.a.length} écritures N-1 de même clé` : ""}, sans lettrage Sage dans les deux exercices : reclassement d'exercice entre deux exports ou double saisie de fin d'exercice.`,
        confiance: "moyenne",
        justificationConfiance:
          "Clé de doublon interexercices = journal + compte + tiers + montant au centime + libellé normalisé, sans lettrage Sage dans N ni dans N-1. Un reclassement d'exercice légitime (pièce déplacée d'un brouillard à l'autre) reste possible : à vérifier, jamais classé anomalie confirmée.",
        lignes: [estLigneSource(premier), ...d.a.slice(0, 3).map((x) => estLigneSource(x.l))],
        action:
          "Vérifier dans Sage si la pièce a été reclassée d'un exercice à l'autre (une seule écriture finale) ou saisie deux fois (une écriture à annuler).",
      });
    }
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
  // N-1 — encaissements d'honoraires 411 de N-1 sur les MÊMES banques (une
  // banque qui n'existe plus en N n'ouvre pas de fiche : le contrôle reste
  // celui de l'exercice N). Leurs apurements intra-N-1 sont consommés
  // d'abord ; le RÉSIDU non apuré à la clôture N-1 s'ajoute à l'attendu et
  // peut être couvert par des paires interexercices (envoi N-1 → réception N).
  const hono411N1 = new Map<string, number>();
  if (aN1) {
    for (const [key, group] of piecesN1) {
      const journal = group[0]?.journal ?? "";
      if (journal === "RAN") continue;
      if (group.some((l) => l.compte === "580001")) continue;
      const banks = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
      if (banks.length !== 1) continue;
      const bank = banks[0]!;
      if (!hono411.has(bank)) continue; // banque absente de N : hors périmètre
      if (estMci(bank)) continue;
      // NET de la pièce sur 411 (crédit = encaissement, débit = contrepassation
      // ou remboursement) : une écriture annulée se solde et ne crée jamais
      // d'attendu fictif — le net bancaire cumulé est l'attendu résiduel.
      let net = 0;
      for (const l of group) {
        if (!l.compte.startsWith("411")) continue;
        net += l.debit - l.credit;
      }
      const cts = montantCents(net);
      if (cts !== 0) hono411N1.set(bank, (hono411N1.get(bank) ?? 0) + cts);
    }
  }
  for (const [bank, e] of hono411) {
    const ciblesMci = new Set([...ctx.mciBanks].filter((b) => bankAccounts.has(b)));
    const { total, nbPaires } = registre.couvrir(bank, ciblesMci, e.attendu, "N", "N");
    // N-1 : attendu supplémentaire = encaissements N-1 NON apurés en N-1,
    // couverts en priorité par des paires interexercices puis par les paires
    // intra-N restantes (au-delà du besoin de N). Ventilation N / N-1 conservée.
    let attenduN1Cts = 0;
    let rapprocheN1Cts = 0;
    let interCts = 0; // couvert par des paires interexercices (envoi N-1 → réception N)
    let resteNCts = 0; // couvert par des paires intra-N (opération N soldant un compte ouvert en N-1)
    if (aN1 && (hono411N1.get(bank) ?? 0) < 0) {
      const besoinN1 = -hono411N1.get(bank)!; // net créditeur = encaissements non apurés
      const { total: apureN1 } = registre.couvrir(bank, ciblesMciN1, besoinN1, "N-1", "N-1", true);
      attenduN1Cts = besoinN1 - apureN1; // plafonné : jamais négatif
      if (attenduN1Cts > 0) {
        const { total: inter } = registre.couvrirInterExercices(
          bank,
          ciblesMci,
          attenduN1Cts,
          fenN1,
        );
        interCts = inter;
        if (interCts < attenduN1Cts) {
          const { total: resteN } = registre.couvrir(
            bank,
            ciblesMci,
            attenduN1Cts - interCts,
            "N",
            "N",
            true,
          );
          resteNCts = resteN;
        }
        rapprocheN1Cts = interCts + resteNCts;
      }
    }
    const attendu = e.attendu + attenduN1Cts;
    const totalCouvert = total + rapprocheN1Cts;
    const restant = Math.max(0, attendu - totalCouvert);
    const statut: StatutControle =
      totalCouvert === 0
        ? "transfert_absent"
        : restant === 0
          ? nbPaires === 1 && totalCouvert > attendu
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
      montantRapproche: totalCouvert / 100,
      ecartRestant: restant / 100,
      ...(attenduN1Cts > 0 || rapprocheN1Cts > 0
        ? { montantAttenduN1: attenduN1Cts / 100, montantRapprocheN1: rapprocheN1Cts / 100 }
        : {}),
      sens: "crédit",
      statut,
      explication:
        `${nPieces} pièce(s) d'honoraires 411 encaissée(s) sur ${bank} pour ${(e.attendu / 100).toLocaleString("fr-FR")} Ar ; ` +
        `${(total / 100).toLocaleString("fr-FR")} Ar transféré(s) vers MCI CARE par compte-à-comptes 580001 appariés au centime` +
        (attenduN1Cts > 0
          ? ` ; ${(attenduN1Cts / 100).toLocaleString("fr-FR")} Ar d'encaissements N-1 non apurés à la clôture N-1 s'ajoutent à l'attendu` +
            (rapprocheN1Cts > 0
              ? `, dont ${(rapprocheN1Cts / 100).toLocaleString("fr-FR")} Ar couverts` +
                (interCts > 0
                  ? ` (${(interCts / 100).toLocaleString("fr-FR")} Ar par des transferts interexercices envoi N-1 → réception N, fenêtre ${fenN1} jours` +
                    (resteNCts > 0
                      ? ` + ${(resteNCts / 100).toLocaleString("fr-FR")} Ar par des transferts de N`
                      : "") +
                    ")"
                  : ` par des transferts de N`)
              : ", dont aucun n'est couvert à ce jour (aucun transfert justifié trouvé)")
          : "") +
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
      // Sans contrepartie intra-N : un appel de fonds d'origine existe-t-il
      // en N-1 (imputation 460/462 de mêmes compte et montant) ? Traçabilité
      // seule — le statut ne change pas.
      let noteN1 = "";
      let lignesN1B: LigneSource[] = [];
      if (!paire && aN1) {
        const cands = imputationN1.get(`${l.compte}|${montant}`) ?? [];
        if (cands.length > 0) {
          const c = cands[0]!;
          noteN1 = ` L'appel de fonds d'origine a été comptabilisé en N-1 (pièce ${c.l.piece} du ${c.l.date}, journal ${c.l.journal}, ligne ${c.l.ligne ?? 0} du fichier ${c.l.fichier || "N-1"}) : le virement correspondant a été encaissé en N sur la mauvaise banque.`;
          lignesN1B = [estLigneSource(c.l)];
        }
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
          : `Écriture ${l.compte} (${entite}) encaissée sur ${bank} (journal de ${ctx.banqueEntite.get(bank) ?? journal}) alors que les banques légitimes de ${entite} sont : ${propres.join(", ") || "introuvables"} — aucun compte-à-compte de régularisation trouvé dans la fenêtre de ${fen} jours.` +
            noteN1,
        confiance: paire ? "élevée" : "moyenne",
        justificationConfiance: paire
          ? `Paire 580001 appariée au centime (${paire.envoi.keyPiece.split("|")[1]} → ${paire.reception.keyPiece.split("|")[1]}).`
          : "Imputation hors banque du client, sans lettrage Sage ni contrepartie 580001 : une justification comptable peut exister hors périmètre (pièce hors période, accord inter-sociétés) — à vérifier, jamais classée anomalie confirmée.",
        lignes: [estLigneSource(l), ...lignesN1B],
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
  // N-1 — frais bancaires de N-1 sur les MÊMES banques (banques absentes de
  // N : hors périmètre). Résidu non remboursé à la clôture N-1 ajouté à
  // l'attendu, couvert par remboursements interexercices (envoi MCI N-1 →
  // réception N) puis par les remboursements intra-N restants.
  const fraisN1 = new Map<string, number>();
  if (aN1) {
    for (const [key, group] of piecesN1) {
      const journal = group[0]?.journal ?? "";
      if (journal === "RAN") continue;
      if (!group.some((l) => l.compte.startsWith("627"))) continue;
      const banks = [...new Set(group.filter((l) => isBanque(l.compte)).map((l) => l.compte))];
      if (banks.length !== 1) continue;
      const bank = banks[0]!;
      if (!frais.has(bank) || estMci(bank)) continue;
      let net = 0;
      for (const l of group) {
        if (l.compte.startsWith("627") || l.compte === "445600") net += l.debit - l.credit;
      }
      // Net cumulé par banque (frais débités moins régularisations créditées) :
      // une pièce de frais annulée réduit l'attendu au lieu de l'augmenter.
      const cts = montantCents(net);
      if (cts !== 0) fraisN1.set(bank, (fraisN1.get(bank) ?? 0) + cts);
    }
  }
  for (const [bank, e] of frais) {
    // Remboursements reçus : paires 580001 depuis une banque MCI vers bank,
    // plafonnées au total des frais attendus.
    const { total: rapproche, nbPaires } = registre.couvrirDepuisMci(
      bank,
      ctx.mciBanks,
      e.attendu,
      "N",
      "N",
    );
    // N-1 : frais non remboursés à la clôture N-1 → ventilation.
    let attenduN1Cts = 0;
    let rapprocheN1Cts = 0;
    let interCts = 0;
    let resteNCts = 0;
    if (aN1 && (fraisN1.get(bank) ?? 0) > 0) {
      const besoinN1 = fraisN1.get(bank)!; // net débiteur = frais non remboursés
      const { total: rembN1 } = registre.couvrirDepuisMci(
        bank,
        ctx.mciBanks,
        besoinN1,
        "N-1",
        "N-1",
        true,
      );
      attenduN1Cts = besoinN1 - rembN1; // plafonné : jamais négatif
      if (attenduN1Cts > 0) {
        for (const mci of ctx.mciBanks) {
          if (interCts >= attenduN1Cts) break;
          const { total: inter } = registre.couvrirInterExercices(
            mci,
            new Set([bank]),
            attenduN1Cts - interCts,
            fenN1,
          );
          interCts += inter;
        }
        if (interCts < attenduN1Cts) {
          const { total: resteN } = registre.couvrirDepuisMci(
            bank,
            ctx.mciBanks,
            attenduN1Cts - interCts,
            "N",
            "N",
            true,
          );
          resteNCts = resteN;
        }
        rapprocheN1Cts = interCts + resteNCts;
      }
    }
    const attendu = e.attendu + attenduN1Cts;
    const totalCouvert = rapproche + rapprocheN1Cts;
    const restant = Math.max(0, attendu - totalCouvert);
    const statut: StatutControle =
      totalCouvert === 0
        ? "transfert_absent"
        : restant === 0
          ? nbPaires === 1 && totalCouvert > attendu
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
      montantAttendu: attendu / 100,
      montantRapproche: totalCouvert / 100,
      ecartRestant: restant / 100,
      ...(attenduN1Cts > 0 || rapprocheN1Cts > 0
        ? { montantAttenduN1: attenduN1Cts / 100, montantRapprocheN1: rapprocheN1Cts / 100 }
        : {}),
      sens: "débit",
      statut,
      explication:
        `Frais bancaires (627 + TVA 445600) débités sur ${bank} pour ${(e.attendu / 100).toLocaleString("fr-FR")} Ar ; ` +
        `${(rapproche / 100).toLocaleString("fr-FR")} Ar remboursé(s) par comptes-à-comptes 580001 depuis les banques MCI CARE` +
        (attenduN1Cts > 0
          ? ` ; ${(attenduN1Cts / 100).toLocaleString("fr-FR")} Ar de frais N-1 non remboursés à la clôture N-1 s'ajoutent à l'attendu` +
            (rapprocheN1Cts > 0
              ? `, dont ${(rapprocheN1Cts / 100).toLocaleString("fr-FR")} Ar couverts` +
                (interCts > 0
                  ? ` (${(interCts / 100).toLocaleString("fr-FR")} Ar par des remboursements interexercices, fenêtre ${fenN1} jours` +
                    (resteNCts > 0
                      ? ` + ${(resteNCts / 100).toLocaleString("fr-FR")} Ar par des remboursements de N`
                      : "") +
                    ")"
                  : " par des remboursements de N")
              : ", dont aucun n'est couvert à ce jour (aucun remboursement justifié trouvé)")
          : "") +
        (restant > 0
          ? ` — reste ${(restant / 100).toLocaleString("fr-FR")} Ar non remboursé(s).`
          : "."),
      confiance: totalCouvert > 0 ? "élevée" : "moyenne",
      justificationConfiance:
        totalCouvert > 0
          ? "Paires d'envois MCI CARE / réceptions sur la banque client appariées au centime, sans réutilisation."
          : "Aucune contrepartie 580001 depuis une banque MCI CARE dans le périmètre vérifié : des pièces peuvent manquer (hors période) — un transfert absent n'est jamais une erreur comptable confirmée.",
      lignes,
      action:
        restant > 0
          ? `Demander le remboursement par compte-à-compte depuis BOAMCI 512000 : 580001 Débit / 512000 Crédit, puis ${bank} 580001 Crédit / 512... Débit pour ${(restant / 100).toLocaleString("fr-FR")} Ar.`
          : "Aucune écriture à créer : les frais sont couverts par les comptes-à-comptes de remboursement.",
    });
  }

  // ------------------------------------------------------------------
  // OUVERTURE — détail des à-nouveaux du journal RAN de N retrouvé dans le
  // brouillard N-1 (correspondance exacte compte + tiers + montant). Un
  // solde d'ouverture n'est JAMAIS une anomalie en soi : c'est la preuve de
  // continuité comptable entre les deux exercices. Fiches bornées aux 60
  // plus gros nets (les compteurs globaux sont affichés en tête d'onglet).
  // ------------------------------------------------------------------
  if (aN1) {
    const ouvertures = ctx.ouvertures ?? tracerOuvertures(ctx.pieces, piecesN1);
    const fichiersN1 = new Map(
      [...piecesN1.entries()].map(([k, g]) => [k, g.find((l) => l.fichier)?.fichier ?? ""]),
    );
    const meilleures = [...ouvertures.traces]
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 60);
    for (const t of meilleures) {
      const ran = ctx.pieces.get(t.keyRan) ?? [];
      const lignesN1O = t.clesN1.flatMap((k) =>
        (piecesN1.get(k) ?? []).slice(0, 4).map(estLigneSource),
      );
      const suffixe46 = ran.find((l) => /^46/.test(l.compte))?.compte.slice(3) ?? "";
      add({
        type: "OUVERTURE",
        societe: suffixe46
          ? ctx.nomDeSuffixe(suffixe46)
          : (ran.find((l) => l.tiers)?.tiers ?? "À-nouveaux"),
        journal: "RAN",
        compteGeneral: [
          ...new Set(ran.filter((l) => COMPTE_OUVERTURE(l.compte)).map((l) => l.compte)),
        ].join(", "),
        compteTiers: [...new Set(ran.filter((l) => COMPTE_OUVERTURE(l.compte)).map((l) => l.tiers))]
          .filter(Boolean)
          .join(", "),
        refPiece: ran[0]?.piece ?? "",
        refFacture: "",
        date: ran[0]?.date ?? "",
        libelle: ran.find((l) => l.libelle)?.libelle ?? "",
        montantAttendu: t.net,
        montantRapproche: t.net,
        ecartRestant: 0,
        sens: t.net > 0 ? "débit" : "crédit",
        statut: "correspondance_trouvee",
        explication:
          `À-nouveau d'ouverture (journal RAN de N) reproduisant une écriture du brouillard N-1 (${fichiersN1.get(t.clesN1[0] ?? "") || "fichier N-1"}) : ` +
          `le solde d'ouverture porte une opération antérieure identique (même compte, même tiers, même montant au centime).` +
          (t.ambigu
            ? " Plusieurs écritures N-1 de même clé existent : celle affichée est la plus proche par libellé, à vérifier."
            : ""),
        confiance: t.ambigu ? "moyenne" : "élevée",
        justificationConfiance: t.ambigu
          ? "Correspondance exacte (compte + tiers + montant au centime) mais plusieurs candidates en N-1 : la pièce d'origine reste à confirmer dans Sage."
          : "Correspondance exacte (compte + tiers + montant au centime, même sens) entre l'à-nouveau de N et une écriture du brouillard N-1.",
        lignes: [
          ...ran
            .filter((l) => COMPTE_OUVERTURE(l.compte))
            .slice(0, 4)
            .map(estLigneSource),
          ...lignesN1O,
        ],
        action:
          "Aucune correction : l'à-nouveau reporte une opération antérieure tracée dans N-1 (continuité des soldes d'ouverture).",
      });
    }
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
