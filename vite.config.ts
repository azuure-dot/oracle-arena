import { defineConfig } from 'vite';

export default defineConfig({
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
