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
  comptes: {
    compte: string;
    solde: number;
    listeVerif: boolean;
    famille: "AF" | "TR";
    /** Banque partagée : affichée à titre informatif, exclue de l'écart (déjà comptée chez son propriétaire). */
    partage?: boolean;
  }[];
}

export interface AnalysisResult {
  entites: EntitySummary[];
  anomalies: Anomaly[];
  transferts: TransferProposal[];
  stats: {
    lignes: number;
    pieces: number;
    entites: number;
    soldees: number;
    ecartTotal: number;
    parType: Record<AnomalyType, number>;
  };
}
