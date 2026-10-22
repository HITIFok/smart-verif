import type { EntryLine } from "./analysis-types";
import { BANQUES_SOCIETES } from "./banques-societes";

export type SchemaRole = "appel_de_fonds" | "paiement_tiers" | "paiement_banque" | "arrivee_fonds";

/** Journaux bancaires par société (BNITEM 512005 — MCI CARE, MVOTEL 513140 — TELMA…). */
const JOURNAUX_BANQUE = BANQUES_SOCIETES.map((b) => `${b.journal} ${b.compte} (${b.societe})`).join(
  " ; ",
);

export interface LigneSchema {
  compte: string;
  /** Complément du compte, ex. « + compte tiers » pour 401000. */
  complement?: string;
  sens: "Débit" | "Crédit";
  note: string;
}

export interface EtapeSchema {
  etape: number;
  role: SchemaRole;
  journal: "TIERS" | "BANQUE";
  titre: string;
  lignes: LigneSchema[];
}

/**
 * Schéma comptable du cycle appel de fonds, tel qu'il doit être saisi :
 *
 * 1. TIERS  — appel de fonds          : 460 Débit / 467 Crédit
 * 2. TIERS  — paiement prest./client  : 467 Débit / 401000 + compte tiers Crédit
 * 3. BANQUE — paiement prest./client  : 401000 + compte tiers Débit / 512 Crédit
 * 4. BANQUE — arrivée des fonds       : 512 Débit / 460 Crédit
 *
 * Le compte 401000 + compte tiers matérialise le paiement des prestataires ou
 * des clients. Le cycle forme une boucle fermée : 460 D → 467 C → 467 D →
 * 401 C → 401 D → 512 C → 512 D → 460 C.
 */
export const SCHEMA_ECRITURES: EtapeSchema[] = [
  {
    etape: 1,
    role: "appel_de_fonds",
    journal: "TIERS",
    titre: "Appel de fonds",
    lignes: [
      { compte: "460", sens: "Débit", note: "Compte 460 du client (460 + suffixe)" },
      { compte: "467", sens: "Crédit", note: "Compte 467 du client (467 + suffixe)" },
    ],
  },
  {
    etape: 2,
    role: "paiement_tiers",
    journal: "TIERS",
    titre: "Paiement prestataire / client — côté tiers",
    lignes: [
      { compte: "467", sens: "Débit", note: "Compte 467 du client (467 + suffixe)" },
      {
        compte: "401000",
        complement: "+ compte tiers",
        sens: "Crédit",
        note: "Prestataire ou client payé (401000 + compte tiers)",
      },
    ],
  },
  {
    etape: 3,
    role: "paiement_banque",
    journal: "BANQUE",
    titre: "Paiement prestataire / client — côté banque",
    lignes: [
      {
        compte: "401000",
        complement: "+ compte tiers",
        sens: "Débit",
        note: "Prestataire ou client payé (401000 + compte tiers)",
      },
      {
        compte: "512",
        sens: "Crédit",
        note: `Banque 512/513 de la société qui décaisse (${JOURNAUX_BANQUE})`,
      },
    ],
  },
  {
    etape: 4,
    role: "arrivee_fonds",
    journal: "BANQUE",
    titre: "Arrivée des fonds en banque",
    lignes: [
      {
        compte: "512",
        sens: "Débit",
        note: `Banque 512/513 de la société qui reçoit les fonds (${JOURNAUX_BANQUE})`,
      },
      { compte: "460", sens: "Crédit", note: "Compte 460 du client (460 + suffixe)" },
    ],
  },
];

/** Chaîne du cycle, pour l'affichage : chaque étape en Débit / Crédit. */
export const CYCLE_CHAIN = SCHEMA_ECRITURES.map((e) =>
  e.lignes
    .map(
      (l) =>
        `${l.compte}${l.complement ? ` ${l.complement}` : ""} ${l.sens === "Débit" ? "D" : "C"}`,
    )
    .join(" / "),
);

const isBanque = (c: string) => c.startsWith("512") || c.startsWith("513");

/** Ligne 401 : compte général 401… avec un compte tiers (401000 + tiers). */
const is401Tiers = (l: EntryLine) =>
  l.compte.startsWith("401") && (l.tiers !== "" || l.compte === "401000");

/**
 * Identifie le rôle du cycle appel de fonds joué par une pièce.
 * Toutes les lignes de la pièce doivent participer au schéma : à la moindre
 * ligne étrangère, la pièce est hors schéma (null).
 */
export function matchPieceSchema(group: EntryLine[]): SchemaRole | null {
  if (group.length < 2) return null;
  const debit = group.filter((l) => l.debit > 0);
  const credit = group.filter((l) => l.credit > 0);
  if (debit.length === 0 || credit.length === 0) return null;
  if (debit.length + credit.length !== group.length) return null;

  // Étape 1 — TIERS : 460 D / 467 C
  if (
    debit.every((l) => l.compte.startsWith("460")) &&
    credit.every((l) => l.compte.startsWith("467"))
  )
    return "appel_de_fonds";

  // Étape 2 — TIERS : 467 D / 401000 + compte tiers C
  if (debit.every((l) => l.compte.startsWith("467")) && credit.every(is401Tiers))
    return "paiement_tiers";

  // Étape 3 — BANQUE : 401000 + compte tiers D / 512 C
  if (debit.every(is401Tiers) && credit.every((l) => isBanque(l.compte))) return "paiement_banque";

  // Étape 4 — BANQUE : 512 D / 460 C
  if (debit.every((l) => isBanque(l.compte)) && credit.every((l) => l.compte.startsWith("460")))
    return "arrivee_fonds";

  return null;
}
