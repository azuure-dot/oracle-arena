import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le jeu marche aussi dans un sous-dossier (GitHub Pages sert
  // le site sous /web-hero-shooter/, pas à la racine du domaine).
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      // Deux pages : le jeu et la galerie de sprites (chemins relatifs à la racine du projet).
      input: {
        main: 'index.html',
        sprites: 'sprites.html',
      },
    },
  },
});
