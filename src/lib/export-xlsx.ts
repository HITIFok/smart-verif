import * as XLSX from "xlsx";
import type { AnalysisResult } from "./analysis-types";

const LABELS: Record<string, string> = {
  mauvais_client: "Mauvais client",
  hors_perimetre: "Contrepartie hors périmètre",
  compte_oublie: "Compte oublié",
};

export function exportAnomalies(result: AnalysisResult) {
  const wb = XLSX.utils.book_new();

  const synthese = result.entites.map((e) => ({
    Client: e.nom,
    Suffixe: e.suffixe,
    "Solde appel de fonds": e.appelDeFonds,
    "Solde trésorerie": e.tresorerie,
    Écart: e.ecart,
    Statut: Math.abs(e.ecart) < 0.01 ? "Soldé" : "Non soldé",
    "Nb anomalies": e.anomalies,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(synthese), "Synthèse clients");

  const anomalies = result.anomalies.map((a) => ({
    Type: LABELS[a.type] ?? a.type,
    Client: a.entite,
    Journal: a.journal,
    "N° pièce": a.piece,
    Date: a.date,
    Libellé: a.libelle,
    Comptes: a.comptes,
    Montant: a.montant,
    Diagnostic: a.detail,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(anomalies), "Écritures à corriger");

  XLSX.writeFile(wb, `Anomalies_BG_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
