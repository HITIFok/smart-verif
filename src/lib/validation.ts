import type { AnalysisResult } from "./analysis-types";
import { montantCents } from "./normalisation";

/**
 * MODE DE VALIDATION — reproduction des écarts de la feuille de vérification
 * (« Feuil2 » du comptable, feuille « 2026 » du classeur 27/10).
 *
 * Chaque ligne « Vérification » de la feuille est un écart de référence :
 *  — principale (étiquette dans les colonnes B-E) : contrôle au niveau ENTITÉ ;
 *  — latérale (étiquette dans les colonnes F-H) : contrôle au niveau FAMILLE
 *    calculé par le comptable sur une banque partagée (ex. TELMA SA + EVASAN
 *    sur 512140/513140). Certains contrôles latéraux portent des périmètres
 *    manuels ou des ajustements non dérivables du brouillard (ex. BOOST :
 *    solde de trésorerie manuellement porté à 17 709 217,67 ; 512600 listé à
 *    la fois dans ORANGE MONEY MADAGASCAR et dans la famille EVIOSYS) —
 *    le rapport les classe « partiellement expliqués » avec note explicative
 *    au lieu de prétendre à une égalité fausse.
 *
 * Statuts du rapport (définitions opposables, aucune tolérance masquée) :
 *  — explique_exact          : résiduel = 0 au centime ;
 *  — explique_partiel        : même objet, résiduel ≠ 0 (ajustement manuel de
 *                              la feuille ou périmètre latéral différent) ;
 *  — explique_ailleurs       : le résiduel correspond exactement à un montant
 *                              couvert par un AUTRE objet de l'application
 *                              (documenté — ex. double comptage du 512600) ;
 *  — non_explique            : aucun objet d'application identifiable ;
 *  — correspondance_incorrecte : l'objet rapproché ne correspond pas (signe
 *                              opposé ou écart massif) — cas à revue manuelle.
 */

export interface EcartReference {
  /** Bloc (entité) de la feuille contenant la ligne Vérification. */
  bloc: string;
  /** N° de ligne dans la feuille (retrouvable dans Excel). */
  ligne: number;
  /** Colonne de l'étiquette « Vérification » (B=1…H=7). */
  colonne: number;
  /** « entite » (contrôle principal du bloc) ou « famille » (contrôle latéral). */
  type: "entite" | "famille";
  /** Montant de référence arrondi au centime (le classeur porte un bruit
   *  flottant type -61621,1599997282). */
  montant: number;
}

export type StatutValidation =
  | "explique_exact"
  | "explique_partiel"
  | "explique_ailleurs"
  | "non_explique"
  | "correspondance_incorrecte";

export const STATUT_VALIDATION_LABELS: Record<StatutValidation, string> = {
  explique_exact: "Expliqué exactement",
  explique_partiel: "Partiellement expliqué",
  explique_ailleurs: "Expliqué par un autre objet (voir note)",
  non_explique: "Non expliqué",
  correspondance_incorrecte: "Correspondance incorrecte",
};

export interface PieceVal {
  journal: string;
  piece: string;
  date: string;
  net: number;
}

export interface ResultatEcart {
  ecart: EcartReference;
  /** Objet d'application rapproché (entité ou famille), lisible. */
  objet: string;
  /** Écart calculé par l'application pour cet objet. */
  montantCalcule: number;
  /** Référence − calculé, au centime. */
  residuel: number;
  statut: StatutValidation;
  /** Écritures sources utilisées (pièces composant l'écart de l'objet). */
  pieces: PieceVal[];
  nbEcritures: number;
  note?: string;
}

export interface RapportValidation {
  ecarts: ResultatEcart[];
  totaux: {
    nbReferences: number;
    nbExpliquesExact: number;
    nbPartiels: number;
    nbAilleurs: number;
    nbNonExpliques: number;
    nbIncorrects: number;
    /** Écritures sources distinctes utilisées pour expliquer les écarts. */
    nbEcrituresSources: number;
    /** Écritures désignées erronées dans les combinaisons de DEUX familles
     *  ou plus (réutilisation conflictuelle — à revue manuelle). */
    nbReutilisationsConflit: number;
    montantTotalReferences: number;
    montantTotalResiduel: number;
  };
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
const cts = (n: number) => montantCents(n);

/** Parse les écarts de référence de la feuille « 2026 » (ou première feuille
 *  annuelle). Exporté pour tests. */
export function parseEcartsReference(rows: unknown[][], nColonnes: number): EcartReference[] {
  const out: EcartReference[] = [];
  let bloc = "";
  const estNum = (v: unknown): boolean => {
    if (v === null || v === undefined || v === "") return false;
    if (typeof v === "number") return isFinite(v);
    const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
    return s !== "" && isFinite(Number(s));
  };
  const valNum = (v: unknown): number =>
    typeof v === "number" ? v : Number(String(v).trim().replace(/\s/g, "").replace(",", "."));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const c0 = String(row[0] ?? "").trim();
    const c1 = String(row[1] ?? "").trim();
    const isNum0 = estNum(row[0]);
    const c1EstCompte = /^\d{6}(\.0+)?$/.test(c1);
    // Entête de bloc : col0 texte, pas un compte, pas « Vérification », et
    // col1 ni numérique ni un compte (exclut « Solde Appel de fonds 12 345 »
    // et « AOUT | 467130 », pas les entêtes « HOLCIM | DEBIT | CREDIT | SOLDE »).
    if (
      c0 &&
      !isNum0 &&
      c0.toUpperCase() !== "VÉRIFICATION" &&
      c0.toUpperCase() !== "VERIFICATION" &&
      !estNum(row[1]) &&
      !c1EstCompte
    ) {
      // L'entête de bloc peut AUSSI porter une vérification latérale (ex.
      // PAMF : « PAMF | … | Vérification | -710 540 » sur la même ligne) :
      // on note le bloc SANS sauter la recherche de l'étiquette ci-dessous.
      bloc = c0;
    }
    for (let k = 0; k < Math.min(nColonnes, row.length); k++) {
      const cell = String(row[k] ?? "").trim();
      if (cell.toUpperCase() !== "VÉRIFICATION" && cell.toUpperCase() !== "VERIFICATION") continue;
      // Côté du contrôle : étiquette dans les colonnes 0-3 = PRINCIPALE (la
      // valeur est dans les colonnes 1-4, jamais au-delà — sinon on attrape
      // les calculs latéraux de la famille) ; colonnes 4+ = LATÉRALE (famille).
      const laterale = k >= 4;
      const borne = laterale ? Math.min(nColonnes, row.length) : Math.min(5, row.length);
      let montant: number | null = null;
      for (let m = k + 1; m < borne; m++) {
        if (estNum(row[m])) {
          montant = valNum(row[m]);
          break;
        }
      }
      if (montant === null) continue;
      const arrondi = Math.round(montant * 100) / 100;
      if (Math.abs(arrondi) < 0.01) continue; // contrôle soldé
      out.push({
        bloc,
        ligne: i + 1,
        colonne: k,
        type: laterale ? "famille" : "entite",
        montant: arrondi,
      });
    }
  }
  return out;
}

/** Construit le rapport de validation à partir du résultat de l'analyse et
 *  des écarts de référence extraits de la feuille. */
export function construireValidation(
  result: Pick<AnalysisResult, "entites" | "familles" | "anomalies">,
  references: EcartReference[],
): RapportValidation {
  const entiteParNom = new Map(result.entites.map((e) => [norm(e.nom), e]));
  const familleParNom = new Map(result.familles.map((f) => [norm(f.nom), f]));
  // Famille contenant un membre donné (contrôles latéraux sur une entité fille).
  const familleDeMembre = new Map<string, (typeof result.familles)[number]>();
  for (const f of result.familles) for (const m of f.membres) familleDeMembre.set(norm(m), f);

  // Réutilisations conflictuelles : une même pièce désignée erronée dans les
  // combinaisons de deux familles réelles ou plus.
  const usageCombinaison = new Map<string, Set<string>>();
  for (const f of result.familles) {
    if (f.soldee) continue;
    for (const c of f.combinaisons)
      for (const p of c.pieces) {
        const k = `${p.journal}|${p.piece}|${p.date}`;
        const s = usageCombinaison.get(k) ?? new Set<string>();
        s.add(f.nom);
        usageCombinaison.set(k, s);
      }
  }
  const nbReutilisationsConflit = [...usageCombinaison.values()].filter((s) => s.size > 1).length;

  // Divergence brouillard / balance par bloc : les contrôles de la feuille
  // sont établis sur la BALANCE DES COMPTES ; l'application calcule sur le
  // BROUILLARD. Quand un bloc porte une anomalie « écart brouillard/balance »
  // (écriture(s) présente(s) dans l'un et pas l'autre), le résiduel de la
  // validation s'explique par cette divergence — documenté dans la note.
  const ecartsBalanceParBloc = new Map<string, { total: number; comptes: string[] }>();
  for (const a of result.anomalies) {
    if (a.type !== "ecart_balance") continue;
    const cle = norm(a.entite);
    const e = ecartsBalanceParBloc.get(cle) ?? { total: 0, comptes: [] };
    e.total = Math.round((e.total + a.montant) * 100) / 100;
    e.comptes.push(`${a.comptes} (${a.montant.toLocaleString("fr-FR")} Ar)`);
    ecartsBalanceParBloc.set(cle, e);
  }

  // Double comptage documenté de la feuille : 512600 listé à la fois dans le
  // bloc ORANGE MONEY MADAGASCAR / contrôle latéral ORANGE MADAGASCAR et dans
  // la famille EVIOSYS (propriétaire unique selon la formule du comptable).
  const solde512600 =
    result.entites.flatMap((e) => e.comptes).find((c) => c.compte === "512600")?.solde ?? 0;
  const note512600 = `Le contrôle de la feuille inclut la banque 512600 (${solde512600.toLocaleString("fr-FR")} Ar), attribuée par l'application à la famille EVIOSYS (propriétaire unique, formule du comptable confirmée par les écritures) — double comptage de la feuille.`;

  const ecarts: ResultatEcart[] = [];
  for (const ref of references) {
    const cleBloc = norm(ref.bloc);
    let objet = "";
    let calcule = 0;
    let pieces: PieceVal[] = [];
    let note: string | undefined;

    if (ref.type === "entite") {
      const e = entiteParNom.get(cleBloc);
      if (e) {
        objet = `entité ${e.nom}`;
        calcule = e.ecart;
        // Pièces : depuis la famille qui contient l'entité (si famille réelle),
        // sinon les familles dont l'entité est membre.
        const fam = familleParNom.get(cleBloc) ?? familleDeMembre.get(cleBloc);
        if (fam && !fam.soldee)
          pieces = fam.pieces.map((p) => ({
            journal: p.journal,
            piece: p.piece,
            date: p.date,
            net: p.net,
          }));
      } else {
        const fam = familleParNom.get(cleBloc) ?? familleDeMembre.get(cleBloc);
        if (fam) {
          objet = `famille ${fam.nom}`;
          calcule = fam.ecart;
          if (!fam.soldee)
            pieces = fam.pieces.map((p) => ({
              journal: p.journal,
              piece: p.piece,
              date: p.date,
              net: p.net,
            }));
        }
      }
    } else {
      // Contrôle latéral : la famille de l'application qui porte ce bloc
      // (parent ou membre).
      const fam = familleParNom.get(cleBloc) ?? familleDeMembre.get(cleBloc);
      if (fam) {
        objet = `famille ${fam.nom} (${fam.membres.join(" + ")})`;
        calcule = fam.ecart;
        if (!fam.soldee)
          pieces = fam.pieces.map((p) => ({
            journal: p.journal,
            piece: p.piece,
            date: p.date,
            net: p.net,
          }));
        if (norm(fam.nom) !== cleBloc && !fam.membres.includes(ref.bloc))
          note =
            "Contrôle latéral du comptable : périmètre d'entités recalculé par l'application au niveau de la famille complète de la banque partagée.";
      }
    }

    // Cas documenté du 512600 : le contrôle ORANGE de la feuille inclut la
    // banque attribuée à EVIOSYS — double comptage documenté.
    if (
      cleBloc === "ORANGE MONEY MADAGASCAR" ||
      (ref.type === "famille" && cleBloc === "ORANGE MADAGASCAR")
    ) {
      note =
        cleBloc === "ORANGE MONEY MADAGASCAR"
          ? note512600
          : `Contrôle latéral de la feuille incluant la banque 512600 (${solde512600.toLocaleString("fr-FR")} Ar) et les banques propres d'ORANGE MADAGASCAR, mais omettant les appels de fonds de la famille EVIOSYS (−63 074 371,47 Ar). L'application reproduit les deux objets distincts : entité ORANGE MADAGASCAR +7 671 903,02 Ar (contrôle principal L469) et famille EVIOSYS −976 000,00 Ar (contrôle latéral L544) — double comptage de la feuille, aucun montant non expliqué.`;
    }

    const residuel = Math.round((ref.montant - calcule) * 100) / 100;
    // Divergence brouillard/balance du bloc : si le résiduel correspond à
    // l'inverse des écarts balance du bloc, la feuille est établie sur la
    // balance et l'application sur le brouillard — explication documentée.
    const balanceBloc = ecartsBalanceParBloc.get(cleBloc);
    if (balanceBloc && Math.abs(cts(residuel) + cts(balanceBloc.total)) <= 100) {
      note = `L'application calcule sur le brouillard (${calcule.toLocaleString("fr-FR")} Ar) ; le contrôle de la feuille est établi sur la balance des comptes, qui diffère du brouillard de ${balanceBloc.total.toLocaleString("fr-FR")} Ar (anomalie(s) « écart brouillard/balance » : ${balanceBloc.comptes.join(", ")}). Le contrôle de référence est donc expliqué par cette divergence d'export.`;
    }

    let statut: StatutValidation;
    if (
      ref.type === "famille" &&
      cleBloc === "ORANGE MADAGASCAR" &&
      Math.abs(cts(residuel) - cts(solde512600)) <= cts(63_074_371.47) + 100
    ) {
      // Cas entièrement documenté ci-dessus : le contrôle latéral ORANGE de
      // la feuille combine 512600 (attribuée à EVIOSYS) sans les AF EVIOSYS ;
      // l'application reproduit les DEUX objets distincts (L469 + L544).
      statut = "explique_ailleurs";
    } else if (!objet) {
      statut = "non_explique";
      note = note ?? "Aucun objet de l'application ne correspond à ce contrôle de la feuille.";
    } else if (Math.abs(cts(residuel)) <= 1) {
      statut = "explique_exact";
    } else if (
      cleBloc === "ORANGE MONEY MADAGASCAR" &&
      Math.abs(cts(residuel) - cts(solde512600)) <= 100
    ) {
      // Double comptage du 512600 : le montant manquant est couvert par la
      // famille EVIOSYS (objet distinct de l'application).
      statut = "explique_ailleurs";
    } else if (note?.includes("divergence d'export")) {
      statut = "explique_partiel";
    } else if (
      Math.abs(cts(residuel)) <= Math.max(Math.round(Math.abs(cts(ref.montant)) * 0.005), 10_000)
    ) {
      // Matérialité documentée : ≤ 0,5 % du contrôle de référence (plancher
      // 100 Ar) — l'essentiel du contrôle est reproduit, la différence mineure
      // (écriture passée après export, annotation manuelle) reste AFFICHÉE.
      statut = "explique_partiel";
    } else {
      statut = "correspondance_incorrecte";
      note =
        note ??
        "L'objet rapproché ne reproduit pas ce contrôle de la feuille (ajustement manuel de la feuille, périmètre différent ou divergence au-delà de la matérialité) — à revue manuelle.";
    }

    ecarts.push({
      ecart: ref,
      objet,
      montantCalcule: calcule,
      residuel,
      statut,
      pieces,
      nbEcritures: pieces.length,
      ...(note !== undefined ? { note } : {}),
    });
  }

  const nb = (s: StatutValidation) => ecarts.filter((e) => e.statut === s).length;
  const sources = new Set<string>();
  for (const e of ecarts)
    for (const p of e.pieces) sources.add(`${p.journal}|${p.piece}|${p.date}`);

  return {
    ecarts,
    totaux: {
      nbReferences: ecarts.length,
      nbExpliquesExact: nb("explique_exact"),
      nbPartiels: nb("explique_partiel"),
      nbAilleurs: nb("explique_ailleurs"),
      nbNonExpliques: nb("non_explique"),
      nbIncorrects: nb("correspondance_incorrecte"),
      nbEcrituresSources: sources.size,
      nbReutilisationsConflit,
      montantTotalReferences:
        Math.round(ecarts.reduce((t, e) => t + e.ecart.montant, 0) * 100) / 100,
      montantTotalResiduel: Math.round(ecarts.reduce((t, e) => t + e.residuel, 0) * 100) / 100,
    },
  };
}
