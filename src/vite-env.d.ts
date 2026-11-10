/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur multijoueur (voir .env.example et docs/multijoueur.md). */
  readonly VITE_SERVER_URL?: string;
}
