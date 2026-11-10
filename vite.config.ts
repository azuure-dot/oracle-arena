import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le jeu marche aussi dans un sous-dossier (GitHub Pages sert
  // le site sous /oracle-arena/, pas à la racine du domaine).
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      // Deux pages : le jeu et la galerie des personnages (chemins relatifs à la racine du projet).
      input: {
        main: 'index.html',
        galerie: 'galerie.html',
      },
    },
  },
});
