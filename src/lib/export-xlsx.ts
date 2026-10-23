import * as XLSX from "xlsx";
import type { AnalysisResult } from "./analysis-types";
import { PIECE_ROLE_LABELS } from "./analysis-types";
import { OPERATION_LABELS } from "./transfers";
import { SCHEMA_ECRITURES, SCHEMA_ANNULATION_PAIEMENT } from "./schema-ecritures";
import { BANQUES_SOCIETES } from "./banques-societes";
import { decrireComptes, PLAN_COMPTABLE, PLAN_TIERS } from "./referentiel";

const LABELS: Record<string, string> = {
  mauvais_client: "Mauvais client",
  hors_perimetre: "Contrepartie hors périmètre",
  compte_oublie: "Compte oublié",
  ecart_balance: "Écart brouillard / balance",
};

/** Détail de la combinaison exacte détectée pour une famille : les écritures
 *  erronées jointes par « + » avec leur montant, somme = écart. */
function detailCombinaison(f: AnalysisResult["familles"][number]): string {
  if (f.combinaisons.length === 0) return f.combinaisonEchec ? "(non trouvée)" : "";
  return f.combinaisons
    .slice(0, 3)
    .map((c) => c.pieces.map((p) => `${p.journal} ${p.piece} (${p.net.toFixed(2)})`).join(" + "))
    .join("  |  ou  ");
}

export function exportAnomalies(result: AnalysisResult) {
  const wb = XLSX.utils.book_new();

  const synthese = result.entites.map((e) => ({
    Client: e.nom,
    Suffixe: e.suffixe,
    ...(e.famille ? { Famille: e.famille } : {}),
    "Solde appel de fonds": e.appelDeFonds,
    "Solde trésorerie": e.tresorerie,
    Écart: e.ecart,
    Statut: Math.abs(e.ecart) < 0.01 ? "Soldé" : "Non soldé",
    "Nb anomalies": e.anomalies,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(synthese), "Synthèse clients");

  const familles = result.familles.map((f) => ({
    Famille: f.nom,
    Membres: f.membres.join(" + "),
    "Solde appel de fonds": f.appelDeFonds,
    "Solde trésorerie": f.tresorerie,
    "Vérification (écart)": f.ecart,
    Statut: f.soldee ? "Soldée" : "Écart à corriger",
    "Pièces à corriger": f.pieces.length,
    "RAN non considérés (462/467, 512/513, divers)": f.nbRanNonConsidere,
    "Total RAN non considérés": f.ranNonConsidere,
    ...(f.soldee
      ? {}
      : {
          "Écritures erronées détectées": detailCombinaison(f),
          "Somme combinaison": f.combinaisons[0]?.somme ?? "",
          Portée:
            f.combinaisons.length === 0
              ? ""
              : f.combinaisons[0]!.portee === "feuille"
                ? "Écart feuille"
                : "Hors RAN non considérés",
          Variantes: f.nbVariantesCombinaison || "",
        }),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(familles), "Vérification familles");

  // Écarts de famille réels : les pièces qui composent chaque écart — les
  // écritures qu'il faut corriger dans Sage pour solder la famille. Règle
  // RAN : seuls les à-nouveaux portant sur 401000, 460 ou 411 sont listés ;
  // les RAN 462/467, 512/513 ou divers sont résumés sur « Vérification familles ».
  const piecesFamilles = result.familles
    .filter((f) => !f.soldee)
    .flatMap((f) =>
      f.pieces.map((p) => ({
        Famille: f.nom,
        Membres: f.membres.join(" + "),
        "Écart famille": f.ecart,
        Journal: p.journal,
        "N° pièce": p.piece,
        Date: p.date,
        Libellé: p.libelle,
        Rôle: PIECE_ROLE_LABELS[p.role],
        "Comptes périmètre": p.comptes,
        "Tous comptes": p.comptesTous,
        "Mouvement net": p.net,
        Anomalie: p.anomalie ? "Oui" : "",
        "Dans combinaison (écriture erronée)": p.dansCombinaison ? "Oui" : "",
        "Aussi dans": p.aussiDans?.join(", ") ?? "",
      })),
    );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(piecesFamilles),
    "Pièces écarts familles",
  );

  // Combinaisons exactes d'écritures erronées : pour chaque famille non
  // soldée, la(les) plus petite(s) combinaison(s) de pièces dont la somme
  // redonne exactement l'écart (l'écart peut être composé de plusieurs
  // écritures erronées, pas toujours d'une seule).
  const combinaisons = result.familles
    .filter((f) => !f.soldee)
    .flatMap((f): Record<string, string | number>[] =>
      f.combinaisons.length === 0
        ? [
            {
              Famille: f.nom,
              Membres: f.membres.join(" + "),
              "Écart feuille": f.ecart,
              "RAN non considérés": f.ranNonConsidere,
              Portée: "",
              Solution: "",
              "Nb écritures": "",
              Écritures: f.combinaisonEchec
                ? "(aucune combinaison exacte trouvée, 1 à 4 écritures)"
                : "",
              Somme: "",
            },
          ]
        : f.combinaisons.map((c, ci) => ({
            Famille: f.nom,
            Membres: f.membres.join(" + "),
            "Écart feuille": f.ecart,
            "RAN non considérés": f.ranNonConsidere,
            Portée: c.portee === "feuille" ? "Écart feuille" : "Hors RAN non considérés",
            Solution: `${ci + 1} / ${f.combinaisons.length}`,
            "Nb écritures": String(c.pieces.length),
            Écritures: c.pieces
              .map((p) => `${p.journal} ${p.piece} du ${p.date} — ${p.net.toFixed(2)}`)
              .join(" + "),
            Somme: c.somme,
          })),
    );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(combinaisons), "Combinaisons écarts");

  // À-nouveaux de tiers (401000 / 460 / 411) hors familles : les RAN de
  // tiers à considérer, par opposition aux RAN 462/467 non considérés.
  const ranTiers = result.ranTiers.map((p) => ({
    Journal: p.journal,
    "N° pièce": p.piece,
    Date: p.date,
    Libellé: p.libelle,
    "Comptes de tiers (401000/460/411)": p.comptesTiers,
    "Tous comptes": p.comptesTous,
    "Mouvement net tiers": p.net,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ranTiers), "RAN tiers 401000-460-411");

  const anomalies = result.anomalies.map((a) => ({
    Type: LABELS[a.type] ?? a.type,
    Client: a.entite,
    Journal: a.journal,
    "N° pièce": a.piece,
    Date: a.date,
    Libellé: a.libelle,
    Comptes: a.comptes,
    "Libellés comptes (plan)": decrireComptes(a.comptes, ", "),
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

  const schema = [...SCHEMA_ECRITURES, SCHEMA_ANNULATION_PAIEMENT].flatMap((e) =>
    e.lignes.map((l) => ({
      Journal: e.journal,
      Étape: `${e.etape}. ${e.titre}`,
      Sens: l.sens,
      Compte: l.complement ? `${l.compte} ${l.complement}` : l.compte,
      Rôle: l.note,
    })),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(schema), "Schéma des écritures");

  const banques = BANQUES_SOCIETES.map((b) => ({
    Journal: b.journal,
    Compte: b.compte,
    "Intitulé plan": b.intitule,
    Type: b.type,
    Opérateur: b.operateur ?? "",
    Société: b.societe,
    "Suffixe(s) client": b.suffixes.join(", "),
    Note: b.note ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(banques), "Banques des sociétés");

  const planComptable = PLAN_COMPTABLE.map((c) => ({
    "N° compte": c.numero,
    Intitulé: c.intitule,
    Nature: c.nature,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planComptable), "Plan comptable");

  const planTiers = PLAN_TIERS.map((t) => ({
    "Code tiers": t.code,
    Type: t.type,
    Intitulé: t.intitule,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planTiers), "Plan tiers");

  XLSX.writeFile(wb, `Anomalies_BG_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
