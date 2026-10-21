import * as XLSX from "xlsx";
import type { AnalysisResult } from "./analysis-types";
import { OPERATION_LABELS } from "./transfers";
import { SCHEMA_ECRITURES } from "./schema-ecritures";

const LABELS: Record<string, string> = {
  mauvais_client: "Mauvais client",
  hors_perimetre: "Contrepartie hors périmètre",
  compte_oublie: "Compte oublié",
  ecart_balance: "Écart brouillard / balance",
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

  const tr = result.transferts.flatMap((t) => {
    const statut =
      t.statut === "a_creer" ? "À créer" : t.statut === "existe_deja" ? "Déjà passée" : "Manuel";
    const base = {
      Opération: OPERATION_LABELS[t.type] ?? t.type,
      Client: t.entite,
      "Pièce source": t.piece,
      Date: t.date,
      Libellé: t.libelle,
      Statut: statut,
      Motif: t.motif,
    };
    if (!t.envoyeur.length)
      return [{ ...base, Côté: "", Journal: "", Compte: "", Débit: "", Crédit: "" }];
    return [
      ...t.envoyeur.map((l) => ({
        ...base,
        Côté: "Envoyeur",
        Journal: t.journalSource,
        Compte: l.compte,
        Débit: l.sens === "D" ? l.montant : "",
        Crédit: l.sens === "C" ? l.montant : "",
      })),
      ...t.receptionnaire.map((l) => ({
        ...base,
        Côté: "Réceptionnaire",
        Journal: t.journalDestination,
        Compte: l.compte,
        Débit: l.sens === "D" ? l.montant : "",
        Crédit: l.sens === "C" ? l.montant : "",
      })),
    ];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tr), "Comptes à comptes 580001");

  const schema = SCHEMA_ECRITURES.flatMap((e) =>
    e.lignes.map((l) => ({
      Journal: e.journal,
      Étape: `${e.etape}. ${e.titre}`,
      Sens: l.sens,
      Compte: l.complement ? `${l.compte} ${l.complement}` : l.compte,
      Rôle: l.note,
    })),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(schema), "Schéma des écritures");

  XLSX.writeFile(wb, `Anomalies_BG_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
