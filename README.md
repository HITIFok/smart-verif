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
4. **Comptes à comptes 580001** : propositions d'écritures de virement quand les fonds sont passés par une autre banque que celle du client (avec détection des virements déjà passés).

Les journaux `RAN` (à-nouveaux) et les pièces `580001` sont exclus de la détection : ils ne sont pas actionnables.

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
