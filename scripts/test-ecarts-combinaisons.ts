/**
 * Tests unitaires du détecteur de combinaisons exactes (src/lib/ecarts.ts).
 * Principe comptable : l'écart de la feuille 2 du Verif BG correspond à la
 * somme des écritures erronées, et un écart peut être composé de PLUSIEURS
 * écritures erronées — pas toujours d'une seule. Ex. écart 90 000 formé de
 * 48 000 + 2 000 + 40 000.
 * Exécution : npx esbuild scripts/test-ecarts-combinaisons.ts --bundle
 *   --format=cjs --platform=node --outfile=/tmp/t-ecarts.cjs && node /tmp/t-ecarts.cjs
 */
import { resoudreEcartFamille } from "../src/lib/ecarts";
import type { PieceEcart, PieceEcartRole } from "../src/lib/analysis-types";

let pass = 0;
let fail = 0;
const check = (nom: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${nom}`);
  } else {
    fail++;
    console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}`);
  }
};

const piece = (
  journal: string,
  piece: string,
  net: number,
  opts?: { anomalie?: boolean; role?: PieceEcartRole },
): PieceEcart => ({
  journal,
  piece,
  date: "2026-01-01",
  libelle: `libellé ${piece}`,
  comptes: "460000",
  comptesTous: "460000, 512000",
  net,
  role: opts?.role ?? "paiement_banque",
  anomalie: opts?.anomalie ?? false,
});

const cents = (n: number) => Math.round(n * 100);

// 1. Exemple de l'utilisateur : écart 90 000 = 48 000 + 2 000 + 40 000
console.log("\n1. Écart 90 000 composé de trois écritures erronées (48 000 + 2 000 + 40 000)");
const cas1 = [
  piece("BNI", "101", 48000),
  piece("BNI", "102", 2000),
  piece("BNI", "103", 40000),
  piece("BNI", "104", 250000),
  piece("BNI", "105", -120000),
  piece("BNI", "106", 7000),
  piece("BNI", "107", -9000),
];
const r1 = resoudreEcartFamille(cas1, 90000, 0);
const s1 = r1.solutions[0];
check("une combinaison est trouvée", r1.solutions.length > 0 && !r1.echec);
check(
  "combinaison de 3 écritures",
  s1?.pieces.length === 3,
  `taille=${s1?.pieces.length}`,
);
check(
  "somme exacte = 90 000,00",
  s1 !== undefined && cents(s1.somme) === 9000000 && cents(s1.cible) === 9000000,
  `somme=${s1?.somme}`,
);
check(
  "ce sont les pièces 48 000 / 2 000 / 40 000",
  s1 !== undefined &&
    new Set(s1.pieces.map((p) => p.piece)).size === 3 &&
    s1.pieces.every((p) => ["101", "102", "103"].includes(p.piece)),
  s1?.pieces.map((p) => `${p.piece}:${p.net}`).join(", ") ?? "",
);
check("portée « feuille »", s1?.portee === "feuille");
check(
  "pièces marquées erronées",
  s1 !== undefined && s1.pieces.every((p) => p.dansCombinaison === true),
);

// 2. Une seule écriture erronée (cas TOM réel : TIERS 3609 = 90 000)
console.log("\n2. Écart 90 000 causé par une seule écriture (cas TOM réel)");
const cas2 = [
  piece("TIERS", "3609", 90000),
  piece("BNI", "201", 12000),
  piece("BNI", "202", -12000),
  piece("BNI", "203", 30000),
  piece("BNI", "204", -30000),
];
const r2 = resoudreEcartFamille(cas2, 90000, 0);
check(
  "la pièce isolée 90 000 est détectée seule (taille 1)",
  r2.solutions[0]?.pieces.length === 1 && r2.solutions[0]?.pieces[0]?.piece === "3609",
  JSON.stringify(r2.solutions[0]?.pieces.map((p) => p.piece)),
);
check("pas de bruit : 1 seule variante", r2.nbTotal === 1, `nbTotal=${r2.nbTotal}`);

// 3. Deux écritures erronées (1 000 + 1 000 = 2 000 — régularisation groupée)
console.log("\n3. Écart 2 000 = 1 000 + 1 000 (deux écritures)");
const cas3 = [
  piece("MVOMCI", "301", 1000),
  piece("MVOMCI", "302", 1000),
  piece("BNI", "303", 45000),
  piece("BNI", "304", -45000),
  piece("BNI", "305", 12300),
];
const r3 = resoudreEcartFamille(cas3, 2000, 0);
check(
  "combinaison de 2 écritures de 1 000",
  r3.solutions[0]?.pieces.length === 2 &&
    r3.solutions[0]?.pieces.every((p) => p.net === 1000),
  JSON.stringify(r3.solutions[0]?.pieces.map((p) => p.net)),
);
check(
  "variantes dédupliquées (montants identiques)",
  r3.nbTotal === 1,
  `nbTotal=${r3.nbTotal}`,
);

// 4. Écart négatif : -50 000 = -30 000 + -20 000
console.log("\n4. Écart négatif -50 000 = -30 000 + -20 000");
const cas4 = [
  piece("BNI", "401", -30000),
  piece("BNI", "402", -20000),
  piece("BNI", "403", 80000),
  piece("BNI", "404", -15000),
];
const r4 = resoudreEcartFamille(cas4, -50000, 0);
check(
  "combinaison de 2 écritures négatives",
  r4.solutions[0]?.pieces.length === 2 &&
    cents(r4.solutions[0]?.somme ?? 0) === -5000000,
  JSON.stringify(r4.solutions[0]?.pieces.map((p) => p.net)),
);

// 5. Aucune combinaison exacte : échec honnête, pas de fausse piste
console.log("\n5. Aucune combinaison possible (écart 7 avec 3 000 + 3 000)");
const cas5 = [piece("BNI", "501", 3000), piece("BNI", "502", 3000)];
const r5 = resoudreEcartFamille(cas5, 7, 0);
check("echec=true, aucune solution", r5.echec && r5.solutions.length === 0);

// 6. RAN non considérés : la portée « hors_ran » fournit la piste exacte
console.log("\n6. Écart feuille 90 000 avec RAN non considérés 40 000 → cible 50 000 [hors_ran]");
const cas6 = [
  piece("BNI", "601", 50000),
  piece("BNI", "602", 30000),
  piece("BNI", "603", 25000),
  piece("BNI", "604", -12000),
];
const r6 = resoudreEcartFamille(cas6, 90000, 40000);
check(
  "aucune combinaison en portée « feuille » n'existe pour 90 000",
  r6.solutions.length === 0 || r6.solutions.every((s) => s.portee === "hors_ran"),
);
const r6b = r6.solutions[0];
check(
  "la cible 50 000 (hors RAN) est résolue par la pièce isolée, portée hors_ran",
  r6b !== undefined &&
    r6b.portee === "hors_ran" &&
    r6b.pieces.length === 1 &&
    r6b.pieces[0]?.piece === "601" &&
    cents(r6b.cible) === 5000000,
  JSON.stringify(r6.solutions[0]?.pieces.map((p) => p.piece)),
);

// 7. Priorité comptable : à taille égale, les écritures suspectes d'abord
console.log("\n7. Deux solutions de taille 1 : l'écriture suspecte (anomalie) est présentée en premier");
const cas7 = [
  piece("BNI", "701", 10000),
  piece("OD", "702", 10000, { anomalie: true, role: "autre" }),
  piece("BNI", "703", 4000),
];
const r7 = resoudreEcartFamille(cas7, 10000, 0);
check(
  "la variante suspecte est retenue (dédupliquée, suspects d'abord)",
  r7.solutions[0]?.pieces[0]?.anomalie === true && r7.nbTotal === 1,
  JSON.stringify(r7.solutions.map((s) => s.pieces.map((p) => p.piece))),
);

// 8. Écritures qui se compensent : elles ne polluent pas la taille minimale
console.log("\n8. Paires qui se compensent (débit/crédit identiques) autour de la vraie erreur");
const cas8 = [
  piece("BNI", "801", 250000),
  piece("BNI", "802", -250000),
  piece("BNI", "803", 90000),
  piece("BNI", "804", -1000),
  piece("BNI", "805", 1000),
];
const r8 = resoudreEcartFamille(cas8, 90000, 0);
check(
  "la vraie erreur 90 000 est isolée (taille 1)",
  r8.solutions[0]?.pieces.length === 1 && r8.solutions[0]?.pieces[0]?.piece === "803",
  JSON.stringify(r8.solutions[0]?.pieces.map((p) => p.piece)),
);

// 9. Montants à décimales (0,32 + 0,08 = 0,40 — cas AITS réel)
console.log("\n9. Montants à décimales : 0,32 + 0,08 = 0,40 (cas AITS réel)");
const cas9 = [
  piece("OD", "901", 0.32),
  piece("OD", "902", 0.08),
  piece("BNI", "903", 1520000),
  piece("BNI", "904", -1520000),
];
const r9 = resoudreEcartFamille(cas9, 0.4, -1520000);
check(
  "les deux écritures 0,32 + 0,08 sont détectées (portée feuille)",
  r9.solutions[0]?.pieces.length === 2 &&
    r9.solutions[0]?.portee === "feuille" &&
    cents(r9.solutions[0]?.somme ?? 0) === 40,
  JSON.stringify(r9.solutions[0]?.pieces.map((p) => p.net)),
);

// 10. Robustesse : beaucoup de pièces, cible absente (bornes de sécurité)
console.log("\n10. Robustesse : 600 pièces pseudo-aléatoires, cible absente");
const cas10: PieceEcart[] = [];
let seed = 42;
const alea = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return (seed % 200000) - 100000;
};
for (let i = 0; i < 600; i++) cas10.push(piece("BNI", String(1000 + i), alea() + 0.01 * (i % 7)));
const t10 = Date.now();
const r10 = resoudreEcartFamille(cas10, 123456.78, 0);
console.log(`      recherche sur 600 pièces : ${Date.now() - t10} ms`);
check(
  "terminaison bornée avec échec honnête ou solution exacte",
  r10.echec || cents(r10.solutions[0]!.somme) === cents(123456.78),
);

console.log(`\n=== Résultat : ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
