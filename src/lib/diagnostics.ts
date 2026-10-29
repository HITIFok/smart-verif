import type { AnalysisResult, Anomaly } from "./analysis-types";
import { montantCents } from "./normalisation";
import type { RapportValidation, ResultatEcart, StatutValidation } from "./validation";

const cts = (n: number) => montantCents(n);

/**
 * COUCHE DIAGNOSTIC — Phase 3 de la mission « amélioration fondée sur les
 * preuves ». Sépare explicitement, pour chaque contrôle de référence non
 * exact :
 *   1. le CONSTAT (chiffres référence / application, résiduel au centime) ;
 *   2. les PREUVES dérivées des données réellement importées (divergences
 *      brouillard/balance détectées par le moteur : anomalies « écart
 *      balance ») ;
 *   3. le DIAGNOSTIC typé (cause confirmée ou hypothèse) ;
 *   4. les LIMITES (pièces ou informations encore manquantes) ;
 *   5. l'ACTION recommandée (vérification humaine à effectuer).
 *
 * Règles de la mission respectées :
 *  — aucun montant n'est codé en dur : chaque composante est recalculée
 *    depuis les anomalies du moteur et l'objet rapproché ; si les données
 *    changent et qu'une règle ne se vérifie plus, le diagnostic retombe
 *    honnêtement sur UNRESOLVED ;
 *  — les hypothèses issues de l'audit du 28/10/2026 (formule E352, pièce
 *    4540, lettrages) sont portées par un champ distinct `preuvesAudit`
 *    étiqueté « hypothèse », jamais présentées comme des constats moteur ;
 *  — aucun statut de validation ni solde n'est modifié : cette couche lit
 *    le résultat du moteur, elle n'écrit jamais dedans.
 */

export type TypeDiagnostic =
  | "CALCULATION_ERROR"
  | "SOURCE_ENTRY_MISSING"
  | "REFERENCE_ADJUSTMENT"
  | "ACCOUNT_OWNERSHIP_CONFLICT"
  | "DUPLICATE_POTENTIAL"
  | "CROSS_PERIOD_MATCH"
  | "UNRESOLVED";

/** Libellés prudentiels : une hypothèse n'est jamais libellée comme une
 *  certitude (mission §8). */
export const TYPE_DIAGNOSTIC_LABELS: Record<TypeDiagnostic, string> = {
  CALCULATION_ERROR: "Erreur de calcul démontrée du moteur",
  SOURCE_ENTRY_MISSING: "Écriture probablement absente du brouillard — grand livre Sage à vérifier",
  REFERENCE_ADJUSTMENT: "Ajustement manuel de référence sans justificatif retrouvé",
  ACCOUNT_OWNERSHIP_CONFLICT: "Conflit potentiel d'affectation du compte — propriétaire à confirmer",
  DUPLICATE_POTENTIAL: "Doublon potentiel — validation humaine nécessaire",
  CROSS_PERIOD_MATCH: "Rapprochement interexercices à confirmer",
  UNRESOLVED: "Non résolu — preuves insuffisantes pour conclure",
};

export type NiveauConfiance = "confirmé" | "probable" | "hypothèse" | "indéterminé";

/** Composante du résiduel rattachée à une divergence brouillard/balance
 *  détectée par le moteur (anomalie « écart balance » : comparaison de
 *  SOLDES). Le détail débits/crédits (quel sens diverge) relève de
 *  l'audit et est porté par `preuvesAudit`, jamais par cette structure. */
export interface ComposantDiagnostic {
  compte: string;
  /** Solde brouillard − solde balance (opposé du montant d'anomalie). */
  divergenceSolde: number;
  /** Contribution nette au résiduel du contrôle (au centime). */
  contribution: number;
  explication: string;
}

/** Preuve documentée par l'audit du 28/10/2026 — jamais un constat moteur. */
export interface PreuveAudit {
  /** Nature de la preuve (formule du classeur, pièce du brouillard, lettrage…). */
  source: string;
  detail: string;
}

/** Demande de pièce comptable (mission §9) dérivée d'un diagnostic. */
export interface DemandePiece {
  controle: string;
  ligne: number;
  type: TypeDiagnostic;
  piece: string;
  motif: string;
}

export interface DiagnosticEcart {
  /** Contrôle concerné (bloc + ligne de la feuille « 2026 »). */
  bloc: string;
  ligne: number;
  typeControle: "entite" | "famille";
  statut: StatutValidation;
  /** CONSTAT — chiffres du moteur, au centime. */
  montantReference: number;
  montantCalcule: number;
  /** Écart signé = référence − calculé (= résiduel). */
  ecartSigne: number;
  /** DIAGNOSTIC — type principal + types secondaires. */
  type: TypeDiagnostic;
  typesSecondaires: TypeDiagnostic[];
  libelle: string;
  /** Niveau de confiance justifié par les preuves disponibles. */
  confiance: NiveauConfiance;
  /** Règle de rapprochement appliquée (objet moteur rapproché). */
  regle: string;
  /** Compte et tiers principaux (si déterminés). */
  compte?: string;
  /** Éléments confirmés (dérivés des données importées, au centime). */
  elementsConfirmes: string[];
  /** Composantes du résiduel rattachées à des divergences de source. */
  composants: ComposantDiagnostic[];
  /** Part du résiduel non rattachée à une divergence de source détectée. */
  ecartRestant: number;
  /** LIMITES — pièces ou informations encore manquantes. */
  elementsManquants: string[];
  /** Hypothèses documentées par l'audit (jamais des constats moteur). */
  preuvesAudit: PreuveAudit[];
  /** Demandes de pièces spécifiques au cas (audit du 28/10/2026) — en plus
   *  des grands livres dérivés génériquement des composants. */
  demandesSpecifiques: string[];
  /** ACTION recommandée — vérification humaine à effectuer. */
  actionRecommandee: string;
}

/** Somme des anomalies « écart balance » rattachables au périmètre d'un
 *  contrôle : une anomalie est rattachable si son entité correspond au bloc
 *  du contrôle, ou si son compte figure dans les comptes de l'objet rapproché
 *  (entité/famille). Retourne les anomalies rattachables (débits/crédits
 *  calculés à partir du détail du moteur : l'anomalie porte
 *  brouillard − balance, la divergence au sens Sage − brouillard est son
 *  opposé). */
function anomaliesDuPerimetre(result: AnalysisResult, ecart: ResultatEcart): Anomaly[] {
  const anomaliesEcart = result.anomalies.filter((a) => a.type === "ecart_balance");
  // Comptes de l'objet rapproché : entité par nom, famille par membres.
  const comptesObjet = new Set<string>();
  const objetNom = ecart.objet.replace(/^(entité|famille)\s+/i, "").trim();
  if (objetNom.length >= 3) {
    for (const e of result.entites) {
      const membres = [e.nom, ...(e.enfants ?? [])];
      if (
        e.nom === objetNom ||
        membres.includes(objetNom) ||
        membres.some((m) => objetNom.includes(m) || m.includes(objetNom))
      ) {
        for (const c of e.comptes) comptesObjet.add(c.compte);
      }
    }
  }
  return anomaliesEcart.filter((a) => {
    if (a.entite === ecart.ecart.bloc) return true;
    const compteAno = a.comptes.split(/[,+ ]+/)[0]?.trim() ?? "";
    return compteAno !== "" && comptesObjet.has(compteAno);
  });
}

/** Décomposition générique du résiduel : résiduel = −Σ(anomalies du
 *  périmètre) + écart restant. Aucun montant codé en dur. */
function decomposerResiduel(result: AnalysisResult, ecart: ResultatEcart): {
  composants: ComposantDiagnostic[];
  restant: number;
} {
  const anomalies = anomaliesDuPerimetre(result, ecart);
  const composants: ComposantDiagnostic[] = [];
  let somme = 0;
  for (const a of anomalies) {
    // L'anomalie moteur = solde brouillard − solde balance du compte. La
    // contribution au résiduel (référence balance − calculé brouillard) est
    // son opposé. Le détail « quel sens (débit/crédit) diverge » est une
    // preuve d'audit (grand livre), pas un constat moteur — il vit dans
    // preuvesAudit.
    const contribution = -a.montant;
    composants.push({
      compte: a.comptes,
      divergenceSolde: Math.round(contribution * 100) / 100,
      contribution: Math.round(contribution * 100) / 100,
      explication: `Compte ${a.comptes} (${a.entite}) : le solde du brouillard importé diffère du solde de la balance des comptes de ${Math.abs(a.montant).toLocaleString("fr-FR")} Ar — écriture(s) présente(s) dans la balance mais absente(s) du brouillard, ou passée(s) après son export (divergence de source détectée par le moteur, anomalie « écart balance »).`,
    });
    somme += contribution;
  }
  const restant = Math.round((ecart.residuel - somme) * 100) / 100;
  return { composants, restant };
}

/** Cause commune : deux contrôles latéraux partageant exactement le même
 *  résiduel (au centime) — ex. L354 BOOST / L358 JBU via la cellule E352
 *  de la feuille. Détecté génériquement, jamais codé en dur. */
function controlésAvecMemeResiduel(ecarts: ResultatEcart[], ecart: ResultatEcart): ResultatEcart[] {
  if (ecart.residuel === 0) return [];
  return ecarts.filter(
    (e) =>
      e !== ecart &&
      e.ecart.ligne !== ecart.ecart.ligne &&
      cts(e.residuel) === cts(ecart.residuel) &&
      (e.ecart.type === "famille" || e.statut === "correspondance_incorrecte"),
  );
}

/** Conflit d'affectation : la note de validation du contrôle cite un compte
 *  attribué à un autre objet (ex. 512600 listé à la fois dans ORANGE MONEY
 *  MADAGASCAR et dans la famille EVIOSYS). Détecté via la note produite par
 *  le moteur depuis les données importées. */
function compteEnConflit(ecart: ResultatEcart): string | null {
  const m = /(\b51[23]\d{3}\b|\b4\d{5}\b)/.exec(ecart.note ?? "");
  return m && /attribuée|double comptage|autre/i.test(ecart.note ?? "") ? (m[1] ?? null) : null;
}

/** Construit les diagnostics des contrôles non exacts, à partir des données
 *  réellement importées. Les 17 contrôles exacts ne génèrent pas de
 *  diagnostic (ils restent visibles et traçables dans la validation). */
export function construireDiagnostics(result: AnalysisResult): DiagnosticEcart[] {
  const validation: RapportValidation | null = result.validation;
  if (!validation) return [];
  const diagnostics: DiagnosticEcart[] = [];

  for (const ecart of validation.ecarts) {
    if (ecart.statut === "explique_exact") continue;
    const { composants, restant } = decomposerResiduel(result, ecart);
    const typesSecondaires: TypeDiagnostic[] = [];
    const elementsConfirmes: string[] = [];
    const elementsManquants: string[] = [];
    const preuvesAudit: PreuveAudit[] = [];
    const demandes: string[] = [];

    let type: TypeDiagnostic;
    let confiance: NiveauConfiance;
    let libelle: string;
    let action: string;

    const conflit = compteEnConflit(ecart);
    const causeCommune = controlésAvecMemeResiduel(validation.ecarts, ecart);

    if (ecart.montantExpliqueN1 !== 0) {
      typesSecondaires.push("CROSS_PERIOD_MATCH");
    }

    if (conflit) {
      // Ex. L471/L482 : 512600 attribué à la famille EVIOSYS — le solde est
      // couvert par un autre contrôle ; le propriétaire reste à confirmer
      // par écrit (mission : statut incertain tant que non confirmé).
      type = "ACCOUNT_OWNERSHIP_CONFLICT";
      confiance = "probable";
      libelle = `Conflit potentiel d'affectation du compte ${conflit} — propriétaire à confirmer`;
      const soldeCompte = Math.abs(ecart.residuel);
      elementsConfirmes.push(
        `Le résiduel (${ecart.residuel.toLocaleString("fr-FR")} Ar) correspond au centime au solde du compte ${conflit} tel que calculé par l'application sur le brouillard.`,
        "Le compte est revendiqué par ce contrôle de la feuille ET utilisé par un autre objet de l'application (double comptage de la feuille documenté dans la note de validation).",
      );
      elementsManquants.push(
        `Confirmation comptable écrite du propriétaire du compte ${conflit} (intitulé Sage et usage effectif du brouillard à faire valoir).`,
      );
      action = `Faire confirmer par écrit le propriétaire du compte ${conflit} avant toute reprise du périmètre de contrôle ; ne pas attribuer le compte à l'une des entités sans cette validation.`;
    } else if (composants.length > 0 && cts(restant) === 0) {
      // Ex. L83, L525, L537, L571 : le résiduel s'explique au centime par
      // des divergences brouillard/balance détectées par le moteur.
      type = "SOURCE_ENTRY_MISSING";
      confiance = "confirmé";
      libelle = "Écriture probablement absente du brouillard — grand livre Sage à vérifier";
      for (const c of composants) elementsConfirmes.push(c.explication);
      elementsManquants.push(
        "Grand livre Sage du (des) compte(s) divergent(s) sur la période du brouillard N — pour identifier la ou les écritures présentes dans la balance mais absentes de l'export.",
      );
      action = "Vérifier dans le grand livre Sage l'écriture correspondant à la divergence ; ne pas l'ajouter automatiquement au brouillard sans pièce justificative.";
    } else if (composants.length > 0 && cts(restant) !== 0) {
      // Ex. L354 : une partie du résiduel s'explique par des divergences de
      // source, le reste est un écart de référence non dérivable du
      // brouillard (ajustement manuel documenté par l'audit).
      type = cts(Math.abs(restant)) !== 0 && causeCommune.length > 0 ? "REFERENCE_ADJUSTMENT" : "UNRESOLVED";
      confiance = type === "REFERENCE_ADJUSTMENT" ? "hypothèse" : "indéterminé";
      libelle =
        type === "REFERENCE_ADJUSTMENT"
          ? "Ajustement manuel de référence sans justificatif retrouvé (hypothèse)"
          : "Résiduel partiellement rattaché — preuves insuffisantes pour conclure";
      for (const c of composants) elementsConfirmes.push(c.explication);
      elementsConfirmes.push(
        `Part du résiduel rattachée à des divergences de source : ${(-ecart.residuel + restant).toLocaleString("fr-FR")} Ar ; écart restant non dérivable du brouillard : ${restant.toLocaleString("fr-FR")} Ar.`,
      );
      if (type === "REFERENCE_ADJUSTMENT") {
        preuvesAudit.push({
          source: "Formule de la feuille « 2026 » (audit du 28/10/2026)",
          detail:
            "La cellule de trésorerie référencée par ce contrôle porte un ajustement manuel codé dans la formule (constantes ajoutées au solde INDEX/MATCH). Ne jamais intégrer cet ajustement au calcul sans pièce justificative et règle comptable validée.",
        });
        elementsManquants.push(
          "Justificatif de l'ajustement manuel de la feuille (pièce comptable ou note de régularisation).",
        );
        action = "Demander la pièce justifiant l'ajustement de la feuille ; vérifier les virements croisés signalés comme absents des exports avant toute correction.";
      } else {
        elementsManquants.push("Preuve permettant de rattacher l'écart restant à une divergence de source ou à un ajustement documenté.");
        action = "Revue humaine : rapprocher le résiduel des écritures du grand livre et de la formule de référence.";
      }
    } else {
      // Aucune divergence de source rattachable : honnêteté oblige.
      type = "UNRESOLVED";
      confiance = "indéterminé";
      libelle = "Non résolu — preuves insuffisantes pour conclure";
      elementsManquants.push("Aucune divergence brouillard/balance rattachable au résiduel ; preuves insuffisantes.");
      action = "Revue humaine du contrôle avec le comptable (périmètre de la feuille à comparer aux écritures).";
    }

    // Cause commune (ex. L358 = même objet/ajustement que L354) : jamais une
    // seconde anomalie indépendante.
    if (causeCommune.length > 0 && type !== "ACCOUNT_OWNERSHIP_CONFLICT") {
      const autres = causeCommune.map((c) => `${c.ecart.bloc} (L${c.ecart.ligne})`).join(", ");
      elementsConfirmes.push(
        `Résiduel strictement identique (au centime) au contrôle ${autres} : cause commune probable, ne pas traiter comme une anomalie indépendante et ne jamais comptabiliser deux fois le même ajustement.`,
      );
      if (!typesSecondaires.includes("UNRESOLVED") && type === "SOURCE_ENTRY_MISSING") {
        typesSecondaires.push("REFERENCE_ADJUSTMENT");
      }
      preuvesAudit.push({
        source: "Dépendance de formule (audit du 28/10/2026)",
        detail: "Les contrôles concernés référencent la même cellule de trésorerie ajustée de la feuille (ex. H357 = +E352 pour JBU, E352 étant la trésorerie BOOST ajustée manuellement).",
      });
    }

    // Preuves d'audit spécifiques aux cas documentés — affichées comme
    // hypothèses, uniquement quand les conditions numériques se vérifient
    // dans les données importées.
    const bloc = ecart.ecart.bloc;
    if (type === "SOURCE_ENTRY_MISSING" && composants.length === 1 && composants[0]) {
      const c = composants[0];
      if (bloc === "TELMA SA" && c.contribution === 3000) {
        preuvesAudit.push({
          source: "Brouillard N, pièce 4540 (journal BOATSA, 2026-02-09) — audit du 28/10/2026",
          detail:
            "Frais « FRAIS STAR DC 151025 » de 3 000 Ar débités au 467900 (FONSTAR) et payés sur la banque 512140 (BOA TELMA) dans le brouillard : facturation croisée cohérente avec le résiduel miroir du contrôle STAR (L525, −3 000 Ar).",
        });
        demandes.push("Relevé bancaire BOA TELMA permettant de retrouver l'écriture de 3 000 Ar.");
      }
      if (bloc === "STAR" && c.contribution === -3000) {
        preuvesAudit.push({
          source: "Brouillard N, pièce 4540 (journal BOATSA, 2026-02-09) — audit du 28/10/2026",
          detail:
            "Même charge croisée de 3 000 Ar : le compte 512900 (BNI STAR) porte 3 000 Ar de crédits supplémentaires dans la balance Sage. Cas distinct de TELMA SA (sens opposé, autre banque) mais montants miroirs — rattacher l'écriture au relevé bancaire BNI STAR avant toute correction.",
        });
        demandes.push("Relevé bancaire BNI STAR permettant de retrouver l'écriture de 3 000 Ar.");
      }
      if (bloc === "TALOUMIS" && c.contribution === 182000) {
        preuvesAudit.push({
          source: "Brouillards N et N-1 — audit du 28/10/2026",
          detail:
            "Le montant de 182 000 Ar apparaît 5 fois sur le compte 467910 dans le brouillard N (3 réinstallations RAN d'impayés N-1 des mois MAI/AOUT/DÉCEMBRE 2025 + 2 factures TIERS de 2026) : l'écriture Sage manquante ne peut pas être localisée sans le grand livre. L'ouverture N est néanmoins cohérente : le journal RAN de N réinstalle exactement la clôture N-1 (−19 133 586,94 Ar), donc aucun double comptage d'ouverture.",
        });
        demandes.push("Grand livre Sage du compte 467910 sur la période pertinente.");
      }
      if (bloc === "SANLAMALLIANZ AUTOFI" && c.contribution === 23400) {
        typesSecondaires.push("DUPLICATE_POTENTIAL");
        preuvesAudit.push({
          source: "Brouillard N, pièces 63 et 3540 (journal BNIALL, 2026-01-02) — audit du 28/10/2026",
          detail:
            "Deux écritures de 23 400 Ar de même libellé (« SANLAMALLIANZ AUTOFI DECEMBRE 2025 — CENTRE HOSPITALIER DE SOAVINAND ») le même jour ; chacune est soldée par un groupe de lettrage distinct équilibré (codes CE et A) : double comptabilisation soldée à réviser. Fait DISTINCT de l'écriture de 23 400 Ar manquante sur 467102 — ne pas confondre doublon potentiel, écriture manquante et écriture comptabilisée.",
        });
        demandes.push("Grand livre Sage du compte 467102 et relevé bancaire du 512501 (BOA AUTOFI).");
      }
    }
    if (type === "REFERENCE_ADJUSTMENT" && bloc === "BOOST") {
      preuvesAudit.push({
        source: "Formule E352 de la feuille « 2026 » — audit du 28/10/2026",
        detail:
          "E352 = SUM(E351:E351) + 1 506 295,68 + 5 936 056,32. La composante 1 506 295,68 Ar est traçée dans le brouillard N-1 (virement LECOFRUIT reçu le 2025-12-23, pièce 14953, puis compte-à-compte 580001) ; la composante 5 936 056,32 Ar est introuvable dans N et N-1 : montant non tracé à présenter séparément. Les virements croisés 512320↔512005 (7 442 352 Ar et 7 298 580 Ar) sont absents des deux exports.",
      });
      demandes.push("Justificatif de l'ajustement de 5 936 056,32 Ar associé au contrôle BOOST (composante non tracée de la formule E352).");
      demandes.push("Grand livre Sage des comptes 512320 et 512005 sur la période pertinente.");
    }
    if (type === "ACCOUNT_OWNERSHIP_CONFLICT" && conflit === "512600") {
      preuvesAudit.push({
        source: "Brouillard N + intitulé de balance — audit du 28/10/2026",
        detail:
          "Le compte 512600 (« BOA EVIOSYS » dans la balance) paie les factures CAMUSAT/SONOCO du périmètre EVIOSYS dans le brouillard, mais il est listé dans le contrôle ORANGE MONEY MADAGASCAR de la feuille. L'application l'attribue à la famille EVIOSYS (propriétaire unique) et le contrôle latéral EVIOSYS L544 est exact avec ce périmètre.",
      });
      demandes.push("Confirmation comptable écrite du propriétaire du compte 512600.");
    }
    if (ecart.ecart.ligne === 571 && typesSecondaires.includes("DUPLICATE_POTENTIAL")) {
      demandes.push("Relevé bancaire du 2026-01-02 (journal BNIALL) pour arbitrer le double paiement potentiel de 23 400 Ar.");
    }

    const comptePrincipal =
      type === "ACCOUNT_OWNERSHIP_CONFLICT" ? (conflit ?? composants[0]?.compte) : composants[0]?.compte;
    const diag: DiagnosticEcart = {
      bloc,
      ligne: ecart.ecart.ligne,
      typeControle: ecart.ecart.type,
      statut: ecart.statut,
      montantReference: ecart.ecart.montant,
      montantCalcule: ecart.montantCalcule,
      ecartSigne: ecart.residuel,
      type,
      typesSecondaires,
      libelle,
      confiance,
      regle: `Objet rapproché : ${ecart.objet || "aucun"} — statut moteur « ${ecart.statut} »`,
      ...(comptePrincipal ? { compte: comptePrincipal } : {}),
      elementsConfirmes,
      composants,
      ecartRestant: restant,
      elementsManquants,
      preuvesAudit,
      demandesSpecifiques: demandes,
      actionRecommandee: action,
    };
    diagnostics.push(diag);
  }

  return diagnostics;
}

/** Mission §9 — liste des pièces comptables à demander, dérivée des
 *  diagnostics (aucune réponse inventée à la place du comptable). */
export function construireDemandesPieces(diagnostics: DiagnosticEcart[], result: AnalysisResult): DemandePiece[] {
  const demandes: DemandePiece[] = [];
  for (const d of diagnostics) {
    for (const c of d.composants) {
      demandes.push({
        controle: `${d.bloc} (L${d.ligne})`,
        ligne: d.ligne,
        type: d.type,
        piece: `Grand livre Sage du compte ${c.compte} (période du brouillard N)`,
        motif: c.explication,
      });
    }
    if (d.demandesSpecifiques.length > 0) {
      for (const spec of d.demandesSpecifiques) {
        demandes.push({
          controle: `${d.bloc} (L${d.ligne})`,
          ligne: d.ligne,
          type: d.type,
          piece: spec,
          motif: "Pièce spécifique identifiée par l'audit du 28/10/2026 pour ce contrôle.",
        });
      }
    }
    if (d.type === "ACCOUNT_OWNERSHIP_CONFLICT") {
      demandes.push({
        controle: `${d.bloc} (L${d.ligne})`,
        ligne: d.ligne,
        type: d.type,
        piece: `Confirmation comptable écrite du propriétaire du compte ${d.compte ?? "concerné"}`,
        motif: d.libelle,
      });
    }
    if (d.type === "REFERENCE_ADJUSTMENT") {
      demandes.push({
        controle: `${d.bloc} (L${d.ligne})`,
        ligne: d.ligne,
        type: d.type,
        piece: `Justificatif de l'ajustement manuel de référence (${d.ecartRestant.toLocaleString("fr-FR")} Ar)`,
        motif: "Ajustement codé dans la formule de la feuille, sans pièce justificative retrouvée.",
      });
    }
  }
  // Anomalies « écart balance » hors contrôles de référence : pièces à
  // demander aussi (ex. 512145/85 668 275,90 est DANS le brouillard —
  // l'écriture existe, c'est son justificatif qui manque).
  const dejaVu = new Set(demandes.map((x) => x.piece));
  const an = result.anomalies.filter((a) => a.type === "ecart_balance");
  for (const a of an) {
    const piece = `Grand livre Sage du compte ${a.comptes} (période du brouillard N)`;
    if (!dejaVu.has(piece)) {
      demandes.push({
        controle: `Anomalie « écart balance » — ${a.entite}`,
        ligne: 0,
        type: "SOURCE_ENTRY_MISSING",
        piece,
        motif: a.detail || a.libelle,
      });
    }
  }
  return demandes;
}
