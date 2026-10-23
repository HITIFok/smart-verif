import type { CombinaisonEcart, PieceEcart } from "./analysis-types";

/**
 * Détection EXACTE des écritures erronées qui composent un écart de famille
 * (feuille 2 du Verif BG). Principe du comptable : l'écart correspond à la
 * somme des écritures erronées, et un écart peut être composé de PLUSIEURS
 * écritures erronées — pas toujours d'une seule. Ex. écart 90 000 formé de
 * trois écritures erronées 48 000 + 2 000 + 40 000, comme d'une seule de
 * 90 000.
 *
 * Recherche du plus petit sous-ensemble de pièces (1 à 4 écritures) dont la
 * somme des mouvements nets redonne exactement l'écart, au centime :
 *  — taille 1 : une seule écriture fautive ;
 *  — taille 2 : complément par table de hachage ;
 *  — taille 3 : paires + complément par table de hachage ;
 *  — taille 4 : jointure de paires (meet-in-the-middle).
 * Les variantes de même taille sont dédupliquées par signature de montants
 * et ordonnées « comme un comptable » : les combinaisons d'écritures
 * suspectes (anomalie, hors schéma) d'abord, puis la masse la plus faible.
 * Un budget d'exploration borne les cas dégénérés (beaucoup de montants
 * identiques) sans jamais fausser le résultat : une combinaison renvoyée
 * est toujours exacte, la borne ne peut que laisser des variantes de côté.
 */

/** Taille maximale d'une combinaison d'écritures erronées recherchée. */
const TAILLE_MAX = 4;
/** Variantes maximales retenues et présentées par famille. */
const MAX_SOLUTIONS = 3;
/** Plafond de solutions brutes collectées à une taille donnée. */
const MAX_BRUTES = 300;
/** Budget anti-explosion (nombre de candidats examinés) par taille. */
const BUDGET_EXAMENS = 2_000_000;

/** Conversion en centimes : tout le calcul est en entiers, zéro erreur d'arrondi. */
const cents = (n: number) => Math.round(n * 100);

interface SolutionBrute {
  /** Indices des pièces dans la liste candidates. */
  idx: number[];
  /** Nombre de pièces suspectes (anomalie ou hors schéma) dans la combinaison. */
  nbSuspects: number;
  /** Somme des |nets| de la combinaison (centimes) — critère de tri. */
  masse: number;
}

export interface ResolutionEcart {
  /** Combinaisons retenues (taille minimale, MAX_SOLUTIONS au plus). */
  solutions: CombinaisonEcart[];
  /** Nombre total de variantes distinctes à la taille minimale. */
  nbTotal: number;
  /** Vrai si aucune combinaison exacte n'a été trouvée (jusqu'à 4 écritures). */
  echec: boolean;
}

/** Signature d'une combinaison : ses montants triés. Sert à dédupliquer les
 *  variantes qui ne diffèrent que par des pièces de même montant — à
 *  signature égale, la variante avec le plus d'écritures suspectes est
 *  conservée (le comptable regarde les écritures suspectes d'abord). */
const signature = (idx: number[], vals: number[]) =>
  idx
    .map((i) => vals[i]!)
    .sort((a, b) => a - b)
    .join("+");

/** Recherche exhaustive bornée des combinaisons d'exactement k pièces sommant
 *  à la cible (centimes). Dédupliquée par signature de montants. */
function chercherTaille(
  vals: number[],
  suspecte: boolean[],
  cible: number,
  k: number,
): SolutionBrute[] {
  const n = vals.length;
  const vus = new Map<string, SolutionBrute>();
  const sols: SolutionBrute[] = [];
  let examens = 0;

  const pousser = (idx: number[]) => {
    const nbSuspects = idx.reduce((t, i) => t + (suspecte[i] ? 1 : 0), 0);
    const masse = idx.reduce((t, i) => t + Math.abs(vals[i]!), 0);
    const sig = signature(idx, vals);
    const prev = vus.get(sig);
    if (!prev) {
      vus.set(sig, { idx, nbSuspects, masse });
      sols.push(vus.get(sig)!);
    } else if (nbSuspects > prev.nbSuspects) {
      // Même signature de montants mais plus d'écritures suspectes :
      // la variante suspecte remplace la variante neutre.
      prev.idx = idx;
      prev.nbSuspects = nbSuspects;
      prev.masse = masse;
    }
  };
  const plein = () => sols.length >= MAX_BRUTES || examens > BUDGET_EXAMENS;

  const parValeur = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const arr = parValeur.get(vals[i]!);
    if (arr) arr.push(i);
    else parValeur.set(vals[i]!, [i]);
  }

  if (k === 1) {
    for (const i of parValeur.get(cible) ?? []) {
      pousser([i]);
      if (plein()) break;
    }
    return sols;
  }

  if (k === 2) {
    for (let i = 0; i < n && !plein(); i++) {
      for (const j of parValeur.get(cible - vals[i]!) ?? []) {
        if (j <= i) continue; // pas deux fois la même pièce
        examens++;
        pousser([i, j]);
        if (plein()) break;
      }
    }
    return sols;
  }

  if (k === 3) {
    for (let i = 0; i < n && !plein(); i++) {
      for (let j = i + 1; j < n && !plein(); j++) {
        for (const l of parValeur.get(cible - vals[i]! - vals[j]!) ?? []) {
          if (l <= j) continue;
          examens++;
          pousser([i, j, l]);
          if (plein()) break;
        }
      }
    }
    return sols;
  }

  // k === 4 : meet-in-the-middle — jointure canonique des paires (i<j) avec
  // q.i > p.j, chaque 4-uplet {a<b<c<d} est généré exactement une fois.
  const paires = new Map<number, { i: number; j: number }[]>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = vals[i]! + vals[j]!;
      const arr = paires.get(s);
      if (arr) arr.push({ i, j });
      else paires.set(s, [{ i, j }]);
    }
  }
  externe: for (const [s, ps] of paires) {
    const qs = paires.get(cible - s);
    if (!qs) continue;
    for (const p of ps) {
      for (const q of qs) {
        if (q.i <= p.j) continue;
        examens++;
        pousser([p.i, p.j, q.i, q.j]);
        if (plein()) break externe;
      }
    }
  }
  return sols;
}

/** Résout un écart de famille : trouve la(les) plus petite(s) combinaison(s)
 *  d'écritures dont la somme redonne exactement l'écart de la feuille. Si
 *  aucune combinaison n'explique l'écart complet (à cause des RAN non
 *  considérés 462/467 qui restent dans les soldes), retente sur l'écart hors
 *  RAN non considérés — la combinaison est alors signalée « hors_ran ». */
export function resoudreEcartFamille(
  pieces: PieceEcart[],
  ecartFeuille: number,
  ranNonConsidere: number,
): ResolutionEcart {
  const vals = pieces.map((p) => cents(p.net));
  const suspecte = pieces.map((p) => p.anomalie || p.role === "autre");

  const tFeuille = cents(ecartFeuille);
  const cibles: { t: number; portee: CombinaisonEcart["portee"] }[] = [
    { t: tFeuille, portee: "feuille" },
  ];
  const tHorsRan = cents(ecartFeuille - ranNonConsidere);
  if (tHorsRan !== tFeuille && tHorsRan !== 0) cibles.push({ t: tHorsRan, portee: "hors_ran" });

  for (const { t, portee } of cibles) {
    for (let k = 1; k <= TAILLE_MAX; k++) {
      const brutes = chercherTaille(vals, suspecte, t, k);
      if (brutes.length === 0) continue;
      // Ordre « comme un comptable » : le plus d'écritures suspectes d'abord,
      // puis la masse la plus faible (écritures les plus proches de l'écart),
      // puis la signature pour un résultat déterministe.
      brutes.sort(
        (a, b) =>
          b.nbSuspects - a.nbSuspects ||
          a.masse - b.masse ||
          signature(a.idx, vals).localeCompare(signature(b.idx, vals)),
      );
      const solutions: CombinaisonEcart[] = brutes.slice(0, MAX_SOLUTIONS).map((b) => ({
        pieces: b.idx.map((i) => pieces[i]!),
        somme: b.idx.reduce((tt, i) => tt + vals[i]!, 0) / 100,
        cible: t / 100,
        portee,
      }));
      // Les écritures de la combinaison retenue sont marquées erronées (à
      // corriger en priorité dans Sage) directement sur les pièces de la famille.
      for (const c of solutions) {
        for (const p of c.pieces) p.dansCombinaison = true;
      }
      return { solutions, nbTotal: brutes.length, echec: false };
    }
  }
  return { solutions: [], nbTotal: 0, echec: true };
}
