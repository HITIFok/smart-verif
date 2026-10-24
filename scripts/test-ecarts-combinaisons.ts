/**
 * Tests unitaires du détecteur de combinaisons exactes (src/lib/ecarts.ts).
 * Méthode du comptable : (1) lettrage par montants exactement opposés — les
 * écritures soldées se compensent et ne sont jamais candidates ; (2) plus
 * petite combinaison (1 à 4) parmi les écritures NON soldées dont la somme
 * redonne exactement l'écart — un écart peut être composé de PLUSIEURS
 * écritures erronées, pas toujours d'une seule (ex. 90 000 = 48 000 + 2 000
 * + 40 000). Au plus une solution retenue (les variantes sont alternatives).
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
check("une combinaison est trouvée", r1.solutions.length === 1 && !r1.echec);
check("au plus une solution retenue", r1.solutions.length <= 1);
check("combinaison de 3 écritures", s1?.pieces.length === 3, `taille=${s1?.pieces.length}`);
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
  r3.solutions[0]?.pieces.length === 2 && r3.solutions[0]?.pieces.every((p) => p.net === 1000),
  JSON.stringify(r3.solutions[0]?.pieces.map((p) => p.net)),
);
check("variantes dédupliquées (montants identiques)", r3.nbTotal === 1, `nbTotal=${r3.nbTotal}`);

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
  r4.solutions[0]?.pieces.length === 2 && cents(r4.solutions[0]?.somme ?? 0) === -5000000,
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
console.log(
  "\n7. Deux solutions de taille 1 : l'écriture suspecte (anomalie) est présentée en premier",
);
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
check(
  "lettrage cohérent (soldées + non soldées = total)",
  r10.nbSoldees + r10.nbNonSoldees === 600 && r10.nbSoldees % 2 === 0,
  `soldées=${r10.nbSoldees}, non soldées=${r10.nbNonSoldees}`,
);

// 11. LETTRAGE : les écritures d'exact montant opposé sont soldées et jamais
// candidates — le volet banque et le volet tiers d'une même opération se
// compensent, l'écart vient des écritures non soldées.
console.log("\n11. Lettrage : les paires opposées exactes sont soldées, jamais candidates");
const cas11 = [
  piece("TIERS", "110", 90000), // la vraie erreur, non soldée
  piece("BNI", "111", 12000),
  piece("TIERS", "112", -12000), // paire soldée (même opération)
  piece("BNI", "113", 30000),
  piece("TIERS", "114", -30000), // paire soldée
];
const r11 = resoudreEcartFamille(cas11, 90000, 0);
check(
  "la solution ne contient que des écritures non soldées",
  r11.solutions[0]?.pieces.every((p) => !p.lettree) ?? false,
);
check(
  "les paires opposées sont marquées soldées (lettrage)",
  cas11.filter((p) => p.lettree).length === 4 &&
    cas11.find((p) => p.piece === "110")?.lettree === false,
);
check(
  "compteurs lettrage : 4 soldées, 1 non soldée",
  r11.nbSoldees === 4 && r11.nbNonSoldees === 1,
  `soldées=${r11.nbSoldees}, non soldées=${r11.nbNonSoldees}`,
);
check(
  "la vraie erreur 90 000 reste détectée (taille 1)",
  r11.solutions[0]?.pieces[0]?.piece === "110",
);

// 12. Le lettrage supprime les FAUSSES PISTES : des écritures soldées qui se
// combinent au centime près avec l'écart (cas BOOST réel : -3 432 080 +
// 1 808 880 + 778 488 + 658 525,20 = -186 186,80) ne sont plus candidates.
console.log("\n12. Anti-fausse piste : une combinaison exacte d'écritures soldées est rejetée");
const cas12 = [
  piece("BNI", "121", -3432080), // ┐
  piece("BNI", "122", 3432080), // │ paires soldées (opér. complètes) —
  piece("BNI", "123", -1808880), // │ leur combinaison -3 432 080 + 1 808 880
  piece("BNI", "124", 1808880), // │ + 778 488 + 658 525,20 = -186 186,80
  piece("BNI", "125", 778488), // │ est exacte mais ABSURDE (cas BOOST réel)
  piece("BNI", "126", -778488), // │
  piece("BNI", "127", 658525.2), // │
  piece("BNI", "128", -658525.2), // ┘
  piece("TIERS", "129", 100000), // non soldées — ne forment pas l'écart
  piece("TIERS", "130", 86186.8), // (écart cible négatif)
];
const r12 = resoudreEcartFamille(cas12, -186186.8, 0);
check(
  "aucune fausse piste : échec honnête (pas de combinaison avec les soldées)",
  r12.echec && r12.solutions.length === 0 && r12.nbTotal === 0,
  `solutions=${r12.solutions.length}, variantes=${r12.nbTotal}, echec=${r12.echec}`,
);
check(
  "les 8 écritures soldées sont lettrées, les 2 autres non",
  r12.nbSoldees === 8 && r12.nbNonSoldees === 2,
  `soldées=${r12.nbSoldees}, non soldées=${r12.nbNonSoldees}`,
);
check(
  "aucune écriture marquée erronée à tort",
  cas12.every((p) => !p.dansCombinaison),
);

// 13. VARIANTES : plusieurs décompositions exactes distinctes sont collectées
// (la plus plausible d'abord) sans jamais marquer leurs pièces erronées —
// l'export les liste pour le rapprochement Sage (cas EVIOSYS réel : 5
// décompositions de 3 écritures tombent juste, toutes correctes dans Sage).
console.log("\n13. Attribution ambiguë : toutes les décompositions sont collectées");
const cas13 = [
  piece("BNI", "1301", -6000),
  piece("BNI", "1302", -4000),
  piece("BNI", "1303", -3000),
  piece("BNI", "1304", -7000),
  piece("BNI", "1305", -1000),
  piece("BNI", "1306", -9000),
  piece("BNI", "1307", 5000),
  piece("TIERS", "1308", -5000), // paire soldée avec 1307
];
const r13 = resoudreEcartFamille(cas13, -10000, 0);
check(
  "3 décompositions de taille 2 tombent juste (nbTotal = 3)",
  r13.nbTotal === 3,
  `nbTotal=${r13.nbTotal}`,
);
check(
  "les variantes sont collectées, la retenue d'abord",
  r13.variantes.length === 3 &&
    r13.variantes[0] === r13.solutions[0] &&
    r13.variantes[0] !== undefined &&
    r13.variantes[0]!.pieces === r13.solutions[0]!.pieces,
  `variantes=${r13.variantes.length}`,
);
check(
  "chaque variante redonne exactement l'écart",
  r13.variantes.every((v) => cents(v.somme) === -1000000 && cents(v.cible) === -1000000),
  JSON.stringify(r13.variantes.map((v) => v.somme)),
);
check(
  "seule la décomposition PRÉSENTÉE marque ses pièces erronées",
  r13.variantes.slice(1).every((v) => v.pieces.every((p) => !p.dansCombinaison)) &&
    r13.solutions[0]!.pieces.every((p) => p.dansCombinaison),
);
check(
  "les pièces des variantes ne se recouvrent pas toutes (décompositions distinctes)",
  new Set(r13.variantes.map((v) => v.pieces.map((p) => p.piece).join("+"))).size === 3,
  JSON.stringify(r13.variantes.map((v) => v.pieces.map((p) => p.piece).join("+"))),
);

// 14. LETTRAGE SAGE : une pièce régularisée dans Sage (lettreeSage, preuve
// groupes équilibrés) n'est JAMAIS candidate — même si son net tombe juste
// sur l'écart (cas EVIOSYS réel : les règlements BOAOMM soldés par lettrage
// 401000 étaient accusés parce que leur somme redonnait l'écart feuille).
console.log("\n14. Lettrage Sage : la pièce régularisée n'est jamais candidate");
const cas14 = [
  piece("BOAOMM", "1401", -4606000), // règlement soldé dans Sage
  piece("TIERS", "1402", 48000),
  piece("TIERS", "1403", 2000),
  piece("TIERS", "1404", 40000),
];
for (const p of cas14) p.lettreeSage = p.piece === "1401";
const r14 = resoudreEcartFamille(cas14, -4606000, 0);
check(
  "sans elle aucune combinaison ne tombe juste : échec honnête",
  r14.echec && r14.solutions.length === 0,
  `echec=${r14.echec}, nbTotal=${r14.nbTotal}`,
);
check(
  "la pièce soldée Sage n'est ni compensée ni marquée erronée",
  !cas14[0]!.lettree && !cas14[0]!.dansCombinaison,
);
// Même cas mais avec cible atteignable sans la pièce Sage : l'écart vaut
// 90 000 côté écritures (feuille en désaccord ici pour isoler la règle).
const cas14b = [
  piece("BOAOMM", "1411", -90000), // soldée Sage
  piece("TIERS", "1412", 48000),
  piece("TIERS", "1413", 2000),
  piece("TIERS", "1414", 40000),
  piece("TIERS", "1415", -250000),
];
for (const p of cas14b) p.lettreeSage = p.piece === "1411";
const r14b = resoudreEcartFamille(cas14b, -186186.8, 0);
check(
  "sans combinaison possible hors pièce Sage : échec honnête",
  r14b.echec && r14b.solutions.length === 0,
  `echec=${r14b.echec}`,
);
check(
  "compteurs : 1 soldée Sage, 0 compensée, 4 non soldées",
  r14b.nbLettreesSage === 1 && r14b.nbSoldees === 1 && r14b.nbNonSoldees === 4,
  `sage=${r14b.nbLettreesSage}, soldées=${r14b.nbSoldees}, non soldées=${r14b.nbNonSoldees}`,
);
check(
  "la pièce Sage n'est ni lettree (compensation) ni dansCombinaison",
  !cas14b[0]!.lettree && !cas14b[0]!.dansCombinaison,
);
// Cas mixte : pièce Sage + pièces non soldées tombant juste → la
// combinaison ne contient que les non soldées.
const cas14c = [
  piece("BOAOMM", "1421", -186186.8), // soldée Sage
  piece("TIERS", "1422", -90000),
  piece("TIERS", "1423", -96186.8),
];
for (const p of cas14c) p.lettreeSage = p.piece === "1421";
const r14c = resoudreEcartFamille(cas14c, -186186.8, 0);
check(
  "la combinaison exacte utilise les non soldées, pas la pièce Sage",
  !r14c.echec &&
    r14c.solutions[0]!.pieces.length === 2 &&
    r14c.solutions[0]!.pieces.every((p) => !p.lettreeSage),
  r14c.solutions[0]?.pieces.map((p) => p.piece).join(", ") ?? "échec",
);

// 15. VRAISEMBLANCE : une combinaison exacte d'écritures d'un autre ordre de
// grandeur que l'écart est un pur hasard arithmétique — pas une explication
// comptable (cas SANIFER réel 24/10 : -473 462 + 407 920 + 307 038
// - 241 500 = -4,00, écart qui vient en réalité des RAN non considérés).
// L'app refuse de désigner ces écritures légitimes : échec honnête.
console.log("\n15. Vraisemblance : la combinaison hasardeuse de masse 1,43 M sur un écart de 4,00 est rejetée");
const cas15 = [
  piece("BOAGTA", "1501", -473462),
  piece("TIERS", "1502", 407920),
  piece("TIERS", "1503", 307038),
  piece("BOAGTA", "1504", -241500),
];
const r15 = resoudreEcartFamille(cas15, -4, 0);
check(
  "échec honnête : aucune désignation (masse 1 429 920 > 100 × 4,00)",
  r15.echec && r15.solutions.length === 0 && r15.nbTotal === 0,
  `echec=${r15.echec}, solutions=${r15.solutions.length}, nbTotal=${r15.nbTotal}`,
);
check("aucune pièce marquée erronée à tort", cas15.every((p) => !p.dansCombinaison));
// Contrôle positif : la VRAIE pièce de -4,00 est détectée seule malgré les
// grosses pièces du vivier (taille 1 prioritaire, masse 4 ≤ plafond).
const cas15b = [...cas15, piece("OD", "1506", -4)];
const r15b = resoudreEcartFamille(cas15b, -4, 0);
check(
  "la vraie petite pièce -4,00 reste détectée (taille 1)",
  !r15b.echec && r15b.solutions[0]?.pieces.length === 1 && r15b.solutions[0]?.pieces[0]?.piece === "1506",
  JSON.stringify(r15b.solutions[0]?.pieces.map((p) => p.piece)),
);
// Contrôle AITS : les tout petits écarts restent détectables malgré le
// plancher (0,32 + 0,08 = 0,40, masse 0,40 ≤ plancher 10,00).
const cas15c = [piece("OD", "1507", 0.32), piece("OD", "1508", 0.08)];
const r15c = resoudreEcartFamille(cas15c, 0.4, 0);
check(
  "AITS 0,40 = 0,32 + 0,08 toujours détecté (plancher 10,00)",
  !r15c.echec && cents(r15c.solutions[0]?.somme ?? 0) === 40,
);

console.log(`\n=== Résultat : ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
