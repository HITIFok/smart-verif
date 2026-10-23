import type { TransferProposal } from "./transfers";

export type AnomalyType = "mauvais_client" | "hors_perimetre" | "compte_oublie" | "ecart_balance";

export interface EntryLine {
  journal: string;
  piece: string;
  date: string;
  compte: string;
  tiers: string;
  libelle: string;
  debit: number;
  credit: number;
}

export interface Anomaly {
  id: string;
  type: AnomalyType;
  entite: string;
  suffixe: string;
  journal: string;
  piece: string;
  date: string;
  libelle: string;
  comptes: string;
  montant: number;
  detail: string;
  lignes: EntryLine[];
}

export interface EntitySummary {
  nom: string;
  suffixe: string;
  appelDeFonds: number;
  tresorerie: number;
  ecart: number;
  anomalies: number;
  montantAnomalies: number;
  /** Nom de l'entité parente si celle-ci est soldée avec la banque partagée
   *  d'un autre client (ex. MGS ∈ famille FSS, CAMUSAT ∈ famille EVIOSYS). */
  famille?: string;
  /** Membres de la famille dont cette entité est la parente (propriétaire de
   *  la banque partagée), elle-même incluse. */
  enfants?: string[];
  comptes: {
    compte: string;
    solde: number;
    listeVerif: boolean;
    famille: "AF" | "TR";
    /** Banque partagée : affichée à titre informatif, exclue de l'écart (déjà comptée chez son propriétaire). */
    partage?: boolean;
  }[];
}

/** Rôle comptable d'une pièce concernée par un écart de famille réel. */
export type PieceEcartRole =
  | "a_nouveaux" // journal RAN — report d'ouverture, porte le solde historique
  | "compte_a_compte" // la pièce contient un 580001 (transfert interne)
  | "appel_de_fonds" // étape 1 : 460 D / 467 C
  | "paiement_tiers" // étape 2 : 467 D / 401000 + tiers C
  | "paiement_banque" // étape 3 : 401000 + tiers D / 512 C
  | "arrivee_fonds" // étape 4 : 512 D / 460 C
  | "annulation_paiement" // hors cycle : 512 D / 401000 + tiers C
  | "autre"; // hors schéma du cycle

export const PIECE_ROLE_LABELS: Record<PieceEcartRole, string> = {
  a_nouveaux: "À-nouveaux",
  compte_a_compte: "Compte-à-compte",
  appel_de_fonds: "Appel de fonds",
  paiement_tiers: "Paiement (tiers)",
  paiement_banque: "Paiement (banque)",
  arrivee_fonds: "Arrivée des fonds",
  annulation_paiement: "Annulation de paiement",
  autre: "Hors schéma",
};

/** Combinaison exacte d'écritures erronées expliquant un écart de famille :
 *  la somme des nets de ces pièces redonne EXACTEMENT l'écart de la feuille 2
 *  du Verif BG. Un écart peut être composé de PLUSIEURS écritures erronées et
 *  pas toujours d'une seule — ex. écart 90 000 = 48 000 + 2 000 + 40 000 —
 *  comme d'une seule écriture. C'est la(les) pièce(s) à corriger dans Sage
 *  pour solder la famille : une fois ces écritures corrigées, les autres
 *  mouvements se compensent entre eux et l'écart tombe à zéro. */
export interface CombinaisonEcart {
  /** Les écritures erronées de la combinaison (références à FamilleVerif.pieces). */
  pieces: PieceEcart[];
  /** Somme exacte des nets de la combinaison (Débit − Crédit), en Ariary. */
  somme: number;
  /** Cible visée par la combinaison (égal à somme, au centime). */
  cible: number;
  /** « feuille » : l'écart complet de la feuille de vérification — corriger
   *  ces écritures ramène l'écart à zéro. « hors_ran » : l'écart moins les
   *  RAN non considérés (462/467, 512/513, divers) — proposée quand aucune
   *  combinaison n'explique l'écart complet. */
  portee: "feuille" | "hors_ran";
}

/** Pièce du brouillard dont le mouvement net sur le périmètre d'une famille
 *  n'est pas nul : c'est une des pièces qui composent l'écart réel de la
 *  famille — celles qu'il faut corriger dans Sage pour la solder. */
export interface PieceEcart {
  journal: string;
  piece: string;
  date: string;
  libelle: string;
  /** Comptes du périmètre famille touchés par la pièce (ceux qui portent le net). */
  comptes: string;
  /** Tous les comptes de la pièce, y compris les contreparties hors périmètre. */
  comptesTous: string;
  /** Mouvement net de la pièce sur le périmètre famille (Débit − Crédit). */
  net: number;
  role: PieceEcartRole;
  /** La pièce est aussi signalée par le contrôle pièce à pièce (anomalies). */
  anomalie: boolean;
  /** Autres familles réelles dont cette pièce fait aussi l'écart (mauvais client). */
  aussiDans?: string[];
  /** La pièce fait partie de la combinaison exacte détectée : c'est une des
   *  écritures erronées qui composent l'écart (à corriger en priorité). */
  dansCombinaison?: boolean;
}

/** À-nouveau du journal RAN portant sur un compte de tiers réel (401000,
 *  460, 411) sans toucher le périmètre d'aucune famille : c'est une de ces
 *  écritures-là qu'il faut considérer (et non les RAN sur les comptes
 *  d'attente 462/467, qui ne sont pas des corrections à faire). */
export interface RanTiersPiece {
  journal: string;
  piece: string;
  date: string;
  libelle: string;
  /** Comptes de tiers (401000 / 460 / 411) touchés par la pièce. */
  comptesTiers: string;
  /** Tous les comptes de la pièce. */
  comptesTous: string;
  /** Mouvement net de la pièce sur ces comptes de tiers (Débit − Crédit). */
  net: number;
}

/** Vérification au niveau « famille » : l'entité propriétaire de la banque
 *  partagée regroupée avec les clients qui y sont soldés. C'est le niveau au
 * quel le comptable conclut dans les notes de la feuille « 2026 » du Verif BG
 *  (ex. FSS + MGS = 0, NACRE + DIR + RAHARIVOLA + KIDS = 0). */
export interface FamilleVerif {
  /** Entité parente (propriétaire de la banque partagée). */
  nom: string;
  /** Parent + enfants, l'ordre du parent vers les enfants. */
  membres: string[];
  appelDeFonds: number;
  tresorerie: number;
  /** Vérification famille : appel de fonds + trésorerie (0 = soldée). */
  ecart: number;
  soldee: boolean;
  /** Familles non soldées uniquement : les pièces du brouillard qui composent
   *  l'écart réel, triées par |net| décroissant. Règle du comptable : les RAN
   *  sur les comptes d'attente 462/467 (ainsi que sur 512/513 ou comptes
   *  divers) ne sont pas considérés — seuls les RAN portant sur 401000, 460
   *  ou 411 le sont, car ce sont les écritures à corriger dans Sage.
   *  Rapprochement : Σ pieces + ranNonConsidere = écart feuille. */
  pieces: PieceEcart[];
  /** Somme des nets (sur le périmètre famille) des pièces RAN NON considérées
   *  (462/467, 512/513, comptes divers) — la différence entre Σ pieces et
   *  l'écart de la feuille. */
  ranNonConsidere: number;
  /** Nombre de pièces RAN non considérées pour cette famille. */
  nbRanNonConsidere: number;
  /** Détection exacte : la(les) plus petite(s) combinaison(s) d'écritures
   *  erronées dont la somme redonne l'écart (1 à 4 écritures). Un écart peut
   *  venir de plusieurs écritures erronées, pas toujours d'une seule. */
  combinaisons: CombinaisonEcart[];
  /** Nombre de variantes distinctes trouvées à la taille minimale (au-delà
   *  des combinaisons retenues). */
  nbVariantesCombinaison: number;
  /** Aucune combinaison exacte trouvée (recherche bornée à 4 écritures). */
  combinaisonEchec: boolean;
}

export interface AnalysisResult {
  entites: EntitySummary[];
  /** Familles de clients soldés ensemble sur une banque partagée, triées par
   *  |écart| décroissant. Une famille soldée n'est pas un écart à corriger,
   *  même si ses membres pris isolément le semblent. */
  familles: FamilleVerif[];
  anomalies: Anomaly[];
  transferts: TransferProposal[];
  /** À-nouveaux du journal RAN portant sur 401000 / 460 / 411 sans toucher le
   *  périmètre d'aucune famille réelle : les RAN de tiers à considérer. */
  ranTiers: RanTiersPiece[];
  stats: {
    lignes: number;
    pieces: number;
    entites: number;
    soldees: number;
    familles: number;
    famillesSoldees: number;
    /** Total des pièces composant les écarts de famille réels (familles non soldées). */
    piecesAFixer: number;
    /** Nombre d'à-nouveaux de tiers (401000/460/411) hors périmètre familles. */
    ranTiers: number;
    /** Familles non soldées dont la combinaison exacte d'écritures erronées
     *  est détectée (la somme de la combinaison = l'écart). */
    famillesResolues: number;
    /** Familles non soldées sans combinaison exacte trouvée. */
    famillesNonResolues: number;
    /** Écritures erronées identifiées dans les combinaisons détectées. */
    piecesErronees: number;
    ecartTotal: number;
    parType: Record<AnomalyType, number>;
  };
}
