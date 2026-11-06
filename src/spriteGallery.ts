/**
 * Galerie de sprites (page /sprites.html) : toutes les vues et images de marche,
 * plus une version animée par direction. Sert à itérer sur les designs.
 */
import { COLORS } from './config';
import {
  HAMMER,
  HAMMER_PALETTE,
  REMPART_SPRITE,
  FLUX_SPRITE,
  TEMPO_SPRITE,
  ROBOT_SPRITE,
  TURRET_BARREL,
  TURRET_BASE,
  TURRET_PALETTE,
  type CharacterSprite,
} from './sprites/library';
import { characterFrame, propImage, WALK_FPS, WALK_FRAMES, type Facing } from './sprites/SpriteRenderer';

interface Entry {
  title: string;
  def: CharacterSprite;
  outline: string;
  overrides?: Record<string, string>;
}

const ENTRIES: Entry[] = [
  { title: 'Rempart (allié)', def: REMPART_SPRITE, outline: COLORS.ally },
  { title: 'Flux (allié)', def: FLUX_SPRITE, outline: COLORS.ally },
  { title: 'Tempo — aura Soin', def: TEMPO_SPRITE, outline: COLORS.ally, overrides: { a: COLORS.auraHeal } },
  { title: 'Tempo — aura Vitesse', def: TEMPO_SPRITE, outline: COLORS.ally, overrides: { a: COLORS.auraSpeed } },
  { title: 'Robot — ennemi', def: ROBOT_SPRITE, outline: COLORS.enemy, overrides: { t: COLORS.enemy } },
  { title: 'Robot — allié', def: ROBOT_SPRITE, outline: COLORS.ally, overrides: { t: COLORS.ally } },
];

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const FACING_LABEL: Record<Facing, string> = { down: 'Face', up: 'Dos', left: 'Gauche', right: 'Droite' };

const root = document.getElementById('gallery')!;
const zoomInput = document.getElementById('zoom') as HTMLInputElement;
const animated: { canvas: HTMLCanvasElement; entry: Entry; facing: Facing }[] = [];

function blit(canvas: HTMLCanvasElement, img: HTMLCanvasElement, scale: number): void {
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function render(): void {
  const scale = Number(zoomInput.value);
  root.innerHTML = '';
  animated.length = 0;

  for (const entry of ENTRIES) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>${entry.title}</h2><div class="rows"></div>`;
    const rows = section.querySelector('.rows')!;
    for (const facing of FACINGS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${FACING_LABEL[facing]}</span>`;
      for (let f = 0; f < WALK_FRAMES; f++) {
        const c = document.createElement('canvas');
        blit(c, characterFrame(entry.def, facing, f, { outline: entry.outline, overrides: entry.overrides }), scale);
        row.appendChild(c);
      }
      const anim = document.createElement('canvas');
      anim.className = 'anim';
      anim.title = 'Animation de marche';
      row.appendChild(anim);
      animated.push({ canvas: anim, entry, facing });
      rows.appendChild(row);
    }
    root.appendChild(section);
  }

  // Accessoires
  const props = document.createElement('section');
  props.innerHTML = '<h2>Accessoires</h2><div class="row"></div>';
  const row = props.querySelector('.row')!;
  for (const [name, img] of [
    ['Tourelle ennemie', propImage('turret.base', TURRET_BASE, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } })],
    ['Canon', propImage('turret.barrel', TURRET_BARREL, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } })],
    ['Tourelle alliée', propImage('turret.base', TURRET_BASE, TURRET_PALETTE, { outline: COLORS.ally, overrides: { t: COLORS.ally } })],
    ['Marteau', propImage('hammer', HAMMER, HAMMER_PALETTE, { outline: '#141820' })],
  ] as const) {
    const c = document.createElement('canvas');
    c.title = name;
    blit(c, img, scale);
    row.appendChild(c);
  }
  root.appendChild(props);
}

function animate(time: number): void {
  const scale = Number(zoomInput.value);
  const frame = Math.floor((time / 1000) * WALK_FPS) % WALK_FRAMES;
  for (const a of animated) {
    blit(a.canvas, characterFrame(a.entry.def, a.facing, frame, { outline: a.entry.outline, overrides: a.entry.overrides }), scale);
  }
  requestAnimationFrame(animate);
}

zoomInput.addEventListener('input', render);
render();
requestAnimationFrame(animate);
