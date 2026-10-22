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
   *  l'écart réel, triées par |net| décroissant. La somme de leurs nets
   *  redonne exactement l'écart de la feuille de vérification. */
  pieces: PieceEcart[];
}

export interface AnalysisResult {
  entites: EntitySummary[];
  /** Familles de clients soldés ensemble sur une banque partagée, triées par
   *  |écart| décroissant. Une famille soldée n'est pas un écart à corriger,
   *  même si ses membres pris isolément le semblent. */
  familles: FamilleVerif[];
  anomalies: Anomaly[];
  transferts: TransferProposal[];
  stats: {
    lignes: number;
    pieces: number;
    entites: number;
    soldees: number;
    familles: number;
    famillesSoldees: number;
    /** Total des pièces composant les écarts de famille réels (familles non soldées). */
    piecesAFixer: number;
    ecartTotal: number;
    parType: Record<AnomalyType, number>;
  };
}
