/**
 * Cartographie des journaux bancaires Sage et des comptes de trésorerie
 * (512/513) par société, fournie par l'utilisateur :
 *
 * - BNITEM 512005 (BNI MCI TEMPORAIRE) est aussi la banque de MCI CARE ;
 * - MVOMCI 513000 (M-VOLA, MCI) est la banque MVOLA (Mobile Money) de MCI CARE ;
 * - MVOTEL 513140 (M-VOLA, TELMA) est la banque MVOLA (Mobile Money) de TELMA ;
 * - MVOHOL 513110 (M-VOLA, SANLAM/ALLIANZ) est la banque MVOLA (Mobile Money)
 *   de SANLAMALLIANZ COMPAGNIE sur fixe 103.
 *
 * Sert à :
 * - étiqueter les comptes de banque avec la société de rattachement
 *   (UI, anomalies, export Excel) ;
 * - reconnaître comme « banque propre » du client un encaissement passé par
 *   son compte MVOLA (513) et non son 512 direct, sans proposer de
 *   compte-à-compte 580001 à tort (étapes 3 et 4 du schéma du cycle).
 */

export type TypeBanque = "Banque" | "Mobile Money";

export interface BanqueSociete {
  /** Mnémonique du journal bancaire Sage (BNITEM, MVOMCI…). */
  journal: string;
  /** Compte de trésorerie 512/513 rattaché au journal. */
  compte: string;
  /** Intitulé du plan comptable Sage. */
  intitule: string;
  type: TypeBanque;
  /** Opérateur mobile money (MVOLA…), sinon undefined. */
  operateur?: string;
  /** Société (client ou maison) propriétaire de la banque. */
  societe: string;
  /** Suffixes des comptes clients 46x + suffixe rattachés à cette banque. */
  suffixes: string[];
  note?: string;
}

export const BANQUES_SOCIETES: BanqueSociete[] = [
  {
    journal: "BNITEM",
    compte: "512005",
    intitule: "BNI MCI TEMPORAIRE",
    type: "Banque",
    societe: "MCI CARE",
    suffixes: [],
    note: "Banque classique (BNI) — sert aussi à MCI CARE, en complément du Mobile Money MVOMCI",
  },
  {
    journal: "MVOMCI",
    compte: "513000",
    intitule: "M-VOLA, MCI",
    type: "Mobile Money",
    operateur: "MVOLA",
    societe: "MCI CARE",
    suffixes: [],
  },
  {
    journal: "MVOTEL",
    compte: "513140",
    intitule: "M-VOLA, TELMA",
    type: "Mobile Money",
    operateur: "MVOLA",
    societe: "TELMA",
    suffixes: ["140"],
  },
  {
    journal: "MVOHOL",
    compte: "513110",
    intitule: "M-VOLA, SANLAM/ALLIANZ",
    type: "Mobile Money",
    operateur: "MVOLA",
    societe: "SANLAMALLIANZ COMPAGNIE",
    suffixes: ["103"],
    note: "Banque MVOLA (Mobile Money) de SANLAMALLIANZ COMPAGNIE sur fixe 103",
  },
];

/** Compte de trésorerie → fiche banque (512005 → BNITEM, 513110 → MVOHOL…). */
export const BANQUE_PAR_COMPTE: Map<string, BanqueSociete> = new Map(
  BANQUES_SOCIETES.map((b) => [b.compte, b]),
);

/** Suffixe client → comptes de banque acceptés (140 → 513140 MVOTEL, 103 → 513110 MVOHOL). */
export const BANQUES_PAR_SUFFIXE: Map<string, string[]> = new Map();
for (const b of BANQUES_SOCIETES)
  for (const s of b.suffixes)
    BANQUES_PAR_SUFFIXE.set(s, [...(BANQUES_PAR_SUFFIXE.get(s) ?? []), b.compte]);

/** Société → comptes de banque (MCI CARE → 512005 + 513000…). */
export const BANQUES_PAR_SOCIETE: Map<string, string[]> = new Map();
for (const b of BANQUES_SOCIETES)
  BANQUES_PAR_SOCIETE.set(b.societe, [...(BANQUES_PAR_SOCIETE.get(b.societe) ?? []), b.compte]);
