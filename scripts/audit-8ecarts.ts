/**
 * AUDIT DES 8 ÉCARTS DE RÉFÉRENCE NON EXPLIQUÉS EXACTEMENT — exécution réelle
 * du moteur sur les 3 fichiers de la mission (N, N-1, Verif BG).
 *
 * Sorties (JSON dans /home/z/my-project/scripts/) :
 *  - audit_8ecarts.json   : validation 25 contrôles (N et N+N-1), anomalies
 *                           ecart_balance, fiches rapprochement (transferts
 *                           partiels, doublons interexercices), composition
 *                           entités/familles des 8 contrôles.
 */
import { analyse, parseBrouillard, parseVerif } from "../src/lib/analyzer";
import { writeFileSync } from "node:fs";

const UP = "/home/z/my-project/upload";
const BRO_N = `${UP}/BROUILLARD 2026 27102026.xlsx`;
const BRO_N1 = `${UP}/BROUILLARD 2025 31082025.xlsx`;
const VER = `${UP}/Verif BG 27102026 VF.xlsx`;

const verifBuf = await Bun.file(VER).arrayBuffer();
const { entites, balance, ecartsReference } = parseVerif(verifBuf);
console.error(`Verif : ${entites.length} blocs, ${balance?.length ?? 0} comptes balance, ${ecartsReference.length} écarts référence`);

const lignesN = parseBrouillard(await Bun.file(BRO_N).arrayBuffer(), { fichier: "BROUILLARD 2026 27102026.xlsx" });
{
  const datesN = lignesN.map((l) => l.date).filter(Boolean).sort();
  const exN = datesN[datesN.length - 1]?.slice(0, 4) ?? "";
  for (const l of lignesN) l.exercice = exN;
}
console.error(`Brouillard N : ${lignesN.length} lignes`);

const lignesN1 = parseBrouillard(await Bun.file(BRO_N1).arrayBuffer(), { fichier: "BROUILLARD 2025 31082025.xlsx" });
{
  const datesN1 = lignesN1.map((l) => l.date).filter(Boolean).sort();
  const exN1 = datesN1[datesN1.length - 1]?.slice(0, 4) ?? "";
  for (const l of lignesN1) {
    l.exercice = exN1;
    if (!l.fichier) l.fichier = "BROUILLARD 2025 31082025.xlsx";
  }
}
console.error(`Brouillard N-1 : ${lignesN1.length} lignes`);

// --- Exécution N seul ---
const t0 = Date.now();
const resN = analyse(lignesN, entites, balance, ecartsReference);
const tN = Date.now() - t0;

// --- Exécution N + N-1 ---
const t1 = Date.now();
const resN1 = analyse(lignesN, entites, balance, ecartsReference, lignesN1);
const tN1 = Date.now() - t1;
console.error(`analyse N : ${tN} ms ; analyse N+N-1 : ${tN1} ms`);

// ---------------- Sortie JSON ----------------
const vN = resN.validation!;
const vN1 = resN1.validation!;

// Fiches de rapprochement : tous les statuts, avec ventilation N-1
const fiches = (r: typeof resN) =>
  r.rapprochements.map((c) => ({
    id: c.id,
    type: c.type,
    statut: c.statut,
    libelle: c.libelle,
    explication: c.explication,
    montantAttendu: c.montantAttendu ?? null,
    montantRapproche: c.montantRapproche ?? null,
    montantAttenduN1: c.montantAttenduN1 ?? null,
    montantRapprocheN1: c.montantRapprocheN1 ?? null,
    ecritures: (c as any).ecritures ?? null,
    pieces: ((c as any).pieces ?? []).slice(0, 12),
    pieceN1: ((c as any).pieceN1 ?? null) as any,
    clesN1: ((c as any).clesN1 ?? null) as any,
    chronologie: (c as any).chronologie ?? null,
  }));

const out = {
  meta: {
    fichiers: {
      brouillardN: "BROUILLARD 2026 27102026.xlsx",
      brouillardN1: "BROUILLARD 2025 31082025.xlsx",
      verif: "Verif BG 27102026 VF.xlsx",
    },
    feuilleReferenceReelle: "2026 (visible) — sélectionnée par parseVerif via /^\\d{4}$/",
    perf: { analyseNMs: tN, analyseNN1Ms: tN1 },
    n1: resN1.n1,
  },
  validationN: vN,
  validationNN1: vN1,
  anomaliesEcartBalance: resN.anomalies.filter((a) => a.type === "ecart_balance").map((a) => ({
    entite: a.entite, comptes: a.comptes, montant: a.montant, libelle: a.libelle,
  })),
  rapprochementsN: fiches(resN),
  rapprochementsNN1: fiches(resN1),
  entites8: [
    "TELMA SA", "EVASAN", "BOOST", "JBU", "JBS", "ORANGE MADAGASCAR",
    "ORANGE MONEY MADAGASCAR", "EVIOSYS", "STAR", "TALOUMIS", "SANLAMALLIANZ AUTOFI", "CAMUSAT",
  ].map((n) => {
    const e = resN.entites.find((x) => x.nom.toUpperCase() === n.toUpperCase());
    const f = resN.familles.find((x) => x.nom.toUpperCase() === n.toUpperCase());
    const fm = resN.familles.find((x) => x.membres.some((m) => m.toUpperCase() === n.toUpperCase()));
    return {
      nom: n,
      entite: e ? { nom: e.nom, ecart: e.ecart, comptes: e.comptes.map((c) => ({ compte: c.compte, solde: c.solde })) } : null,
      famillePropre: f ? { nom: f.nom, ecart: f.ecart, membres: f.membres, soldee: f.soldee, pieces: f.pieces.slice(0, 40) } : null,
      familleMembre: fm ? { nom: fm.nom, ecart: fm.ecart, membres: fm.membres, soldee: fm.soldee } : null,
    };
  }),
};

writeFileSync("/home/z/my-project/scripts/audit_8ecarts.json", JSON.stringify(out, null, 1));
console.error("audit_8ecarts.json écrit");

// ---------------- Résumé console ----------------
console.log("=== VALIDATION N SEUL ===");
for (const e of vN.ecarts) {
  const m = (x: number) => x.toLocaleString("fr-FR").padStart(16);
  console.log(`L${String(e.ecart.ligne).padStart(3)} ${e.ecart.bloc.slice(0, 24).padEnd(24)} ref ${m(e.ecart.montant)} calc ${m(e.montantCalcule)} rés ${m(e.residuel)} ${e.statut}`);
}
console.log("Totaux N     :", JSON.stringify(vN.totaux));
console.log("Totaux N+N-1 :", JSON.stringify(vN1.totaux));

console.log("\n=== ANOMALIES ÉCART BALANCE (N seul) ===");
for (const a of out.anomaliesEcartBalance) console.log(`  ${a.entite.padEnd(26)} ${a.comptes.padEnd(12)} ${a.montant.toLocaleString("fr-FR")} — ${a.libelle.slice(0, 90)}`);

const st = (list: ReturnType<typeof fiches>) => {
  const m: Record<string, number> = {};
  for (const f of list) m[f.statut] = (m[f.statut] ?? 0) + 1;
  return m;
};
console.log("\nRapprochements N     :", JSON.stringify(st(out.rapprochementsN)));
console.log("Rapprochements N+N-1 :", JSON.stringify(st(out.rapprochementsNN1)));
