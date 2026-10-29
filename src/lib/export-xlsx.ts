import * as XLSX from "xlsx";
import type { AnalysisResult } from "./analysis-types";
import { PIECE_ROLE_LABELS } from "./analysis-types";
import { OPERATION_LABELS } from "./transfers";
import {
  STATUT_LABELS as STATUT_RAPPROCHEMENT_R,
  TYPE_CONTROLE_LABELS as TYPE_CONTROLE_LABELS_R,
} from "./rapprochement";
import { STATUT_VALIDATION_LABELS as STATUT_VALIDATION_R } from "./validation";
import {
  construireDemandesPieces,
  construireDiagnostics,
  TYPE_DIAGNOSTIC_LABELS as TYPE_DIAGNOSTIC_LABELS_R,
} from "./diagnostics";
import {
  SCHEMA_ECRITURES,
  SCHEMA_ANNULATION_PAIEMENT,
  SCHEMA_FRAIS_BANCAIRES,
} from "./schema-ecritures";
import { BANQUES_SOCIETES } from "./banques-societes";
import { decrireComptes, PLAN_COMPTABLE, PLAN_TIERS } from "./referentiel";

const LABELS: Record<string, string> = {
  mauvais_client: "Mauvais client",
  hors_perimetre: "Contrepartie hors périmètre",
  compte_oublie: "Compte oublié",
  ecart_balance: "Écart brouillard / balance",
};

/** Format Excel des montants : deux décimales, séparateurs selon la locale
 *  d'Excel (espace fine + virgule sur un poste en français). */
const FMT_MONTANT = "#,##0.00";

/** Mise en forme d'une feuille produite par json_to_sheet (brute) : format
 *  monétaire sur les colonnes de montants, largeurs de colonnes lisibles. */
function mettreEnForme(
  ws: XLSX.WorkSheet | undefined,
  options: { montants?: string[]; largeurs?: Record<string, number> },
) {
  if (!ws || !ws["!ref"]) return;
  const plage = XLSX.utils.decode_range(ws["!ref"]);
  const indexDe = new Map<number, string>();
  for (let c = plage.s.c; c <= plage.e.c; c++) {
    const cellule = ws[XLSX.utils.encode_cell({ r: plage.s.r, c })];
    if (cellule && cellule.v != null) indexDe.set(c, String(cellule.v));
  }
  for (const nom of options.montants ?? []) {
    for (const [c, titre] of indexDe) {
      if (titre !== nom) continue;
      for (let r = plage.s.r + 1; r <= plage.e.r; r++) {
        const cellule = ws[XLSX.utils.encode_cell({ r, c })];
        if (cellule && cellule.t === "n") cellule.z = FMT_MONTANT;
      }
    }
  }
  if (options.largeurs) {
    ws["!cols"] = [...indexDe.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, titre]) => ({ wch: options.largeurs?.[titre] ?? 14 }));
  }
}

/** Détail de LA combinaison exacte retenue pour une famille : les écritures
 *  jointes par « + » avec leur montant, somme = écart. Si plusieurs
 *  décompositions exactes coexistent (variantes), l'attribution est ambiguë :
 *  les pièces sont des candidates, pas des écritures prouvées erronées. */
function detailCombinaison(f: AnalysisResult["familles"][number]): string {
  if (f.combinaisons.length === 0)
    return f.combinaisonEchec
      ? `(résidu des écritures non soldées — lettrage : ${f.pieces.filter((p) => !p.lettree && !p.lettreeSage).length} non soldée(s) / ${f.pieces.filter((p) => p.lettreeSage).length} soldée(s) Sage / ${f.pieces.filter((p) => p.lettree).length} compensée(s))`
      : "";
  const c = f.combinaisons[0]!;
  const pieces = c.pieces.map((p) => `${p.journal} ${p.piece} (${p.net.toFixed(2)})`).join(" + ");
  const ambigue = (f.nbVariantesCombinaison ?? 0) > 1;
  return ambigue
    ? `[attribution ambiguë — ${f.nbVariantesCombinaison} décompositions exactes possibles, candidates à rapprocher dans Sage] ${pieces}`
    : pieces;
}

export function exportAnomalies(result: AnalysisResult) {
  const wb = XLSX.utils.book_new();

  const synthese = result.entites.map((e) => ({
    Client: e.nom,
    Suffixe: e.suffixe,
    // Toujours présent (même vide) : l'ordre des colonnes de json_to_sheet
    // suit la première occurrence de chaque clé — en conditionnel, « Famille »
    // se retrouvait en toute fin de feuille.
    Famille: e.famille ?? "",
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
    "Pièces à corriger": f.pieces.filter((p) => !p.lettree && !p.lettreeSage).length,
    "Écritures soldées (lettrage Sage)": f.pieces.filter((p) => p.lettreeSage).length,
    "Écritures compensées (montant opposé)": f.pieces.filter((p) => p.lettree).length,
    "Nb pièces RAN non considérés": f.nbRanNonConsidere,
    "Total RAN non considérés": f.ranNonConsidere,
    ...(f.soldee
      ? {}
      : {
          "Écritures désignées (combinaison = écart)": detailCombinaison(f),
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
  // Lettrage : les écritures soldées ne sont pas à corriger — soldées par le
  // lettrage Sage (preuve : groupes équilibrés) ou compensées (montant
  // exactement opposé). « Variantes (n°) » : les décompositions exactes
  // contenant la pièce — en attribution ambiguïe, la pièce peut apparaître
  // dans plusieurs variantes candidates (1 = la présentée, la plus plausible).
  const piecesFamilles = result.familles
    .filter((f) => !f.soldee)
    .flatMap((f) => {
      const clePiece = (p: { journal: string; piece: string; date: string }) =>
        `${p.journal}|${p.piece}|${p.date}`;
      const variantesDe = new Map<string, number[]>();
      (f.variantes ?? f.combinaisons).forEach((v, i) => {
        for (const p of v.pieces) {
          const k = clePiece(p);
          const arr = variantesDe.get(k);
          if (arr) arr.push(i + 1);
          else variantesDe.set(k, [i + 1]);
        }
      });
      return f.pieces.map((p) => ({
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
        "Soldée (lettrage Sage)": p.lettreeSage ? "Oui" : "",
        "Compensée (montant opposé)": p.lettree ? "Oui" : "",
        "Dans combinaison (candidate si ambigu)": p.dansCombinaison ? "Oui" : "",
        "Variantes (n°)": variantesDe.get(clePiece(p))?.join(", ") ?? "",
        "Aussi dans": p.aussiDans?.join(", ") ?? "",
      }));
    });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(piecesFamilles),
    "Pièces écarts familles",
  );

  // Combinaisons exactes d'écritures erronées (méthode du comptable) :
  // lettrage Sage d'abord (pièces régularisées jamais candidates), puis
  // compensation des montants exactement opposés, puis plus petite
  // combinaison (1 à 4) parmi les NON soldées dont la somme redonne
  // exactement l'écart — au plus UNE solution retenue par famille (les
  // variantes équivalentes sont alternatives), sinon échec honnête :
  // l'écart est le résidu des écritures non soldées.
  const combinaisons = result.familles
    .filter((f) => !f.soldee)
    .flatMap((f): Record<string, string | number>[] => {
      const base = {
        Famille: f.nom,
        Membres: f.membres.join(" + "),
        "Écart feuille": f.ecart,
        "RAN non considérés": f.ranNonConsidere,
        "Non soldées": f.pieces.filter((p) => !p.lettree && !p.lettreeSage).length,
        "Soldées (lettrage Sage)": f.pieces.filter((p) => p.lettreeSage).length,
        "Compensées (montant opposé)": f.pieces.filter((p) => p.lettree).length,
      };
      const c = f.combinaisons[0];
      if (!c) {
        return [
          {
            ...base,
            Portée: "",
            "Nb écritures": "",
            Écritures: f.combinaisonEchec
              ? "(aucune combinaison de 1 à 4 écritures non soldées — l'écart est le résidu des non soldées, à corriger ensemble)"
              : "",
            Somme: "",
            Variantes: "",
          },
        ];
      }
      return [
        {
          ...base,
          Portée: c.portee === "feuille" ? "Écart feuille" : "Hors RAN non considérés",
          "Nb écritures": String(c.pieces.length),
          Écritures: c.pieces
            .map((p) => `${p.journal} ${p.piece} du ${p.date} — ${p.net.toFixed(2)}`)
            .join(" + "),
          Somme: c.somme,
          Variantes: f.nbVariantesCombinaison,
        },
      ];
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(combinaisons), "Combinaisons écarts");

  // Variantes d'attribution : quand PLUSIEURS décompositions exactes d'un
  // écart coexistent, aucune ne peut être désignée erronée avec certitude —
  // toutes celles retenues sont listées ici (la présentée d'abord, la plus
  // plausible : écritures suspectes d'abord, masse la plus faible ensuite)
  // pour que le comptable rapproche chaque candidate dans Sage et reconnaisse
  // celle qui correspond à une vraie anomalie (ou conclue à un résidu).
  const variantes = result.familles
    .filter((f) => !f.soldee && (f.nbVariantesCombinaison ?? 0) > 1)
    .flatMap((f) => {
      const liste = f.variantes ?? f.combinaisons;
      const nbTotal = f.nbVariantesCombinaison;
      return liste.map((v, i) => ({
        Famille: f.nom,
        Membres: f.membres.join(" + "),
        "Écart feuille": f.ecart,
        Portée: v.portee === "feuille" ? "Écart feuille" : "Hors RAN non considérés",
        Variante: `${i + 1} / ${nbTotal}`,
        "Présentée d'abord": i === 0 ? "Oui" : "",
        "Nb écritures": v.pieces.length,
        Écritures: v.pieces
          .map((p) => `${p.journal} ${p.piece} du ${p.date} — ${p.net.toFixed(2)}`)
          .join(" + "),
        Somme: v.somme,
      }));
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(variantes), "Variantes d'attribution");

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

  const schema = [...SCHEMA_ECRITURES, SCHEMA_ANNULATION_PAIEMENT, SCHEMA_FRAIS_BANCAIRES].flatMap(
    (e) =>
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

  // Rapprochement explicable — règles A/B/C : fiches attendu/rapproché/restant
  // avec statut opposable, confiance justifiée et références de lignes.
  const rapprochements = result.rapprochements.map((c) => ({
    ID: c.id,
    Contrôle: TYPE_CONTROLE_LABELS_R[c.type],
    Société: c.societe,
    Journal: c.journal,
    "Compte général": c.compteGeneral,
    "Compte tiers": c.compteTiers,
    Pièce: c.refPiece,
    Facture: c.refFacture,
    Date: c.date,
    Libellé: c.libelle,
    "Montant attendu": c.montantAttendu,
    "Montant rapproché": c.montantRapproche,
    "Écart restant": c.ecartRestant,
    Sens: c.sens,
    Statut: STATUT_RAPPROCHEMENT_R[c.statut],
    Explication: c.explication,
    Confiance: c.confiance,
    "Justification de la confiance": c.justificationConfiance,
    "Écritures sources": c.lignes
      .map((l) => `L${l.ligne} ${l.journal} ${l.piece} (${l.compte})`)
      .join(" ; "),
    "Action recommandée": c.action,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rapprochements), "Rapprochement A-B-C");

  // Mode de validation : reproduction des écarts de référence de la feuille
  // « 2026 » (lignes Vérification), résiduels au centime.
  if (result.validation) {
    const validation = result.validation.ecarts.map((e) => ({
      Bloc: e.ecart.bloc,
      "Ligne feuille": e.ecart.ligne,
      "Type de contrôle": e.ecart.type === "famille" ? "Famille (latéral)" : "Entité",
      "Montant référence": e.ecart.montant,
      "Objet application": e.objet,
      "Écart calculé": e.montantCalcule,
      Résiduel: e.residuel,
      Statut: STATUT_VALIDATION_R[e.statut],
      "Écritures sources": e.nbEcritures,
      Note: e.note ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(validation), "Validation 2026");
    const totaux = [
      { Indicateur: "Écarts de référence", Valeur: result.validation.totaux.nbReferences },
      { Indicateur: "Expliqués exactement", Valeur: result.validation.totaux.nbExpliquesExact },
      { Indicateur: "Partiellement expliqués", Valeur: result.validation.totaux.nbPartiels },
      {
        Indicateur: "Expliqués ailleurs (documenté)",
        Valeur: result.validation.totaux.nbAilleurs,
      },
      { Indicateur: "Non expliqués", Valeur: result.validation.totaux.nbNonExpliques },
      {
        Indicateur: "Correspondances incorrectes",
        Valeur: result.validation.totaux.nbIncorrects,
      },
      {
        Indicateur: "Écritures sources utilisées",
        Valeur: result.validation.totaux.nbEcrituresSources,
      },
      {
        Indicateur: "Réutilisations conflictuelles",
        Valeur: result.validation.totaux.nbReutilisationsConflit,
      },
      {
        Indicateur: "Montant total des références",
        Valeur: result.validation.totaux.montantTotalReferences,
      },
      {
        Indicateur: "Montant total des résiduels",
        Valeur: result.validation.totaux.montantTotalResiduel,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totaux), "Validation totaux");

    // Couche diagnostic (mission §6) : un diagnostic typé par contrôle non
    // exact — sépare constat, preuves, hypothèses, limites et action.
    const diagnostics = construireDiagnostics(result);
    const diagsSheet = diagnostics.map((d) => ({
      Bloc: d.bloc,
      "Ligne feuille": d.ligne,
      "Type de contrôle": d.typeControle === "famille" ? "Famille (latéral)" : "Entité",
      Diagnostic: TYPE_DIAGNOSTIC_LABELS_R[d.type],
      "Type diagnostic": d.type,
      "Types secondaires": d.typesSecondaires.join(" + "),
      Confiance: d.confiance,
      "Montant référence": d.montantReference,
      "Écart calculé": d.montantCalcule,
      "Écart signé": d.ecartSigne,
      "Divergences rattachées": d.composants
        .map((c) => `${c.compte} (${c.contribution.toLocaleString("fr-FR")} Ar)`)
        .join(" ; "),
      "Écart restant non rattaché": d.ecartRestant,
      "Éléments confirmés": d.elementsConfirmes.join(" | "),
      "Hypothèses d'audit": d.preuvesAudit.map((p) => `${p.source} — ${p.detail}`).join(" | "),
      Limites: d.elementsManquants.join(" | "),
      "Action recommandée": d.actionRecommandee,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diagsSheet), "Diagnostics 8 écarts");

    // Mission §9 : liste exportable des pièces comptables à demander.
    const demandes = construireDemandesPieces(diagnostics, result).map((d, i) => ({
      "N°": i + 1,
      Contrôle: d.controle,
      "Ligne feuille": d.ligne || "",
      "Type diagnostic": d.type,
      "Pièce à demander": d.piece,
      Motif: d.motif,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(demandes), "Pièces à demander");
  }

  // Mise en forme des montants et des largeurs de colonnes (json_to_sheet
  // produit du brut : sans cela, les Ariary s'affichent sans séparateurs).
  mettreEnForme(wb.Sheets["Synthèse clients"], {
    montants: ["Solde appel de fonds", "Solde trésorerie", "Écart"],
    largeurs: {
      Client: 30,
      Suffixe: 8,
      "Solde appel de fonds": 20,
      "Solde trésorerie": 20,
      Écart: 20,
      Statut: 10,
      "Nb anomalies": 12,
      Famille: 22,
    },
  });
  mettreEnForme(wb.Sheets["Vérification familles"], {
    montants: [
      "Solde appel de fonds",
      "Solde trésorerie",
      "Vérification (écart)",
      "Total RAN non considérés",
      "Somme combinaison",
    ],
    largeurs: {
      Famille: 20,
      Membres: 44,
      "Solde appel de fonds": 20,
      "Solde trésorerie": 20,
      "Vérification (écart)": 20,
      Statut: 16,
      "Pièces à corriger": 11,
      "Écritures soldées (lettrage Sage)": 14,
      "Écritures compensées (montant opposé)": 14,
      "Nb pièces RAN non considérés": 13,
      "Total RAN non considérés": 20,
      "Écritures désignées (combinaison = écart)": 80,
      "Somme combinaison": 18,
      Portée: 13,
      Variantes: 10,
    },
  });
  mettreEnForme(wb.Sheets["Pièces écarts familles"], {
    montants: ["Écart famille", "Mouvement net"],
    largeurs: {
      Famille: 14,
      Membres: 44,
      "Écart famille": 16,
      Journal: 9,
      "N° pièce": 9,
      Date: 11,
      Libellé: 62,
      Rôle: 18,
      "Comptes périmètre": 18,
      "Tous comptes": 34,
      "Mouvement net": 15,
      Anomalie: 9,
      "Soldée (lettrage Sage)": 12,
      "Compensée (montant opposé)": 12,
      "Dans combinaison (candidate si ambigu)": 14,
      "Variantes (n°)": 13,
      "Aussi dans": 28,
    },
  });
  mettreEnForme(wb.Sheets["Variantes d'attribution"], {
    montants: ["Écart feuille", "Somme"],
    largeurs: {
      Famille: 16,
      Membres: 40,
      "Écart feuille": 16,
      Portée: 22,
      Variante: 10,
      "Présentée d'abord": 12,
      "Nb écritures": 11,
      Écritures: 90,
      Somme: 16,
    },
  });
  mettreEnForme(wb.Sheets["Combinaisons écarts"], {
    montants: ["Écart feuille", "RAN non considérés", "Somme"],
    largeurs: {
      Famille: 16,
      Membres: 40,
      "Écart feuille": 16,
      "RAN non considérés": 18,
      "Non soldées": 12,
      "Soldées (lettrage Sage)": 14,
      "Compensées (montant opposé)": 14,
      Portée: 22,
      "Nb écritures": 11,
      Écritures: 90,
      Somme: 16,
      Variantes: 10,
    },
  });
  mettreEnForme(wb.Sheets["RAN tiers 401000-460-411"], {
    montants: ["Mouvement net tiers"],
    largeurs: {
      Journal: 9,
      "N° pièce": 9,
      Date: 11,
      Libellé: 52,
      "Comptes de tiers (401000/460/411)": 26,
      "Tous comptes": 30,
      "Mouvement net tiers": 18,
    },
  });
  mettreEnForme(wb.Sheets["Écritures à corriger"], {
    montants: ["Montant"],
    largeurs: {
      Type: 22,
      Client: 22,
      Journal: 9,
      "N° pièce": 9,
      Date: 11,
      Libellé: 52,
      Comptes: 30,
      "Libellés comptes (plan)": 44,
      Montant: 16,
      Diagnostic: 56,
    },
  });
  mettreEnForme(wb.Sheets["Comptes à comptes 580001"], {
    montants: ["Débit", "Crédit"],
    largeurs: {
      Opération: 18,
      Client: 20,
      "Pièce source": 11,
      Date: 11,
      Libellé: 46,
      Statut: 11,
      Motif: 42,
      Côté: 14,
      Journal: 9,
      Compte: 10,
      Débit: 15,
      Crédit: 15,
    },
  });
  mettreEnForme(wb.Sheets["Schéma des écritures"], {
    largeurs: { Journal: 9, Étape: 34, Sens: 8, Compte: 44, Rôle: 52 },
  });
  mettreEnForme(wb.Sheets["Banques des sociétés"], {
    largeurs: {
      Journal: 9,
      Compte: 9,
      "Intitulé plan": 22,
      Type: 12,
      Opérateur: 10,
      Société: 22,
      "Suffixe(s) client": 16,
      Note: 60,
    },
  });
  mettreEnForme(wb.Sheets["Plan comptable"], {
    largeurs: { "N° compte": 11, Intitulé: 52, Nature: 12 },
  });
  mettreEnForme(wb.Sheets["Plan tiers"], {
    largeurs: { "Code tiers": 16, Type: 12, Intitulé: 56 },
  });
  mettreEnForme(wb.Sheets["Rapprochement A-B-C"], {
    montants: ["Montant attendu", "Montant rapproché", "Écart restant"],
    largeurs: {
      ID: 6,
      Contrôle: 38,
      Société: 22,
      Journal: 10,
      "Compte général": 13,
      "Compte tiers": 18,
      Pièce: 10,
      Facture: 16,
      Date: 11,
      Libellé: 40,
      "Montant attendu": 16,
      "Montant rapproché": 16,
      "Écart restant": 14,
      Sens: 8,
      Statut: 26,
      Explication: 80,
      Confiance: 10,
      "Justification de la confiance": 70,
      "Écritures sources": 50,
      "Action recommandée": 70,
    },
  });
  if (wb.Sheets["Validation 2026"]) {
    mettreEnForme(wb.Sheets["Validation 2026"], {
      montants: ["Montant référence", "Écart calculé", "Résiduel"],
      largeurs: {
        Bloc: 24,
        "Ligne feuille": 11,
        "Type de contrôle": 17,
        "Montant référence": 17,
        "Objet application": 44,
        "Écart calculé": 16,
        Résiduel: 13,
        Statut: 28,
        "Écritures sources": 12,
        Note: 80,
      },
    });
    mettreEnForme(wb.Sheets["Validation totaux"], {
      montants: ["Valeur"],
      largeurs: { Indicateur: 34, Valeur: 18 },
    });
  }

  XLSX.writeFile(wb, `Anomalies_BG_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
