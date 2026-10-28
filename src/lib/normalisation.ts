/**
 * Normalisation déterministe des données comptables (brouillard Sage +
 * feuille de vérification). Chaque fonction est pure et testée
 * (scripts/test-moteur.ts) ; les valeurs ORIGINALES restent stockées par les
 * appelants (EntryLine, blocs Verif) pour l'affichage et l'audit — la
 * normalisation ne sert qu'aux comparaisons, clés et regroupements.
 *
 * Règles opposables :
 *  — les zéros initiaux des références sont conservés tant qu'ils portent du
 *    sens (les n° de pièce Sage sont des chaînes) ;
 *  — deux sociétés ne sont JAMAIS fusionnées sous prétexte d'un même code
 *    de compte tiers (la normalisation ne touche pas les identités) ;
 *  — les montants sont comparés en CENTIMES ENTIERS : aucune arithmétique
 *    flottante dans les décisions (0,1 + 0,2 ≠ 0,3 en binaire).
 */

/** Chaîne brute nettoyée ("" si null/undefined). */
export const brut = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** Compte général : retire le suffixe flottant Excel « .0 », conserve les
 *  zéros initiaux, trim. « 401000.0 » → « 401000 », « 0045612 » inchangé. */
export const normaliseCompte = (v: unknown): string =>
  brut(v).replace(/\.0+$/, "").replace(/,/g, "");

/** Journal : majuscules sans espaces parasites (« BOAMCI »). */
export const normaliseJournal = (v: unknown): string => brut(v).toUpperCase().replace(/\s+/g, "");

/** Référence / n° de pièce : collapse des espaces, majuscules — les zéros
 *  initiaux et la ponctuation interne sont CONSERVÉS (identité Sage). */
export const normaliseReference = (v: unknown): string =>
  brut(v).toUpperCase().replace(/\s+/g, " ");

/** Libellé : majuscules, accents retirés, espaces collapsés — sert aux
 *  comparaisons floues (doublons, rapprochements), pas à l'affichage. */
export const normaliseLibelle = (v: unknown): string =>
  brut(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Date : accepte Date, n° de série Excel, « AAAA-MM-JJ », « JJ/MM/AAAA »,
 *  « AAAA/MM/JJ » → « AAAA-MM-JJ » ; invalide → "" (jamais inventée). */
export function normaliseDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && isFinite(v) && v > 20000 && v < 90000) {
    // Série Excel (base 1899-12-30, pas de fuseau : calcul en UTC direct).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = brut(v);
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

/** Différence en jours entre deux dates ISO (positif si b > a). */
export function joursEntre(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (isNaN(ta) || isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.round((tb - ta) / 86_400_000);
}

/** Montant en centimes entiers : 1234.56 → 123456 ; tolère les chaînes
 *  « 1 234,56 » et « 1,234.56 ». null/NaN → 0. */
export function montantCents(v: unknown): number {
  if (typeof v === "number") return Math.round(v * 100);
  const s = brut(v).replace(/\s/g, "");
  if (!s) return 0;
  // « 1 234,56 » (virgule décimale) vs « 1,234.56 » (point décimal)
  const n =
    s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))
      ? Number(s.replace(/\./g, "").replace(",", "."))
      : Number(s.replace(/,/g, ""));
  return isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centimes → nombre décimal (affichage uniquement). */
export const centsVersMontant = (c: number): number => c / 100;

/** Clé canonique d'une pièce (journal|pièce|date normalisés). */
export const clePiece = (journal: string, piece: string, date: string): string =>
  `${normaliseJournal(journal)}|${normaliseReference(piece)}|${normaliseDate(date)}`;

/** Dédoublonne une liste de chaînes déjà normalisées. */
export const uniques = (xs: string[]): string[] => [...new Set(xs)];
