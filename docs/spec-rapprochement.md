# Spécification du rapprochement explicable — Smart-Verif

Références de données : `BROUILLARD 2026 27102026.xlsx` (166 520 lignes,
Feuil1) et `Verif BG 27102026 VF.xlsx` (4 feuilles). Vérifiés le 28/10/2026.

## 1. Correspondance des colonnes (vérifiée sur les fichiers réels)

| Concept | Brouillard (Feuil1) | Verif BG |
|---|---|---|
| Société / journal | `Code journal` (44 journaux : TIERS, RAN, BNISAN, BOAHOL, MVOMCI…) | Feuille « 2026 » : 1 bloc par client, col. A |
| Date comptable | `Date` (datetime Excel) | — |
| N° de pièce | `N° pièce` (numérotation par journal) | — |
| N° de facture | `N° facture` | — |
| Compte général | `N° compte général` (6 chiffres, zéros initiaux conservés) | Blocs : lignes `46x…` / `512…` (col. B) |
| Compte tiers | `N° compte tiers` (ex. CLTSANLAM, 1073) | — |
| Libellé | `Libellé écriture` | — |
| Lettrage Sage | `Lettrage montant` (`*` = non lettré) | — |
| Débit / Crédit | `Débit`, `Crédit` (floats ; Σ D = Σ C = 81 052 581 650,82) | `DEBIT`, `CREDIT`, `SOLDE` |
| **Écarts de référence** | — | Lignes `Vérification` de la feuille « 2026 » : principale (col. B-E) = écart **entité** ; latérale (col. F-H) = contrôle **famille** |

Point d'attention (documenté) : la feuille « 2026 » est l'historique « Feuil2 »
du classeur (même position de blocs que les tirages 21/24/26/10). Les feuilles
littéralement nommées `Feuil1` / `Feuil2` du classeur 27/10 sont un **extrait
détail DHL EXPRESS 2025** ajouté par le comptable pour son investigation — ce
ne sont pas la référence des écarts. La feuille « 2026 » liste le compte
`512600` à la fois dans le bloc ORANGE MONEY MADAGASCAR (Vérification
62 098 371,47) et dans le contrôle famille EVIOSYS (Vérification −976 000) :
double comptage de la feuille, que l'application lève en attribuant 512600 à
un seul propriétaire (EVIOSYS, formule du comptable confirmée par les
écritures CAMUSAT décaissées de 512600).

Écarts de référence 27/10 : 16 blocs entités non soldés + 7 contrôles famille
(TELMA+EVASAN 1 726 184,00 ; PAMF −710 540,00 ; SANIFER/TALYS −4,00 ;
AITS 149 319,80 ; GES −8 977,56 ; JBU 7 399 937,20 ; EVIOSYS −976 000,00) ;
les contrôles FSS/MGS, LECOFRUIT, NACRE, MGS latéraux sont à 0,00 (soldés).

## 2. Règle A — 411 / 401 / 467 (transferts vers MCI CARE)

Périmètre : journaux bancaires des clients + MVOMCI/MVOHOL/MVOTEL, à
l'exception des journaux de MCI CARE (BOAMCI, BNITEM, MVOMCI côté maison).

- `attendu` = Σ des **411 crédits** encaissés sur les banques du client
  (honoraires MCI CARE collectés sur la banque du client).
- `rapproché` = Σ des **580001** sortis de la banque du client **et** arrivés
  sur une banque MCI CARE (paires 580001 C / 580001 D appariées au centime,
  consommation sans réutilisation), + paiements 401000+tiers imputés au client
  depuis MVOMCI/MVOHOL/MVOTEL rattachés à une pièce TIERS `467 D / 401 C` du
  client (clé tiers|montant, repli libellé).
- `restant` = attendu − rapproché (plancher 0) ; excédent = rapproché − attendu.
- Statuts : `transfert_absent` / `transfert_partiel` / `transfert_excedentaire`
  / `correspondance_trouvee`.
- Paiements MVOMCI/MVOHOL/MVOTEL 401000+tiers sans pièce TIERS 467
  correspondante → `anomalie_confirmee` (paiement non rapproché).
- Doublons : même (journal, tiers, montant, libellé normalisé) en ≥ 2 pièces
  non soldées par lettrage Sage → `doublon_potentiel` (ex. réel : HOTEL SERENA
  pièces 6988/7264, mission TULEAR 230 000,00 en double).

Un paiement peut couvrir plusieurs factures et plusieurs écritures peuvent
former un seul transfert : l'appariement est 1-1, 1-N, N-1 par montants —
une égalité de montant seule n'est jamais une preuve, le libellé et le lettrage
sont cités en justification.

## 3. Règle B — 460 / 462 (imputations inter-journaux)

Pour chaque pièce non RAN portant 460/462 dans un journal bancaire :

- suffixe du compte ∉ suffixes légitimes de la banque (`validAfByBank` :
  propriétaire + entités partageant la banque, incl. familles SHARED_BANK) →
  candidat `erreur_imputation_probable` ;
- justifications qui l'infirment : pièce soldée par lettrage Sage (groupes
  compte+tiers+code équilibrés), ou compte-à-compte 580001 correspondant
  trouvé pour le même suffixe dans une fenêtre de ±45 jours (fenêtre
  configurable `FENETRE_JOURS = 45` : les appels de fonds arrivent jusqu'à
  45 jours après l'encaissement — calibré sur les paires réelles du brouillard) ;
- sens : 460 au crédit = encaissement (normal) ; 460 au débit en journal
  bancaire = restitution — signalée avec le sens affiché, jamais interprétée
  seule comme une erreur ;
- `attendu` = montant de l'écriture ; `rapproché` = montant du 580001
  apparié ; `restant` = différence.

Une écriture dans le journal d'un autre client n'est PAS automatiquement une
erreur : sans contrepartie 580001 ni lettrage, le statut reste
`erreur_imputation_probable` (jamais `anomalie_confirmee`), à vérifier en
comptabilité.

## 4. Règle C — 627 (frais bancaires à la charge de MCI CARE)

Par journal bancaire client (hors journaux MCI CARE) :

- `attendu` = Σ (627 + 445600 au débit) des pièces de frais du journal
  (ex. réels 27/10 : BNISAN 16 620 591,56 d'agios ; BOAHOL 1 573 578,80 ;
  BOAJOV 467 964,86) ;
- `rapproché` = Σ des comptes-à-comptes 580001 reçus sur la banque du client
  **depuis une banque MCI CARE** (appariés aux envois, sans réutilisation) ;
- `restant` = attendu − rapproché ; statuts `transfert_absent` /
  `transfert_partiel` / `transfert_excedentaire` / `correspondance_trouvee` ;
- les frais sur les banques MCI CARE (BOAMCI, BNITEM, MVOMCI) ne génèrent
  aucun contrôle (déjà chez MCI CARE) ;
- les frais non transférés ne sont jamais classés `anomalie_confirmee` :
  ils sont `transfert_absent` (des pièces manquent peut-être hors période).

## 5. Normalisation (module `normalisation.ts`)

Fonctions pures testées : `normaliseCompte` (trim, retire `.0`, garde les
zéros initiaux), `normaliseJournal` (majuscules, trim), `normaliseReference`
(collapse d'espaces, majuscules), `normaliseLibelle` (majuscules, accents
retirés, collapse), `normaliseDate` (ISO AAAA-MM-JJ depuis Date/Excel/chaîne),
`montantCents` (entiers — aucune arithmétique flottante dans les comparaisons).
Les valeurs originales restent dans `EntryLine` pour l'affichage et l'audit ;
deux sociétés ne sont jamais fusionnées sous prétexte de même code tiers.

## 6. Classification (8 statuts, définitions opposables)

| Statut | Définition |
|---|---|
| `anomalie_confirmee` | Incohérence précise établie par les éléments comptables (paiement sans pièce TIERS, écart de pièce) |
| `transfert_absent` | Aucune contrepartie 580001 trouvée dans le périmètre vérifié |
| `transfert_partiel` | Une partie seulement du montant attendu est rapprochée |
| `transfert_excedentaire` | Le rapprochement dépasse l'attendu et l'appariement est établi |
| `erreur_imputation_probable` | Écriture dans le mauvais journal/compte, éléments justificatifs cités, sans preuve absolue |
| `doublon_potentiel` | Plusieurs écritures représentent vraisemblablement la même opération |
| `ecart_non_explique` | Les écritures disponibles n'expliquent pas le contrôle |
| `correspondance_trouvee` | Le contrôle est satisfait dans les limites des données |

Un transfert absent n'est JAMAIS une erreur comptable confirmée (pièces
possiblement hors période). Confiance qualitative (élevée / moyenne / faible)
toujours accompagnée de sa justification — jamais présentée comme une
probabilité calibrée.

## 7. Mode de validation (module `validation.ts`)

Chaque ligne `Vérification` de la feuille « 2026 » (principale + latérale)
est un écart de référence. L'app le rapproche de son objet (entité ou
famille), calcule `résiduel = référence − calculé` et classe :
expliqué exactement (résiduel = 0 au centime) / partiellement (même objet,
résiduel ≠ 0 — double comptage de la feuille documenté) / non expliqué
(objet introuvable) / correspondance incorrecte (signe opposé ou écart massif).
Le rapport compte les écarts par catégorie, les écritures sources utilisées
(pièces + combinaisons), les réutilisations conflictuelles (même pièce
dans les combinaisons de deux familles), les totaux et le détail non résolu.

## 8. Contraintes techniques respectées

Architecture TanStack Start conservée ; pas de réécriture ; calcul en
centimes entiers ; index par (journal, pièce, date) et par montant (aucun
quadratique) ; jamais d'écriture créée ni de donnée source modifiée ; pas de
données confidentielles dans les logs ; une écriture de lecture Excel ne
devient jamais une « absence d'écriture » (en-tête localisé, lignes vides
ignorées, dates invalides conservées vides et signalées).

## 9. Extension interexercices — brouillard N-1 (optionnel)

### 9.1 Principe

L'exercice contrôlé reste N : les soldes, familles, anomalies et écarts de
référence sont TOUJOURS calculés sur le seul brouillard N. Le brouillard N-1
(ex. « BROUILLARD 2025 31082025.xlsx », 176 089 écritures, Σ D = Σ C =
88 315 687 739,33 Ar) est une source complémentaire FACULTATIVE qui sert
exclusivement au moteur de rapprochement (règles A/B/C) et à la traçabilité.
Sans N-1, le moteur se comporte à l'identique de la version précédente
(non-régression garantie par construction : toutes les extensions sont
conditionnées à `piecesN1` non vide).

### 9.2 Import et distinction des exercices

`parseBrouillard(buffer, { exercice, fichier })` marque chaque écriture avec
l'exercice d'origine (déduit de la dernière date du brouillard) et le nom du
fichier source. La détection d'en-tête par contenu tolère les deux layouts
réels : 10 colonnes (N 2026) et 12 colonnes (N-1 2025 avec « Référence » en
col E, « Date échéance » et « Lettrage montant » décalés). Les clés de pièces
N-1 sont préfixées `N1|` : aucune confusion possible entre deux écritures de
pièces/montants identiques d'exercices différents.

### 9.3 Règles étendues

- **A_411 / C_627 — attendu supplémentaire N-1** : les encaissements
  d'honoraires (411) et les frais bancaires (627 + 445600) de N-1 NON apurés
  à la clôture N-1 (non couverts par des paires 580001 intra-N-1) s'ajoutent
  à l'attendu de la banque concernée. Résidu calculé en NET par banque
  (contrepassations et annulations N-1 réduisent l'attendu au lieu de
  l'augmenter) et plafonné : l'apurement intra-N-1 ne consomme que des paires
  dont la somme n'excède pas le résidu (jamais d'attendu négatif ni
  d'attendu fictif). Couverture du résidu : paires inter-exercices (envoi
  N-1 → réception N) plafonnées au résidu, puis paires intra-N restantes
  (opération de N soldant un compte ouvert en N-1), elles aussi plafonnées.
  La ventilation distingue interexercices et intra-N dans l'explication ;
  les montants couverts figurent dans `montantRapprocheN1`.
- **Fenêtre inter-exercices** : `FENETRE_N1_JOURS = 180` (couloir de fin
  d'exercice) — la fenêtre de ±45 jours ne s'applique qu'aux paires
  intra-N. Une contrepartie N-1 exige en plus la banque et le montant exacts
  au centime, la chronologie (envoi avant réception) et la non-réutilisation.
- **A_paiement / B_460_462 — justification N-1** : sans contrepartie intra-N,
  le moteur cherche l'écriture d'origine dans N-1 (facture 401000/411000 de
  mêmes tiers et montant ; imputation 460/462 similaire) pour documenter
  « opération de N qui solde un compte ouvert en N-1 ». Le statut ne change
  jamais sur la seule base de cette trace.
- **OUVERTURE (nouveau contrôle)** : les à-nouveaux du journal RAN de N
  portant sur des comptes de tiers (401/411/46x) sont tracés dans N-1 par
  correspondance exacte (compte + tiers + montant au centime), désambiguïsés
  par libellé. Fiches bornées aux 60 plus gros nets ; compteurs globaux
  (tracés / ambigus / non tracés) affichés en tête d'onglet. Un solde
  d'ouverture n'est jamais une anomalie en soi.
- **Doublons inter-exercices** : la même écriture (journal + compte + tiers +
  montant au centime + libellé normalisé) présente dans N ET N-1, non soldée
  par lettrage Sage dans les deux exercices, est signalée `doublon_potentiel`
  (reclassement d'exercice ou double saisie — à vérifier, jamais confirmé).

### 9.4 Validation sur données réelles (27/10 N + 31/08 N-1)

Sur le couple réel (brouillard N 166 520 lignes, brouillard N-1 176 089
lignes, Σ D = Σ C = 88 315 687 739,33 Ar équilibré) : la validation, les
familles, les anomalies et la balance sont STRICTEMENT identiques avec et
sans N-1 (invariants vérifiés par scripts/validate-n1.ts) ; 155 décisions de
fiches inchangées, 18 changées UNIQUEMENT via la ventilation N-1 documentée
(4 correspondances soldées deviennent honnêtement « transfert partiel » :
encaissements N-1 non apurés, ex. SANLAMALLIANZ AUTOFI +19 389 887,93 Ar,
HOLCIM +25 978 809,56 Ar), 16 fiches gagnent de la traçabilité sans changer
de décision ; 34 656 à-nouveaux d'ouverture tracés non ambigus (40 490
ambigus affichés comme tels, 382 non retracés) ; 24 doublons
interexercices réels signalés (300 à 3 300 Ar) ; 1 paire interexercices
réelle trouvée (EASY TECH, 10 846 805,94 Ar) ; 40 fiches citent une
écriture N-1 en source. Surcoût : ~12 s d'analyse pour 176 089 lignes.

### 9.5 Anti double comptage

Le registre 580001 porte l'exercice de chaque mouvement : une écriture N-1
apurée en N-1 (paire intra-N-1) ne peut plus couvrir un écart de N ; une
écriture ne couvre jamais deux contrôles ; les paires inter-exercices
respectent la chronologie (impossible d'apparier un envoi N avec une
réception N-1). Les écarts de référence (familles) restent calculés sur N
seul : N-1 ne modifie jamais un montant de validation, il ne fait que
documenter.

### 9.6 Validation — ventilation

Chaque écart de référence affiche : référence, expliqué par N (objet
calculé), expliqué par N-1 (0 tant que les familles restent N-only —
structure prête), total rapproché, résiduel, et une origine
(`N` / `N-1` / `N+N-1`). Le rapport distingue les trois catégories sans
jamais forcer un chiffre : sur les données réelles 27/10, les quatre
résiduels partiels (±3 000 TELMA SA/STAR, 182 000 TALOUMIS, 23 400
SANLAMALLIANZ AUTOFI) sont des divergences d'export brouillard/balance de N
et les deux incorrects (BOOST/JBU 7 586 124) des ajustements manuels de la
feuille — VÉRIFIÉ dans les données : aucun n'existe dans N-1.
