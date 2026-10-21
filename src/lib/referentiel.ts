import { PLAN_COMPTABLE, type ComptePlan } from "./plan-comptable-data";
import { PLAN_TIERS, type TiersPlan } from "./plan-tiers-data";

export { PLAN_COMPTABLE, PLAN_TIERS };
export type { ComptePlan, TiersPlan };

/** Plan comptable Sage 100cloud — MCI CARE MADAGASCAR (434 comptes). */
export const NB_COMPTES_PLAN = PLAN_COMPTABLE.length;
/** Plan tiers Sage 100cloud — MCI CARE MADAGASCAR (836 tiers). */
export const NB_TIERS_PLAN = PLAN_TIERS.length;

export const COMPTE_PAR_NUMERO: Map<string, ComptePlan> = new Map(
  PLAN_COMPTABLE.map((c) => [c.numero, c]),
);

export const TIERS_PAR_CODE: Map<string, TiersPlan> = new Map(PLAN_TIERS.map((t) => [t.code, t]));

/**
 * Familles comptables de l'entreprise, testées par ordre de priorité.
 * Sert de libellé de repli pour tout compte absent du plan détaillé
 * (ex. comptes collectifs 401 + code tiers, sous-comptes créés après tirage).
 */
const FAMILLES: Array<[RegExp, string]> = [
  [/^1/, "Capitaux & résultats"],
  [/^2/, "Immobilisations"],
  [/^40[89]/, "Fournisseurs — régularisation"],
  [/^40/, "Fournisseurs & prestataires"],
  [/^411/, "Clients"],
  [/^460/, "Clients — fonds à encaisser"],
  [/^461/, "Clients — avances"],
  [/^462/, "Clients — part patient"],
  [/^467/, "Clients — transit appel de fonds"],
  [/^4[2345]/, "Personnel · État · Groupe"],
  [/^4/, "Comptes de tiers"],
  [/^5/, "Trésorerie"],
  [/^6/, "Charges"],
  [/^7/, "Produits"],
];

export function familleCompte(compte: string): string {
  for (const [re, label] of FAMILLES) if (re.test(compte)) return label;
  return "Autre";
}

const COLLECTIFS_TIERS = ["401", "404", "409", "411"];

/** Nom du tiers derrière un compte collectif (4011013 = 401 + tiers 1013), sinon "". */
function tiersDuCollectif(compte: string): string {
  if (compte.length <= 3) return "";
  const collectif = compte.slice(0, 3);
  if (!COLLECTIFS_TIERS.includes(collectif)) return "";
  return TIERS_PAR_CODE.get(compte.slice(3))?.intitule ?? "";
}

/**
 * Libellé d'un compte pour l'affichage : intitulé exact du plan comptable,
 * sinon nom du tiers derrière un compte collectif 401/411 + code tiers,
 * sinon famille comptable générique.
 */
export function decrireCompte(compte: string): string {
  const exact = COMPTE_PAR_NUMERO.get(compte);
  if (exact) return exact.intitule;
  const tiers = tiersDuCollectif(compte);
  if (tiers) return tiers;
  return familleCompte(compte);
}

/** « 460140 (TELMA SA à encaisser) » — libellé ajouté seulement s'il vient du
 *  plan (intitulé exact ou tiers collectif), jamais d'une famille générique. */
export function avecLibelle(compte: string): string {
  const exact = COMPTE_PAR_NUMERO.get(compte);
  if (exact) return `${compte} (${exact.intitule})`;
  const tiers = tiersDuCollectif(compte);
  if (tiers) return `${compte} (${tiers})`;
  return compte;
}

/** Enrichit une liste de comptes « 460140, 512140 » avec les libellés du plan. */
export function decrireComptes(chaine: string, separateur = " · "): string {
  return chaine
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => avecLibelle(c))
    .join(separateur);
}

/** Intitulé d'un code tiers du plan tiers (ex. « 1013 » → CENHOSOA). */
export function libelleTiers(code: string): string {
  return TIERS_PAR_CODE.get(code)?.intitule ?? "";
}
