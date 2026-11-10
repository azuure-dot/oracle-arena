import '@fontsource/marcellus/400.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import './style.css';
import { applyTheme } from './ui/theme';
import { Game } from './Game';
import { t } from './i18n';

document.title = t('menu.title');
applyTheme();

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
if (!(canvas instanceof HTMLCanvasElement) || !overlay) {
  throw new Error('Éléments #game / #overlay introuvables');
}

const game = new Game(canvas, overlay);
game.start();

// En dev uniquement : accès depuis la console (window.__game) pour déboguer.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game }).__game = game;
}
