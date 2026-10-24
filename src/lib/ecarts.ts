import type { CombinaisonEcart, PieceEcart } from "./analysis-types";

/**
 * Détection EXACTE des écritures erronées qui composent un écart de famille
 * (feuille 2 du Verif BG) — méthode du comptable, en trois temps :
 *
 *  1. LETTRAGE SAGE (preuve) : une pièce dont toutes les lignes lettrées
 *     appartiennent à des groupes de lettrage équilibrés (compte + tiers +
 *     code, colonne « Lettrage montant » du brouillard) et dont les lignes
 *     sans code sont bancaires est RÉGULARISÉE dans Sage (ex. le règlement
 *     BOAOMM dont le volet 401000 est lettré avec la pièce TIERS de
 *     facturation). Elle n'est JAMAIS candidate : même si son net sur le
 *     périmètre famille participe arithmétiquement à l'écart, elle est
 *     correcte et soldée — la corriger serait une fausse piste.
 *  2. COMPENSATION : les pièces restantes d'exact montant opposé se
 *     compensent 2 à 2 (ex. le volet banque et le volet tiers d'une même
 *     opération, ou un compte à compte entrant et sortant). Elles sont
 *     « soldées » : leur correction n'est pas nécessaire et elles ne
 *     peuvent pas, à elles seules, expliquer l'écart. La recherche ne les
 *     considère JAMAIS.
 *  3. COMBINAISON EXACTE : parmi les pièces NON soldées (non lettrées),
 *     recherche de la plus petite combinaison (1 à 4 écritures) dont la
 *     somme des mouvements nets redonne exactement l'écart, au centime —
 *     un écart peut être composé de PLUSIEURS écritures erronées, pas
 *     toujours d'une seule (ex. 90 000 = 48 000 + 2 000 + 40 000).
 *     500 000 + -313 813,20 = 186 186,80 est aussi « exact » mais absurde
 *     pour un comptable : le lettrage préalable élimine ce bruit.
 *
 * Au plus UNE combinaison est retenue (la plus plausible : écritures
 * suspectes d'abord, masse la plus faible ensuite) et seules SES écritures
 * sont marquées erronées — les variantes équivalentes sont comptées mais
 * pas marquées, car elles sont alternatives et non cumulatives. Sans
 * combinaison, l'écart est déclaré résidu des écritures non soldées
 * (échec honnête, pas de fausse piste) : le lettrage préalable réduit déjà
 * fortement la liste à examiner (ex. BOOST : 132 non soldées sur 552).
 *
 * Détails techniques :
 *  — taille 1 : une seule écriture fautive ;
 *  — taille 2 : complément par table de hachage ;
 *  — taille 3 : paires + complément par table de hachage ;
 *  — taille 4 : jointure de paires (meet-in-the-middle).
 *  — tout le calcul est en entiers (centimes) : zéro erreur d'arrondi ;
 *  — un budget d'exploration borne les cas dégénérés sans jamais fausser
 *    le résultat : une combinaison renvoyée est toujours exacte.
 */

/** Taille maximale d'une combinaison d'écritures erronées recherchée. */
const TAILLE_MAX = 4;
/** Plafond de solutions brutes collectées à une taille donnée. */
const MAX_BRUTES = 300;
/** Budget anti-explosion (nombre de candidats examinés) par taille. */
const BUDGET_EXAMENS = 2_000_000;
/** Plafond de variantes distinctes stockées et exportées (les premières,
 *  les plus plausibles d'abord). nbTotal reste le compte complet. */
const MAX_VARIANTES = 12;

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
  /** Combinaison retenue (au plus une : la plus plausible). */
  solutions: CombinaisonEcart[];
  /** Toutes les décompositions exactes distinctes à la taille retenue, la
   *  plus plausible d'abord (= solutions[0]) — utiles pour le rapprochement
   *  dans Sage quand l'attribution est ambiguë. Bornées à MAX_VARIANTES. */
  variantes: CombinaisonEcart[];
  /** Nombre total de variantes distinctes à la taille de la solution. */
  nbTotal: number;
  /** Vrai si aucune combinaison exacte n'a été trouvée (jusqu'à 4 écritures
   *  parmi les non soldées) : l'écart est le résidu de ces écritures. */
  echec: boolean;
  /** Nombre d'écritures non soldées (non lettrées) — le vivier de la
   *  recherche et, à défaut de combinaison, la liste des contributeurs. */
  nbNonSoldees: number;
  /** Nombre d'écritures soldées par lettrage (opposé exact) — se
   *  compensent entre elles, pas à corriger. */
  nbSoldees: number;
  /** Nombre d'écritures soldées par le lettrage SAGE (groupes équilibrés) —
   *  régularisées dans Sage, exclues du vivier avant la compensation. */
  nbLettreesSage: number;
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

/** LETTRAGE par montants exactement opposés : marque `lettree` les pièces
 *  qui se compensent 2 à 2 (une pièce de +X avec une pièce de −X, au
 *  centime). Renvoie le nombre de paires soldées. Les pièces de net nul ne
 *  sont pas lettrées (elles ne portent rien sur le périmètre). */
export function lettrerParMontant(pieces: PieceEcart[]): number {
  const pools = new Map<number, PieceEcart[]>();
  for (const p of pieces) {
    const c = cents(p.net);
    if (c === 0) continue;
    const arr = pools.get(c);
    if (arr) arr.push(p);
    else pools.set(c, [p]);
  }
  let nbPaires = 0;
  // Parcours par |montant| décroissant (l'ordre ne change pas le résultat :
  // les paires d'exact opposé sont uniques, seul l'appariement entre instances
  // de même montant varie — sans effet sur les montants).
  for (const [c, arr] of [...pools.entries()].sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))) {
    if (c < 0) continue;
    const opp = pools.get(-c);
    if (!opp || opp.length === 0) continue;
    const k = Math.min(arr.length, opp.length);
    for (let i = 0; i < k; i++) {
      arr[i]!.lettree = true;
      opp[i]!.lettree = true;
    }
    arr.splice(0, k);
    opp.splice(0, k);
    nbPaires += k;
  }
  return nbPaires;
}

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

/** Résout un écart de famille (méthode du comptable) :
 *  1. lettrage SAGE : les pièces régularisées dans Sage (groupes de lettrage
 *     équilibrés, marquées `lettreeSage` par l'analyse) sont exclues — elles
 *     ne sont jamais candidates, même si leur net participe à l'écart ;
 *  2. lettrage par montants exactement opposés → pièces soldées marquées
 *     `lettree` (elles se compensent, jamais candidates) ;
 *  3. recherche de la plus petite combinaison (1 à 4 écritures) parmi les
 *     NON soldées dont la somme redonne exactement l'écart de la feuille ;
 *     si les RAN non considérés (462/467/512/513) empêchent l'égalité
 *     exacte, retente sur l'écart hors RAN non considérés (« hors_ran ») ;
 *  4. au plus UNE solution retenue (la plus plausible), seules ses écritures
 *     sont marquées `dansCombinaison` ; les variantes équivalentes sont
 *     comptées (nbTotal) ET collectées (variantes, la retenue d'abord) pour
 *     un rapprochement honnête dans Sage quand l'attribution est ambiguë ;
 *  5. sans combinaison : échec honnête — l'écart est le résidu des écritures
 *     non soldées, renvoyé avec leurs nombres (nbNonSoldees / nbSoldees). */
export function resoudreEcartFamille(
  pieces: PieceEcart[],
  ecartFeuille: number,
  ranNonConsidere: number,
): ResolutionEcart {
  // État frais : les marques d'un appel précédent ne doivent pas subsister
  // (lettreeSage est une donnée Sage, pas un état du solveur : conservée).
  for (const p of pieces) {
    p.lettree = false;
    p.dansCombinaison = false;
  }

  // 1. Lettrage SAGE : les pièces régularisées dans Sage sortent du vivier.
  //    Leur net reste dans le rapprochement global (Σ pièces = écart hors
  //    RAN non considérés) mais elles ne peuvent pas être désignées.
  const nbLettreesSage = pieces.filter((p) => p.lettreeSage).length;
  const vivier0 = pieces.filter((p) => !p.lettreeSage);

  // 2. Lettrage par montants exactement opposés : les pièces restantes se
  //    compensent 2 à 2.
  lettrerParMontant(vivier0);
  const vivier = vivier0.filter((p) => !p.lettree);
  const nbSoldees = pieces.length - vivier.length;
  const echec: ResolutionEcart = {
    solutions: [],
    variantes: [],
    nbTotal: 0,
    echec: true,
    nbNonSoldees: vivier.length,
    nbSoldees,
    nbLettreesSage,
  };

  const vals = vivier.map((p) => cents(p.net));
  const suspecte = vivier.map((p) => p.anomalie || p.role === "autre");

  // 2. Cibles : l'écart feuille d'abord, puis l'écart hors RAN non considérés.
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
      // 3. UNE seule solution retenue — les variantes sont alternatives et
      // non cumulatives : marquer leurs unions serait faux (c'est exactement
      // ce qui affichait « 11 écritures erronées » mélangant des variantes).
      // Les variantes restent toutefois COLLECTÉES (sans marquer leurs
      // pièces) : elles alimentent l'honnêteté de l'attribution — quand
      // plusieurs décompositions tombent juste, l'export les liste toutes
      // pour que le comptable rapproche chacune dans Sage.
      const versCombinaison = (b: SolutionBrute): CombinaisonEcart => ({
        pieces: b.idx.map((i) => vivier[i]!),
        somme: b.idx.reduce((tt, i) => tt + vals[i]!, 0) / 100,
        cible: t / 100,
        portee,
      });
      // La solution retenue EST la première variante (même objet) : les deux
      // listes ne peuvent jamais diverger.
      const variantes = brutes.slice(0, MAX_VARIANTES).map(versCombinaison);
      const solution = variantes[0]!;
      for (const p of solution.pieces) p.dansCombinaison = true;
      return {
        solutions: [solution],
        variantes,
        nbTotal: brutes.length,
        echec: false,
        nbNonSoldees: vivier.length,
        nbSoldees,
        nbLettreesSage,
      };
    }
  }
  // 5. Échec honnête : l'écart est le résidu des écritures non soldées.
  return echec;
}
