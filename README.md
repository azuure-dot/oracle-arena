# Web Hero Shooter

Prototype de hero shooter 2D en vue de dessus, jouable dans le navigateur.
Vite + TypeScript + Canvas 2D, sans backend pour l'instant.

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

| Commande            | Rôle                                          |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Serveur de développement (rechargement auto)  |
| `npm run build`     | Vérification TypeScript + build dans `dist/`  |
| `npm run preview`   | Sert le build de production                   |
| `npm run typecheck` | Vérification TypeScript seule                 |

## Contenu actuel : champ de tir

- **3 héros** : Rempart (tank), Flux (dégâts), Tempo (soutien), choisis sur un écran de sélection.
- **Ligne de vue** : les murs bloquent la vision (raycasting + brouillard de guerre).
- **Zone de vision 16:9** identique pour tous les écrans ; caméra verrouillée sur le joueur.
- **Bots** : cibles, patrouilles, tourelles qui tirent quand elles voient le joueur, alliés blessés.
- **Interface bilingue** FR / EN.

## Commandes

| Touche            | Action                              |
| ----------------- | ----------------------------------- |
| ZQSD / WASD       | Se déplacer                         |
| Souris            | Viser                               |
| Clic gauche       | Arme principale                     |
| Clic droit        | Compétence 1                        |
| Espace / Maj      | Compétences 2 et 3                  |
| R                 | Recharger                           |
| B                 | Activer / couper les tourelles      |
| T / H             | Remettre les stats à zéro / aide    |
| Échap             | Retour à la sélection de héros      |

## Structure

```
src/
  Game.ts          boucle de jeu, rendu, collisions des projectiles
  config.ts        valeurs globales (map, bots, vision, couleurs)
  i18n.ts          traductions FR / EN
  core/            entrées, caméra, maths, buffer circulaire
  heroes/          classe Hero + un fichier par héros + registre
  entities/        bots, projectiles
  world/           map, ligne de vue, brouillard
  ui/              HUD, écran de sélection, statistiques
```
