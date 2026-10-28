/**
 * TESTS DU MOTEUR — situations normalisées du cahier des charges (§9) +
 * règles A/B/C + normalisation + mode de validation.
 *
 * Exécution : bun run scripts/test-moteur.ts
 * Chaque situation construit un brouillard synthétique minimal, exécute
 * analyse() du moteur réel et vérifie les statuts/attentes opposables.
 */
import { analyse, parseBrouillard, type VerifEntity } from "../src/lib/analyzer";
import type { EntryLine } from "../src/lib/analysis-types";
import { matchPieceSchema } from "../src/lib/schema-ecritures";
import {
  joursEntre,
  montantCents,
  normaliseCompte,
  normaliseDate,
  normaliseJournal,
  normaliseLibelle,
  normaliseReference,
} from "../src/lib/normalisation";
import {
  construireValidation,
  parseEcartsReference,
  type EcartReference,
} from "../src/lib/validation";
import * as XLSX from "xlsx";

let pass = 0;
let fail = 0;
const echecs: string[] = [];
function verifie(cond: boolean, nom: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    echecs.push(nom);
    console.error(`  ✗ ${nom}`);
  }
}
function egal<T>(a: T, b: T, nom: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    fail++;
    echecs.push(`${nom} — attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
    console.error(`  ✗ ${nom} — attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
  } else pass++;
}

/** Fabrique une ligne de brouillard. */
let seqLigne = 0;
function L(
  journal: string,
  piece: string,
  date: string,
  compte: string,
  tiers: string,
  libelle: string,
  debit: number,
  credit: number,
  lettrage?: string,
): EntryLine {
  seqLigne++;
  return {
    journal,
    piece,
    date,
    compte,
    tiers,
    libelle,
    debit,
    credit,
    ligne: seqLigne,
    ...(lettrage ? { lettrage } : {}),
  };
}

/** Entité de vérification minimale. */
function E(nom: string, suffixes: string[], banques: string[] = []): VerifEntity {
  const comptes = [...suffixes.flatMap((s) => [`467${s}`, `460${s}`]), ...banques];
  return { nom, suffixe: suffixes[0] ?? "", suffixesAf: [...suffixes], comptes };
}

function controle(result: ReturnType<typeof analyse>, type: string, societe?: string) {
  return result.rapprochements.filter(
    (c) => c.type === type && (!societe || c.societe === societe),
  );
}

// ====================================================================
// NORMALISATION
// ====================================================================
console.log("— Normalisation");
egal(normaliseCompte("401000.0"), "401000", "compte : suffixe flottant retiré");
egal(normaliseCompte(" 0045612 "), "0045612", "compte : zéros initiaux conservés");
egal(normaliseJournal(" boa hol "), "BOAHOL", "journal : majuscules + trim");
egal(
  normaliseReference(" 228040/F (1) "),
  "228040/F (1)",
  "référence : espaces collapsés, ponctuation conservée",
);
egal(
  normaliseLibelle("Télma -Abonnement Été"),
  "TELMA ABONNEMENT ETE",
  "libellé : accents retirés",
);
egal(normaliseDate(new Date(Date.UTC(2026, 0, 8))), "2026-01-08", "date : Date → ISO");
egal(normaliseDate("2026/1/8"), "2026-01-08", "date : AAAA/M/J → ISO");
egal(normaliseDate("08/01/2026"), "2026-01-08", "date : JJ/MM/AAAA → ISO");
egal(normaliseDate(""), "", "date : vide → vide (jamais inventée)");
egal(joursEntre("2026-01-10", "2026-02-24"), 45, "jours : 45 jours exactement");
egal(montantCents("1 234,56"), 123456, "montant : chaîne FR en centimes");
egal(montantCents(9600.01), 960001, "montant : arrondi au centime");

// ====================================================================
// PARSE BROUILLARD (situations 15 et 18 : lignes de titre, vides, dates)
// ====================================================================
console.log("— Import Excel robuste (situations 15 et 18)");
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["MCI CARE — export du 27/10/2026"],
      [],
      [
        "Code journal",
        "Date",
        "N° pièce",
        "N° facture",
        "Référence",
        "N° compte général",
        "N° compte tiers",
        "Libellé écriture",
        "Lettrage montant",
        "Débit",
        "Crédit",
      ],
      [
        "BOAHOL",
        new Date(Date.UTC(2026, 0, 8)),
        2852,
        "FAC-1",
        "2026-01-08",
        "627000",
        "",
        "FRAIS BANQUE",
        "*",
        8000,
        "",
      ],
      [],
      ["BOAHOL", "2026/1/8", 2853, "", "", "512110", "", "FRAIS BANQUE", "", "", 8000],
      ["BOAHOL", "08/01/2026", 2854, "", "", "", "", "ligne sans compte", "", "", ""],
      ["BOAHOL", "09/01/2026", 2855, "", "", "401000", "T1", "PAIEMENT T1", "A", 5000, ""],
    ]),
    "Feuil1",
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const lignes = parseBrouillard(buf);
  egal(lignes.length, 3, "import : lignes de titre/vides/sans compte ignorées");
  egal(lignes[0]?.ligne, 4, "import : n° de ligne Excel conservé (1 = en-tête)");
  egal(lignes[0]?.date, "2026-01-08", "import : date Excel → ISO");
  egal(lignes[1]?.date, "2026-01-08", "import : date texte AAAA/M/J → ISO");
  egal(lignes[2]?.date, "2026-01-09", "import : date JJ/MM/AAAA → ISO");
  egal(lignes[0]?.facture, "FAC-1", "import : n° facture capturé");
  egal(lignes[0]?.lettrage, undefined, "import : « * » n'est pas un lettrage");
  egal(lignes[2]?.lettrage, "A", "import : code de lettrage capturé");
}

// ====================================================================
// RÈGLE C — frais bancaires 627 (situations 1 à 4, 11, 16, 17)
// ====================================================================
function fixtureFrais(): { lignes: EntryLine[]; verif: VerifEntity[] } {
  return {
    lignes: [
      // frais débités sur BOAHOL (banque HOLCIM)
      L("BOAHOL", "1", "2026-01-10", "627000", "", "FRAIS BANQUE", 8000, 0),
      L("BOAHOL", "1", "2026-01-10", "445600", "", "TVA FRAIS", 1600, 0),
      L("BOAHOL", "1", "2026-01-10", "512110", "", "", 0, 9600),
    ],
    verif: [E("HOLCIM", ["110"], ["512110"]), E("MCI CARE", [], ["512000"])],
  };
}
console.log("— Règle C 627");
{
  // Situation 1 : transfert intégral correctement effectué
  const f = fixtureFrais();
  f.lignes.push(
    L("BOAMCI", "9", "2026-01-15", "580001", "", "", 9600, 0),
    L("BOAMCI", "9", "2026-01-15", "512000", "", "", 0, 9600),
    L("BOAHOL", "10", "2026-01-15", "512110", "", "", 9600, 0),
    L("BOAHOL", "10", "2026-01-15", "580001", "", "", 0, 9600),
  );
  const r = analyse(f.lignes, f.verif);
  const c = controle(r, "C_627", "HOLCIM");
  egal(c.length, 1, "C1 : un contrôle par banque");
  egal(c[0]?.statut, "correspondance_trouvee", "C1 : transfert intégral → correspondance");
  egal(c[0]?.ecartRestant, 0, "C1 : restant 0,00");
  egal(c[0]?.montantAttendu, 9600, "C1 : attendu = frais + TVA");
}
{
  // Situation 2 : transfert absent
  const r = analyse(fixtureFrais().lignes, fixtureFrais().verif);
  const c = controle(r, "C_627", "HOLCIM");
  egal(c[0]?.statut, "transfert_absent", "C2 : aucun remboursement → transfert absent");
  egal(c[0]?.ecartRestant, 9600, "C2 : restant = attendu");
  verifie(
    !r.anomalies.some((a) => a.piece === "1" && a.type === "hors_perimetre"),
    "C2 : les frais ne sont pas une anomalie pièce à pièce",
  );
}
{
  // Situation 3 : transfert partiel
  const f = fixtureFrais();
  f.lignes.push(
    L("BOAMCI", "9", "2026-01-15", "580001", "", "", 5000, 0),
    L("BOAMCI", "9", "2026-01-15", "512000", "", "", 0, 5000),
    L("BOAHOL", "10", "2026-01-20", "512110", "", "", 5000, 0),
    L("BOAHOL", "10", "2026-01-20", "580001", "", "", 0, 5000),
  );
  const r = analyse(f.lignes, f.verif);
  const c = controle(r, "C_627", "HOLCIM");
  egal(c[0]?.statut, "transfert_partiel", "C3 : remboursement partiel");
  egal(c[0]?.montantRapproche, 5000, "C3 : rapproché 5 000");
  egal(c[0]?.ecartRestant, 4600, "C3 : restant 4 600");
}
{
  // Situation 4 : transfert excédentaire (remboursement unique > attendu)
  const f = fixtureFrais();
  f.lignes.push(
    L("BOAMCI", "9", "2026-01-15", "580001", "", "", 20000, 0),
    L("BOAMCI", "9", "2026-01-15", "512000", "", "", 0, 20000),
    L("BOAHOL", "10", "2026-01-15", "512110", "", "", 20000, 0),
    L("BOAHOL", "10", "2026-01-15", "580001", "", "", 0, 20000),
  );
  const r = analyse(f.lignes, f.verif);
  const c = controle(r, "C_627", "HOLCIM");
  egal(c[0]?.statut, "transfert_excedentaire", "C4 : remboursement unique 20 000 > attendu 9 600");
  egal(c[0]?.montantRapproche, 20000, "C4 : rapproché 20 000");
}
{
  // Situation 11 : régulation inverse (512 D / 627 C) — rien attendu
  const f = fixtureFrais();
  f.lignes.length = 0;
  f.lignes.push(
    L("BOAHOL", "20", "2026-01-10", "512110", "", "", 9600, 0),
    L("BOAHOL", "20", "2026-01-10", "627000", "", "", 0, 9600),
  );
  const r = analyse(f.lignes, f.verif);
  egal(controle(r, "C_627").length, 0, "C11 : régulation inverse → aucun contrôle attendu");
  egal(
    matchPieceSchema(f.lignes.filter((l) => l.piece === "20")),
    "frais_bancaires",
    "C11 : pièce reconnue frais_bancaires",
  );
}
{
  // Situation 16 : écart résiduel de quelques centimes
  const f = fixtureFrais();
  f.lignes.push(
    L("BOAMCI", "9", "2026-01-15", "580001", "", "", 9599.99, 0),
    L("BOAMCI", "9", "2026-01-15", "512000", "", "", 0, 9599.99),
    L("BOAHOL", "10", "2026-01-15", "512110", "", "", 9599.99, 0),
    L("BOAHOL", "10", "2026-01-15", "580001", "", "", 0, 9599.99),
  );
  const r = analyse(f.lignes, f.verif);
  const c = controle(r, "C_627", "HOLCIM");
  egal(c[0]?.statut, "transfert_partiel", "C16 : 0,01 d'écart n'est pas arrondi à zéro");
  egal(c[0]?.ecartRestant, 0.01, "C16 : restant 0,01 au centime");
}
{
  // Situation 17 : un même envoi MCI ne peut pas couvrir deux banques
  const f = fixtureFrais();
  f.verif.push(E("TELMA", ["140"], ["512140"]));
  f.lignes.push(
    L("BOATSA", "30", "2026-02-01", "627000", "", "FRAIS BANQUE", 8000, 0),
    L("BOATSA", "30", "2026-02-01", "445600", "", "TVA FRAIS", 1600, 0),
    L("BOATSA", "30", "2026-02-01", "512140", "", "", 0, 9600),
    // UN seul envoi 9600 depuis MCI, reçu seulement sur 512110
    L("BOAMCI", "31", "2026-02-02", "580001", "", "", 9600, 0),
    L("BOAMCI", "31", "2026-02-02", "512000", "", "", 0, 9600),
    L("BOAHOL", "32", "2026-02-02", "512110", "", "", 9600, 0),
    L("BOAHOL", "32", "2026-02-02", "580001", "", "", 0, 9600),
  );
  const r = analyse(f.lignes, f.verif);
  const cHOL = controle(r, "C_627", "HOLCIM")[0];
  const cTEL = controle(r, "C_627", "TELMA")[0];
  egal(cHOL?.statut, "correspondance_trouvee", "C17 : 512110 couvert");
  egal(cTEL?.statut, "transfert_absent", "C17 : 512140 non couvert — pas de double comptage");
}

// ====================================================================
// RÈGLE A — honoraires 411 (situations 5, 6) + paiements (7, 8, 12)
// ====================================================================
console.log("— Règle A 411 / paiements");
{
  // Situation 5 : paiement regroupant plusieurs factures (N → 1)
  const lignes = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("BOATSA", "2", "2026-01-05", "411140", "CLTTEL", "HONORAIRES JANVIER", 0, 1000),
    L("BOATSA", "2", "2026-01-05", "512140", "", "", 1000, 0),
    L("BOATSA", "3", "2026-01-06", "411140", "CLTTEL", "HONORAIRES FEVRIER", 0, 1000),
    L("BOATSA", "3", "2026-01-06", "512140", "", "", 1000, 0),
    L("BOATSA", "4", "2026-01-20", "580001", "", "", 2000, 0),
    L("BOATSA", "4", "2026-01-20", "512140", "", "", 0, 2000),
    L("BOAMCI", "5", "2026-01-21", "512000", "", "", 2000, 0),
    L("BOAMCI", "5", "2026-01-21", "580001", "", "", 0, 2000),
  ];
  const r = analyse(lignes, [E("TELMA", ["140"], ["512140"]), E("MCI CARE", [], ["512000"])]);
  const c = controle(r, "A_411", "TELMA");
  egal(c.length, 1, "A5 : contrôle par banque");
  egal(c[0]?.montantAttendu, 2000, "A5 : attendu = Σ 411 (2 factures)");
  egal(c[0]?.montantRapproche, 2000, "A5 : un transfert de 2 000 couvre les deux");
  egal(c[0]?.statut, "correspondance_trouvee", "A5 : statut correspondance");
}
{
  // Situation 6 : plusieurs écritures pour un seul transfert (1 → N)
  const lignes = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("BOATSA", "2", "2026-01-05", "411140", "CLTTEL", "HONORAIRES", 0, 2000),
    L("BOATSA", "2", "2026-01-05", "512140", "", "", 2000, 0),
    L("BOATSA", "3", "2026-01-20", "580001", "", "", 1000, 0),
    L("BOATSA", "3", "2026-01-20", "512140", "", "", 0, 1000),
    L("BOATSA", "4", "2026-01-21", "580001", "", "", 1000, 0),
    L("BOATSA", "4", "2026-01-21", "512140", "", "", 0, 1000),
    L("BOAMCI", "5", "2026-01-22", "512000", "", "", 1000, 0),
    L("BOAMCI", "5", "2026-01-22", "580001", "", "", 0, 1000),
    L("BOAMCI", "6", "2026-01-23", "512000", "", "", 1000, 0),
    L("BOAMCI", "6", "2026-01-23", "580001", "", "", 0, 1000),
  ];
  const r = analyse(lignes, [E("TELMA", ["140"], ["512140"]), E("MCI CARE", [], ["512000"])]);
  const c = controle(r, "A_411", "TELMA")[0];
  egal(c?.montantRapproche, 2000, "A6 : 2 transferts de 1 000 couvrent 2 000");
  egal(c?.statut, "correspondance_trouvee", "A6 : statut correspondance");
}
{
  // Situation 7 : paiement décaissé par le mauvais journal (mauvais client)
  const lignes = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("TIERS", "10", "2026-01-05", "467140", "", "Prestataire payé pour TELMA", 500, 0),
    L("TIERS", "10", "2026-01-05", "401000", "T1", "Prestataire payé pour TELMA", 0, 500),
    L("BOAHOL", "11", "2026-01-06", "401000", "T1", "Prestataire payé pour TELMA", 500, 0),
    L("BOAHOL", "11", "2026-01-06", "512110", "", "", 0, 500),
  ];
  const r = analyse(lignes, [
    E("TELMA", ["140"], ["512140"]),
    E("HOLCIM", ["110"], ["512110"]),
    E("MCI CARE", [], ["512000"]),
  ]);
  const c = controle(r, "A_paiement");
  egal(c.length, 1, "A7 : le paiement décaissé par HOLCIM pour TELMA est signalé");
  egal(c[0]?.statut, "erreur_imputation_probable", "A7 : statut erreur d'imputation probable");
  egal(c[0]?.societe, "TELMA", "A7 : rattaché à TELMA");
  egal(c[0]?.ecartRestant, 500, "A7 : restant 500 (aucun CàC de régularisation)");
}
{
  // Situation 8 : deux clients au même tiers+montant → pas de fausse accusation
  const lignes = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("TIERS", "10", "2026-01-05", "467140", "", "Prestataire A", 500, 0),
    L("TIERS", "10", "2026-01-05", "401000", "T1", "Prestataire A", 0, 500),
    L("TIERS", "11", "2026-01-05", "467110", "", "Prestataire B", 500, 0),
    L("TIERS", "11", "2026-01-05", "401000", "T1", "Prestataire B", 0, 500),
    L("BOAHOL", "12", "2026-01-06", "401000", "T1", "Prestataire A", 500, 0),
    L("BOAHOL", "12", "2026-01-06", "512110", "", "", 0, 500),
  ];
  const r = analyse(lignes, [
    E("TELMA", ["140"], ["512140"]),
    E("HOLCIM", ["110"], ["512110"]),
    E("MCI CARE", [], ["512000"]),
  ]);
  egal(controle(r, "A_paiement").length, 0, "A8 : ambiguïté 2 clients → aucune accusation");
}
{
  // Situation 12 : écriture annulée — jamais une anomalie
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("BOAHOL", "10", "2026-01-05", "512110", "", "", 500, 0),
    L("BOAHOL", "10", "2026-01-05", "401000", "T9", "Paiement annulé", 0, 500),
  ];
  const r = analyse(lignes, [E("HOLCIM", ["110"], ["512110"]), E("MCI CARE", [], ["512000"])]);
  egal(
    matchPieceSchema(lignes.filter((l) => l.piece === "10")),
    "annulation_paiement",
    "A12 : rôle annulation_paiement",
  );
  egal(r.anomalies.length, 0, "A12 : aucune anomalie sur l'annulation");
}

// ====================================================================
// RÈGLE A — doublons (situation 13) + lettrage Sage (9)
// ====================================================================
console.log("— Doublons");
{
  // Doublon réel : 2 pièces identiques non lettrées
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("BOAHOL", "10", "2026-01-05", "401000", "T1", "MISSION TULEAR", 230000, 0),
    L("BOAHOL", "10", "2026-01-05", "512110", "", "", 0, 230000),
    L("BOAHOL", "11", "2026-01-05", "401000", "T1", "MISSION TULEAR", 230000, 0),
    L("BOAHOL", "11", "2026-01-05", "512110", "", "", 0, 230000),
  ];
  const r = analyse(lignes, [E("HOLCIM", ["110"], ["512110"]), E("MCI CARE", [], ["512000"])]);
  const c = controle(r, "A_doublon");
  egal(c.length, 1, "A13a : doublon réel détecté");
  egal(c[0]?.statut, "doublon_potentiel", "A13a : statut doublon potentiel");
  egal(c[0]?.refPiece, "10 + 11", "A13a : les deux pièces citées");
}
{
  // Faux doublon : opérations différentes (tiers distinct) OU soldées Sage
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    // tiers différents, même montant + libellé : PAS un doublon
    L("BOAHOL", "10", "2026-01-05", "401000", "T1", "MISSION TULEAR", 230000, 0),
    L("BOAHOL", "10", "2026-01-05", "512110", "", "", 0, 230000),
    L("BOAHOL", "11", "2026-01-05", "401000", "T2", "MISSION TULEAR", 230000, 0),
    L("BOAHOL", "11", "2026-01-05", "512110", "", "", 0, 230000),
    // lettrées Sage : PAS un doublon
    L("BOAHOL", "12", "2026-02-05", "401000", "T3", "MISSION TAMATAVE", 90000, 0, "AB"),
    L("BOAHOL", "12", "2026-02-05", "512110", "", "", 0, 90000),
    L("BOAHOL", "13", "2026-02-05", "401000", "T3", "MISSION TAMATAVE", 90000, 0, "CD"),
    L("BOAHOL", "13", "2026-02-05", "512110", "", "", 0, 90000),
    L("TIERS", "14", "2026-02-05", "467110", "", "Facturation Janvier", 180000, 0),
    L("TIERS", "14", "2026-02-05", "401000", "T3", "Facturation Janvier", 0, 90000, "AB"),
    L("TIERS", "15", "2026-02-05", "467110", "", "Facturation Février", 180000, 0),
    L("TIERS", "15", "2026-02-05", "401000", "T3", "Facturation Février", 0, 90000, "CD"),
  ];
  const r = analyse(lignes, [E("HOLCIM", ["110"], ["512110"]), E("MCI CARE", [], ["512000"])]);
  egal(
    controle(r, "A_doublon").length,
    0,
    "A13b : tiers distincts et lettrées Sage → aucun doublon",
  );
}
{
  // Situation 9 : même montant mais opérations différentes (libellés distincts)
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("BOAHOL", "10", "2026-01-05", "401000", "T1", "CARBURANT JANVIER", 600000, 0),
    L("BOAHOL", "10", "2026-01-05", "512110", "", "", 0, 600000),
    L("BOAHOL", "11", "2026-02-05", "401000", "T1", "CARBURANT FEVRIER", 600000, 0),
    L("BOAHOL", "11", "2026-02-05", "512110", "", "", 0, 600000),
  ];
  const r = analyse(lignes, [E("HOLCIM", ["110"], ["512110"]), E("MCI CARE", [], ["512000"])]);
  egal(controle(r, "A_doublon").length, 0, "A9 : libellés différents (mois) → pas un doublon");
}

// ====================================================================
// RÈGLE B — 460/462 (situations 10, 14, 11b)
// ====================================================================
console.log("— Règle B 460/462");
{
  // 460 du bon suffixe dans son journal : aucun contrôle
  const lignes = [
    L("RAN", "1", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("BOATSA", "10", "2026-01-10", "460140", "", "Virement reçu appel de fonds", 0, 500000),
    L("BOATSA", "10", "2026-01-10", "512140", "", "", 500000, 0),
  ];
  const r = analyse(lignes, [E("TELMA", ["140"], ["512140"]), E("MCI CARE", [], ["512000"])]);
  egal(controle(r, "B_460_462").length, 0, "B1 : imputation cohérente → pas de contrôle");
}
{
  // Situation 10/14 : 460 d'un autre client, régularisation dans la fenêtre
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467140", "", "", 0, 1_000_000),
    // 460 TELMA encaissé sur la banque HOLCIM (mauvais journal)
    L("BOAHOL", "10", "2026-01-10", "460140", "", "Virement reçu TELMA", 0, 500000),
    L("BOAHOL", "10", "2026-01-10", "512110", "", "", 500000, 0),
    // régularisation 40 jours plus tard (dans la fenêtre de 45 j)
    L("BOAHOL", "11", "2026-02-19", "580001", "", "", 500000, 0),
    L("BOAHOL", "11", "2026-02-19", "512110", "", "", 0, 500000),
    L("BOATSA", "12", "2026-02-19", "512140", "", "", 500000, 0),
    L("BOATSA", "12", "2026-02-19", "580001", "", "", 0, 500000),
  ];
  const r = analyse(lignes, [
    E("TELMA", ["140"], ["512140"]),
    E("HOLCIM", ["110"], ["512110"]),
    E("MCI CARE", [], ["512000"]),
  ]);
  const c = controle(r, "B_460_462");
  egal(c.length, 1, "B2 : l'imputation hors banque est contrôlée");
  egal(
    c[0]?.statut,
    "correspondance_trouvee",
    "B2 : CàC de régularisation dans la fenêtre → correspondance",
  );
  egal(c[0]?.confiance, "élevée", "B2 : confiance élevée (paire exacte)");
}
{
  // 460 hors fenêtre : pas de contrepartie dans ±45 j → probable, pas confirmée
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("BOAHOL", "10", "2026-01-10", "460140", "", "Virement reçu TELMA", 0, 500000),
    L("BOAHOL", "10", "2026-01-10", "512110", "", "", 500000, 0),
    // régularisation 81 jours plus tard (HORS fenêtre)
    L("BOAHOL", "11", "2026-04-01", "580001", "", "", 500000, 0),
    L("BOAHOL", "11", "2026-04-01", "512110", "", "", 0, 500000),
    L("BOATSA", "12", "2026-04-01", "512140", "", "", 500000, 0),
    L("BOATSA", "12", "2026-04-01", "580001", "", "", 0, 500000),
  ];
  const r = analyse(lignes, [
    E("TELMA", ["140"], ["512140"]),
    E("HOLCIM", ["110"], ["512110"]),
    E("MCI CARE", [], ["512000"]),
  ]);
  const c = controle(r, "B_460_462")[0];
  egal(c?.statut, "erreur_imputation_probable", "B3 : hors fenêtre → probable (jamais confirmée)");
  egal(c?.confiance, "moyenne", "B3 : confiance moyenne");
}
{
  // 460 hors banque mais soldé par lettrage Sage → correspondance
  const lignes = [
    L("RAN", "1", "2026-01-01", "512110", "", "", 1_000_000, 0),
    L("RAN", "1", "2026-01-01", "467110", "", "", 0, 1_000_000),
    L("RAN", "2", "2026-01-01", "512140", "", "", 1_000_000, 0),
    L("RAN", "2", "2026-01-01", "467140", "", "", 0, 1_000_000),
    L("BOAHOL", "10", "2026-01-10", "460140", "", "Virement reçu TELMA", 0, 500000, "ZZ"),
    L("BOAHOL", "10", "2026-01-10", "512110", "", "", 500000, 0),
    L("TIERS", "11", "2026-01-10", "460140", "", "Régularisation lettrée", 500000, 0, "ZZ"),
    L("TIERS", "11", "2026-01-10", "467140", "", "Régularisation lettrée", 0, 500000),
  ];
  const r = analyse(lignes, [
    E("TELMA", ["140"], ["512140"]),
    E("HOLCIM", ["110"], ["512110"]),
    E("MCI CARE", [], ["512000"]),
  ]);
  const c = controle(r, "B_460_462")[0];
  egal(c?.statut, "correspondance_trouvee", "B4 : pièce soldée par lettrage Sage → correspondance");
}

// ====================================================================
// VALIDATION (mode de validation, mission §8)
// ====================================================================
console.log("— Validation Feuil2");
{
  const rows = [
    ["HOLCIM", "DEBIT", "CREDIT", "SOLDE"],
    ["", "467110", 0, -20850876.759999752, -20850876.759999752],
    ["", "460110", 18875341.600000024, 0, 18875341.600000024],
    ["", "Solde Appel de fonds", 18875341.600000024, 21020976.759999752, -2145635.159999728],
    ["", "512110", 2084014, 0, 2084014],
    ["", "Solde Trésorerie", 2084014, 0, 2084014],
    [],
    ["Vérification", -61621.1599997282],
    ["TELMA SA", "DEBIT", "CREDIT", "SOLDE"],
    ["", "467140", 0, 0, 0],
    ["", "Solde Appel de fonds", 0, 0, 0],
    ["", "512140", 1726184, 0, 1726184],
    ["", "Solde Trésorerie", 1726184, 0, 1726184],
    ["", "", "", "", "", "Vérification", 1726184.000000827],
  ];
  const refs = parseEcartsReference(rows, 8);
  egal(refs.length, 2, "V1 : deux écarts extraits (principale + latérale)");
  egal(refs[0]?.type, "entite", "V1 : principale → entité");
  egal(refs[0]?.montant, -61621.16, "V1 : bruit flottant arrondi au centime");
  egal(refs[1]?.type, "famille", "V1 : latérale → famille");
  egal(refs[1]?.bloc, "TELMA SA", "V1 : bloc correct pour le contrôle latéral");

  const result = {
    entites: [
      {
        nom: "HOLCIM",
        suffixe: "110",
        appelDeFonds: -18966635.16,
        tresorerie: 2084014,
        ecart: -61621.16,
        anomalies: 0,
        montantAnomalies: 0,
        comptes: [],
      },
    ],
    familles: [
      {
        nom: "TELMA SA",
        membres: ["TELMA SA", "EVASAN"],
        appelDeFonds: 0,
        tresorerie: 1726184,
        ecart: 1726184,
        soldee: false,
        pieces: [],
        ranNonConsidere: 0,
        nbRanNonConsidere: 0,
        combinaisons: [],
        nbVariantesCombinaison: 0,
        combinaisonEchec: false,
      },
    ],
    anomalies: [],
  } as unknown as Parameters<typeof construireValidation>[0];
  const rapport = construireValidation(result, refs);
  egal(rapport.totaux.nbExpliquesExact, 2, "V2 : les deux écarts reproduits au centime");
  egal(rapport.totaux.nbReutilisationsConflit, 0, "V2 : aucune réutilisation conflictuelle");
  egal(rapport.ecarts[0]?.objet, "entité HOLCIM", "V2 : objet rapproché correct");
}
{
  // Cas limites : partiel, incorrect, non expliqué
  const refs: EcartReference[] = [
    { bloc: "BOOST", ligne: 10, colonne: 1, type: "entite", montant: -7714120.58 },
    { bloc: "AITS", ligne: 20, colonne: 1, type: "entite", montant: 149319.8 },
    { bloc: "INCONNU", ligne: 30, colonne: 1, type: "entite", montant: 5000 },
  ];
  const result = {
    entites: [
      {
        nom: "BOOST",
        suffixe: "320",
        appelDeFonds: 900000,
        tresorerie: 100000,
        ecart: 1000000,
        anomalies: 0,
        montantAnomalies: 0,
        comptes: [],
      },
      {
        nom: "AITS",
        suffixe: "210",
        appelDeFonds: 149000,
        tresorerie: 0,
        ecart: 149000,
        anomalies: 0,
        montantAnomalies: 0,
        comptes: [],
      },
    ],
    familles: [],
    anomalies: [],
  } as unknown as Parameters<typeof construireValidation>[0];
  const rapport = construireValidation(result, refs);
  egal(
    rapport.ecarts[0]?.statut,
    "correspondance_incorrecte",
    "V3 : résiduel massif → incorrect (à revue)",
  );
  egal(
    rapport.ecarts[1]?.statut,
    "explique_partiel",
    "V3 : résiduel dans la matérialité (0,5 %) → partiel",
  );
  egal(rapport.ecarts[2]?.statut, "non_explique", "V3 : objet introuvable → non expliqué");
  egal(rapport.totaux.nbReferences, 3, "V3 : total des références");
}

// ====================================================================
console.log(`\n${pass} test(s) OK, ${fail} échec(s)`);
if (fail > 0) {
  console.error("Échecs :", echecs.join("\n  "));
  process.exit(1);
}
