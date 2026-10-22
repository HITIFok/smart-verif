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
    ecartTotal: number;
    parType: Record<AnomalyType, number>;
  };
}
