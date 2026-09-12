# Jardin Paradoxal — solveur du combat final de « En ce jardin qui nous unit »

Outil web (sans build, sans dépendance) qui résout le combat-puzzle contre le
Reflet d'Imagirorukam : on lui donne une capture d'écran de la position de
départ, il rend la séquence de sorts à reproduire en jeu.

## Fichiers

| fichier | rôle |
|---|---|
| `index.html` | l'application (version locale, charge les 3 scripts) |
| `solver.js` | modèle du combat + recherche (beam search) |
| `detect.js` | lecture de la capture d'écran (grille, souffles, couleurs, personnage) |
| `app.js` | interface : plateau canvas, édition, plan pas à pas |
| `jardin-paradoxal.html` | build mono-fichier (tout inliné) publié en Artifact |

Ouvrir `index.html` dans un navigateur suffit. Pour reconstruire le mono-fichier,
voir la fin de la session ou réinliner les trois `<script src>`.

## Règles modélisées

Source : [Dofus pour les Noobs](https://www.dofuspourlesnoobs.com/en-ce-jardin-qui-nous-unit.html).

- Personnage : 50 PV, 10 PA, 1 PM, −1 PV à chaque début de tour.
- **Vibration Paradoxale** — 1 PA, −1 PV, 10/tour, en ligne uniquement, portée
  infinie, ligne de vue requise. Cible noire → poussée d'1 case ; cible blanche
  → attirée d'1 case. La cible change de couleur **et tous les souffles en ligne
  de la case d'arrivée aussi**.
- **Réciprocité** — 2 PA, −3 PV, 1/tour, relance 2 tours, portée 2–5 sans ligne
  de vue. Échange de place ; la case d'arrivée est l'ancienne case du joueur.
- Objectif : tous les souffles de la même couleur.

Hypothèse retenue : la propagation « en ligne » traverse toute la carte et n'est
pas arrêtée par les autres souffles (lecture littérale de l'énoncé du sort).

## Repère de coordonnées

`(u, v)` sont les deux axes « en ligne » de la grille Dofus (les quatre
directions des sorts en ligne). Passage à l'écran :

```
x = OX + (u - v) * HW
y = OY + (u + v) * HH        avec HH = HW / 2
```

## Carte de l'arène

Déduite de la capture fournie (analyse du sol, des joints de dalles et du
liseré du plateau) :

- cases : `u ∈ [-4, 12]`, `v ∈ [-4, 13]`, `u-v ∈ [-14, 13]`, `u+v ∈ [-8, 22]`
  (un rectangle aux quatre coins coupés, 288 cases, 278 praticables) ;
- trous (infranchissables, la ligne de vue passe) : `4,2  5,2  6,2  12,4` ;
- rochers (infranchissables, bloquent la ligne de vue) : `2,6  3,6  9,7  10,7  4,11  4,12`.

Ces deux listes sont éditables dans l'interface (outils « Trou » et « Rocher »)
si la carte réelle diffère.

## Détection depuis une capture

1. Masque orange → composantes connexes = hexagones de placement des souffles.
2. Ajustement du pas de grille (`hw`, `hh = hw/2`) puis de l'origine, par
   minimisation des résidus entiers ; balayage complet ensuite pour récupérer
   les hexagones partiellement masqués par les sprites.
3. Couleur : la tête du dragon est à ≈ 1,3 × `hw` au-dessus du centre de case ;
   tête très sombre = Wukin, sinon Wukang.
4. Personnage : case partiellement verte (zone de placement) portant le liseré
   blanc de sélection.
5. Recalage sur l'arène : l'étendue du sol beige donne le centre absolu, les
   souffles doivent tous tomber sur des cases praticables.

Sur la capture de référence : 18 souffles, 8 Wukin / 10 Wukang, personnage en
`(5,5)`, en ~100 ms — conforme au relevé manuel.

## Solveur

Beam search sur les séquences d'actions, avec relances aléatoires dans un
budget de temps (~2,5 s). Score : nombre de souffles de la mauvaise couleur,
puis nombre de sorts. Les deux couleurs cibles sont essayées, la meilleure est
retenue. Sur la position de référence : **11 sorts, 2 tours, 14 PV**.
