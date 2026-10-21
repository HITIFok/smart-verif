# Verif BG Helper

Application web qui analyse le brouillard comptable et détecte les écritures incorrectes pour que les vérifications dans `Verif BG 21102026.xlsx` soient toutes soldées.

Les écritures se trouvent dans `BROUILLARD 2026 20102026.xlsx`.

## Ce que fait l'application

Déposez le brouillard et la feuille de vérification (le même classeur Verif BG contient aussi la balance des comptes) :

1. **Tableau de bord par client** : appel de fonds (460/461/462/467) vs trésorerie (512/513) par bloc client, avec écart. Les blocs multi-suffixes (ex. SANLAMALLIANZ COMPAGNIE = 103 + 100 + 501) et les banques partagées (ex. 512600 pour Orange Money / EVIOSYS / INGEDATA / CAMUSAT) sont gérés : la banque compte dans l'écart de son propriétaire uniquement, les entités partageantes l'affichent avec le badge « partagé ».
2. **Écritures à corriger**, par type :
   - *Mauvais client* : mouvement de trésorerie soldé sur les comptes d'un autre client ;
   - *Hors périmètre* : contrepartie hors 460/461/462/467, ou écart trésorerie/appel de fonds sur la pièce ;
   - *Compte oublié* : compte à solde non nul absent de la feuille de vérification (y compris comptes hors blocs, ex. 467101) ;
   - *Écart brouillard / balance* : compte dont le solde du brouillard diffère de la balance des comptes → écriture manquante dans le brouillard ou passée après son export.
3. **Comptes à comptes 580001** : propositions d'écritures de virement quand les fonds sont passés par une autre banque que celle du client (avec détection des virements déjà passés).

Les journaux `RAN` (à-nouveaux) et les pièces `580001` sont exclus de la détection : ils ne sont pas actionnables.

## Développement

```sh
npm i
npm run dev
```

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
