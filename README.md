# Verif BG Helper

Application web qui analyse le brouillard comptable et détecte les écritures incorrectes pour que les vérifications dans `Verif BG 21102026.xlsx` soient toutes soldées.

Les écritures se trouvent dans `BROUILLARD 2026 20102026.xlsx`.

## Ce que fait l'application

Déposez le brouillard et la feuille de vérification (le même classeur Verif BG contient aussi la balance des comptes) :

1. **Tableau de bord par client** : appel de fonds (460/461/462/467) vs trésorerie (512/513) par bloc client, avec écart. Les blocs multi-suffixes (ex. SANLAMALLIANZ COMPAGNIE = 103 + 100 + 501) et les banques partagées (ex. 512600 pour Orange Money / EVIOSYS / INGEDATA / CAMUSAT) sont gérés : la banque compte dans l'écart de son propriétaire uniquement, les entités partageantes l'affichent avec le badge « partagé ».
2. **Vérification par famille de clients** : comme dans les notes de la feuille « 2026 » du Verif BG, les clients sans banque propre sont soldés avec la banque de leur famille (MGS avec le 512124 de FSS, CAMUSAT/INGEDATA avec le 512600 d'EVIOSYS, JBU/JBS avec le 512320 de BOOST, etc.). Le contrôle est concluant au niveau de la famille, pas forcément de chaque client isolé : 15 familles sont recalculées depuis le brouillard et reproduisent exactement les formules du comptable (FSS+MGS = 0, NACRE+DIR+RAHARIVOLA+KIDS = 0, SANIFER+HOSP+COVID+TAMBOHO+STMB = 2 006,00, EVIOSYS+INGEDATA+CAMUSAT = -4 606 000,00, BOOST+JBU+JBS = -186 186,80…).
3. **Écritures à corriger**, par type :
   - *Mauvais client* : mouvement de trésorerie soldé sur les comptes d'un autre client ;
   - *Hors périmètre* : contrepartie hors 460/461/462/467, ou écart trésorerie/appel de fonds sur la pièce ;
   - *Compte oublié* : compte à solde non nul absent de la feuille de vérification (y compris comptes hors blocs, ex. 467101) ;
   - *Écart brouillard / balance* : compte dont le solde du brouillard diffère de la balance des comptes → écriture manquante dans le brouillard ou passée après son export.

   L'onglet commence par les **écarts de famille réels** (familles non soldées) : ce sont eux qu'il faut corriger dans Sage. Pour chaque famille, l'application liste les pièces du brouillard qui composent l'écart — mouvement net de chaque pièce sur le périmètre famille (appel de fonds + trésorerie des membres), trié du plus gros contributeur au plus petit, avec son rôle (à-nouveaux RAN, compte-à-compte 580001, appel de fonds, paiement, arrivée de fonds, annulation, hors schéma), le badge « anomalie » si le contrôle pièce à pièce la signale déjà, et le badge « aussi » quand la même pièce fait l'écart d'une autre famille (mauvais client entre familles). La feuille Excel « Pièces écarts familles » reprend le détail complet.

   **Règle RAN (à-nouveaux)** — dans les pièces du journal RAN, seuls les mouvements portant sur un compte de tiers réel — **401000, 460, 411** — sont considérés comme des écritures à corriger. Les RAN sur les comptes d'attente **462/467** (reclassements d'ouverture), sur les banques **512/513** (soldes d'ouverture) ou sur des comptes divers ne sont plus considérés : leur total par famille est affiché à part (« RAN non considérés ») et le rapprochement reste vérifié : Σ pièces à corriger + RAN non considérés = écart feuille. Les à-nouveaux de tiers portant sur 401000/460/411 sans faire l'écart d'une famille non soldée sont regroupés dans la section « À-nouveaux de tiers à considérer » (feuille Excel « RAN tiers 401000-460-411 »).

   **Détection exacte des écritures erronées (lettrage + combinaison d'écarts)** — la méthode du comptable, en trois temps. **1. Lettrage Sage** : une pièce dont toutes les lignes lettrées appartiennent à des groupes de lettrage équilibrés dans Sage (compte + tiers + code, colonne « Lettrage montant » du brouillard) et dont les lignes sans code sont bancaires (512/513) est régularisée dans Sage — elle n'est jamais candidate, même si son volet bancaire participe arithmétiquement à l'écart (cas réel EVIOSYS : les règlements CAMUSAT BOAOMM 10397/8131/7130, lettrés X/Z/AA… avec les pièces TIERS de facturation, étaient accusés parce que leur somme redonnait exactement l'écart feuille de -4 606 000 ; ils portent désormais le badge « soldée Sage » et l'écart est déclaré résidu structurel). **2. Compensation** : les écritures restantes d'exact montant opposé se compensent 2 à 2 (le volet banque et le volet tiers d'une même opération, un compte-à-compte entrant/sortant) — elles sont marquées « soldées » et ne peuvent pas, à elles seules, expliquer l'écart ; la recherche ne les considère jamais (c'est ce lettrage qui élimine les fausses pistes du type « -3 432 080 + 1 808 880 + 778 488 + 658 525,20 = écart », mathématiquement exact mais comptablement absurde, anciennement affiché sur la famille BOOST). **2. Combinaison exacte** : parmi les écritures **non soldées** seulement, l'application recherche la plus petite combinaison (1 à 4 écritures) dont la somme des mouvements nets redonne **exactement** l'écart de la feuille 2 du Verif BG, au centime. Point clé : un écart peut être composé de **plusieurs écritures erronées** et pas toujours d'une seule — ex. écart 90 000 = 48 000 + 2 000 + 40 000, comme il peut venir d'une seule écriture (cas réel TOM : l'écart de 90 000,00 correspond exactement à la pièce TIERS 3609 « FONDATION AXIAN — CENTRE MEDICAL COLISEUM » ; cas réel AITS : l'écart de 0,40 correspond à deux écritures 0,32 + 0,08). **Vraisemblance** : une combinaison n'est retenue que si ses écritures sont d'un ordre de grandeur compatible avec l'écart — la somme de leurs |montants| (masse) ne peut pas dépasser 100 fois l'écart cherché (plancher 10,00 Ar pour les tout petits écarts) ; sinon l'égalité au centime est un pur hasard arithmétique sur des écritures par ailleurs légitimes (cas réel SANIFER 24/10 : -473 462 + 407 920 + 307 038 - 241 500 = -4,00 alors que l'écart vient entièrement des RAN non considérés — l'app refuse de désigner et déclare l'échec honnête). Au plus **une** combinaison est retenue (la plus plausible : écritures suspectes d'abord, masse la plus faible) et seules ses écritures portent le badge « erronée » — les variantes équivalentes existantes sont comptées et signalées comme alternatives. **Règle d'ambiguïté** : si plusieurs décompositions différentes sont exactes (ex. EVIOSYS : 5 combinaisons de 3 écritures somment à l'écart de -4 606 000), l'attribution est déclarée **ambiguë** — les pièces citées passent au badge « candidate » (orange, au lieu de « erronée » rouge) car aucune ne peut être désignée avec certitude ; un comptable ne désigne pas de coupables quand plusieurs explications tombent juste. Les stats séparent alors « écritures erronées » (décomposition unique, attribution certaine) des « candidates » (attribution ambiguë, à rapprocher dans Sage avec leurs contreparties). Si aucune combinaison de 1 à 4 écritures non soldées n'explique l'écart (ni l'écart hors RAN non considérés), l'écart est présenté honnêtement comme le **résidu des écritures non soldées** (ex. BOOST : 272 non soldées après lettrage Sage de 276 écritures et compensation de 4, Σ vivier + soldées Sage = écart au centime), à corriger ensemble — plutôt que de proposer une piste fausse. Les listes affichent les non soldées d'abord (par contribution décroissante) ; les soldées, masquables d'un clic, portent le badge « soldée Sage » (lettrage équilibré) ou « compensée » (montant opposé) et les mentions « Soldée (lettrage Sage) » / « Compensée (montant opposé) » dans la feuille Excel « Pièces écarts familles ». **Toutes les décompositions sont exportées** : la feuille Excel « Variantes d'attribution » liste chaque décomposition exacte candidate (la présentée d'abord, marquée « Oui »), et la colonne « Variantes (n°) » de « Pièces écarts familles » recroise chaque pièce avec les décompositions qui la contiennent — le comptable rapproche chaque candidate dans Sage et reconnaît celle qui correspond à une vraie anomalie (ou conclut au résidu). L'export applique enfin des formats monétaires (deux décimales, séparateurs de milliers) et des largeurs de colonnes lisibles sur toutes les feuilles.
4. **Comptes à comptes 580001** : propositions d'écritures de virement quand les fonds sont passés par une autre banque que celle du client (avec détection des virements déjà passés).

Les pièces `580001` sont exclues de la détection d'anomalies : elles ne sont pas actionnables. Dans le journal `RAN`, seuls les mouvements sur 401000/460/411 sont considérés (règle ci-dessus) ; les RAN 462/467 et 512/513 ne produisent pas d'anomalies non plus.

## Schéma des écritures du cycle appel de fonds

L'application retrace le cycle complet dans l'onglet « Schéma des écritures » (également exporté dans l'Excel) :

| Étape | Journal | Débit | Crédit |
|---|---|---|---|
| 1. Appel de fonds | TIERS | 460 (client) | 467 (client) |
| 2. Paiement prestataire / client | TIERS | 467 (client) | 401000 + compte tiers |
| 3. Paiement prestataire / client | BANQUE | 401000 + compte tiers | 512 |
| 4. Arrivée des fonds | BANQUE | 512 | 460 (client) |

Le compte 401000 + compte tiers matérialise le paiement des prestataires ou clients : les écritures conformes à ce schéma (étapes 2 et 3) ne sont plus signalées comme anomalies. L'arrivée des fonds en banque (512 Débit / 460 Crédit) solde le cycle.

### Annulation de paiement (hors cycle)

Les écritures **401000 + compte tiers au Crédit / 512xxx au Débit** sont des **annulations de paiement** : la banque rend les fonds et le prestataire ou client est recrédité. Elles sont reconnues comme normales (rôle `annulation_paiement`) et ne sont jamais signalées comme anomalies ; le schéma complet figure dans l'onglet « Schéma des écritures » et dans l'export Excel.

### Frais bancaires à la charge de MCI CARE (627)

Le compte **627** (Services bancaires et assimilés) porte les **frais bancaires à la charge de MCI CARE** : la banque prélève le frais — avec sa TVA **445600** — directement sur un compte 512/513 (ex. `BOAHOL 627000 Débit + 445600 Débit / 512110 Crédit`). Ces écritures (et leur régulation inverse `512 Débit / 627 Crédit`) sont reconnues comme normales (rôle `frais_bancaires`) et ne sont jamais signalées comme anomalies.

- **Frais débités sur la banque d'un client** (BOAHOL 512110 — HOLCIM, BOAJOV 512150 — JOVENA, BNISAN 512100 — SANLAMALLIANZ…) : le client a payé à la place de MCI CARE, l'application propose le **compte-à-compte de remboursement** depuis la banque principale de MCI CARE, du montant total débité à la banque (frais + TVA) :
  > `BOAMCI 580001 Débit / 512000 Crédit` puis `BOAHOL 512110 Débit / 580001 Crédit`
- **Frais débités sur une banque de MCI CARE** (BOAMCI 512000, BNITEM 512005, MVOMCI 513000 — Mobile Money) : rien à faire, le frais est déjà chez MCI CARE.
- **Paiements de prestataires passés par MVOMCI** (401000 + compte tiers RMBT Débit / 513000 Crédit) : MCI CARE a payé avec son propre Mobile Money — c'est la **banque du client** (repérée via le compte tiers, ex. RMBT HOLCIM → 512110 de HOLCIM) qui doit faire le compte-à-compte vers la banque de MCI CARE, du montant du paiement. Déjà couvert par la détection « Paiement réglé par 513000 (MVOMCI) au lieu du compte client 512110 » de l'onglet « Comptes à comptes ».

### Honoraires et revenus MCI CARE (411, 606200)

Les comptes **411** (honoraires) et **606200** (revenus) sont des revenus de MCI CARE. S'ils ne sont pas encaissés directement dans une banque de MCI CARE (BOAMCI 512000, BNITEM 512005), l'application propose le compte à compte 580001 :

> BOATSA `411140 Crédit / 512140 Débit` ⇒ BOATSA `580001 Débit / 512140 Crédit` puis BOAMCI `580001 Crédit / 512000 Débit` (ou BNITEM `580001 Crédit / 512005 Débit`).

Deux intelligences « comme un comptable » complètent cette règle :

- **Regroupement des honoraires** : ils ne partent pas un à un — plusieurs écritures 411/606200 d'une même banque peuvent être payées en un seul compte-à-compte (ex. deux `411140` de 1 000 dans BOATSA ⇒ un CàC de 2 000). L'application regroupe par banque d'encaissement, compare aux comptes-à-comptes 580001 déjà passés vers les banques MCI et ne propose que le solde non couvert, en une seule écriture.
- **Détection « sans erreur » au niveau société** : un compte-à-compte déjà passé depuis n'importe quelle banque d'une société couvre les fonds arrivés sur une autre banque de la même société. Ex. : fonds reçus sur MVOMCI 513000 (MCI CARE) via le tier 460210/FONAITS alors qu'un CàC BNITEM 512005 → BNIAIT 512210 du même montant existe déjà ⇒ statut **« Déjà passée »** citant l'écriture couvrante, aucun doublon demandé.

### Banques des sociétés (journaux de trésorerie)

Chaque société encaisse et décaisse sur ses propres comptes 512/513 : le compte de banque des étapes 3 et 4 est celui de la société concernée. La cartographie (`src/lib/banques-societes.ts`) est affichée dans l'onglet « Schéma des écritures » et exportée dans la feuille « Banques des sociétés » :

| Journal Sage | Compte | Intitulé plan | Type | Société | Suffixe(s) client |
|---|---|---|---|---|---|
| BOAMCI | 512000 | BOA MCI | Banque (BOA) | MCI CARE | — |
| BNITEM | 512005 | BNI MCI TEMPORAIRE | Banque (BNI) | MCI CARE | — |
| MVOMCI | 513000 | M-VOLA, MCI | Mobile Money MVOLA | MCI CARE | — |
| MVOTEL | 513140 | M-VOLA, TELMA | Mobile Money MVOLA | TELMA | 140 |
| MVOHOL | 513110 | M-VOLA, SANLAM/ALLIANZ | Mobile Money MVOLA | SANLAMALLIANZ COMPAGNIE | 103 |

BOAMCI 512000 est la banque principale de MCI CARE ; BNITEM 512005 sert aussi à MCI CARE, en complément du Mobile Money MVOMCI 513000. MVOHOL 513110 est la banque MVOLA de SANLAMALLIANZ COMPAGNIE sur fixe 103. Cette cartographie est utilisée par la détection des comptes à comptes : un encaissement passé sur le MVOLA de la société (513) est reconnu comme sa banque propre et ne déclenche pas de 580001 à tort, tandis que les honoraires et revenus MCI CARE (411, 606200) encaissés sur la banque d'un client partent vers BOAMCI 512000 ou BNITEM 512005. Le matching des comptes-à-comptes existants raisonne au niveau société (les banques 512000/512005/513000 sont interchangeables entre elles pour couvrir une même écriture).

## Référentiel : plan comptable & plan tiers Sage

Le plan comptable (434 comptes) et le plan tiers (836 tiers) de **MCI CARE MADAGASCAR** (Sage 100cloud Comptabilité, tirage du 21/10/26) sont intégrés à l'application :

- **Onglet « Référentiel comptable »** : consultation et recherche dans les deux plans, avec filtres par famille comptable (Capitaux, Immobilisations, Fournisseurs, Clients — fonds à encaisser, transit 467, Trésorerie, Charges, Produits…) ou par type de tiers (Fournisseur / Client / Autre / Salarié).
- **Libellés automatiques** partout : chaque numéro de compte affiché dans le tableau de bord, les anomalies, les comptes à comptes et le diagnostic hors périmètre est accompagné de son intitulé exact (ex. `460140 — TELMA SA à encaisser`, `512140 — BOA TELMA`). Les comptes collectifs `401`/`411` + code tiers sont résolus via le plan tiers (ex. `4011013 — CENHOSOA`).
- **Export Excel** : deux feuilles supplémentaires « Plan comptable » et « Plan tiers », et une colonne « Libellés comptes (plan) » dans les écritures à corriger.

Les données sont générées depuis les PDF Sage (`Plan_comptable.pdf`, `Plan_tiers.pdf`) via `scripts/parse_plans.py` → `src/lib/plan-comptable-data.ts` et `src/lib/plan-tiers-data.ts`.

## Développement

```sh
npm i
npm run dev
```

## Déploiement GitHub Pages

L'application est publiée en statique (mode SPA) sur https://hitifok.github.io/smart-verif/ :

```sh
GH_PAGES=1 npm run build   # coquille SPA + base /smart-verif/ dans .output/public
```

Le contenu de `.output/public` (avec `_shell.html` renommé en `index.html` et un fichier `.nojekyll`) est publié sur la branche `gh-pages`. Sans `GH_PAGES=1`, le build reste le build serveur standard (Cloudflare/Lovable).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bfd6579f-e34a-48c3-a4db-3ca831f52553).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
