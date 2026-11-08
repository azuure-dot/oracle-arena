/**
 * Galerie (page /sprites.html) : les héros vus de dessus (au repos, en action, et une version
 * animée qui tourne et marche), puis les sprites pixel art qui restent (robots d'entraînement,
 * tourelles, projectiles). Sert à itérer sur les designs.
 */
import { COLORS } from './config';
import { HEROES } from './heroes/registry';
import type { Hero } from './heroes/Hero';
import { ROBOT_SPRITE, TURRET_BARREL, TURRET_BASE, TURRET_PALETTE, type CharacterSprite } from './sprites/library';
import { characterFrame, propImage, WALK_FPS, WALK_FRAMES, type Facing } from './sprites/SpriteRenderer';
import { gearImage } from './sprites/skater';
import { BLAST_FRAMES, blastImage, bombImage, IMPACT_FRAMES, impactImage } from './sprites/turty';

interface Entry {
  title: string;
  def: CharacterSprite;
  outline: string;
  overrides?: Record<string, string>;
}

const ENTRIES: Entry[] = [
  { title: 'Robot — ennemi', def: ROBOT_SPRITE, outline: COLORS.enemy, overrides: { t: COLORS.enemy } },
  { title: 'Robot — allié', def: ROBOT_SPRITE, outline: COLORS.ally, overrides: { t: COLORS.ally } },
];

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const FACING_LABEL: Record<Facing, string> = { down: 'Face', up: 'Dos', left: 'Gauche', right: 'Droite' };

const root = document.getElementById('gallery')!;
const zoomInput = document.getElementById('zoom') as HTMLInputElement;
const animated: { canvas: HTMLCanvasElement; entry: Entry; facing: Facing }[] = [];
const walkers: { canvas: HTMLCanvasElement; hero: Hero; scale: number }[] = [];

function blit(canvas: HTMLCanvasElement, img: HTMLCanvasElement, scale: number): void {
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
}

/** Dessine un héros (centré, vu de dessus) dans un canvas de `size` unités de côté. */
function drawHero(canvas: HTMLCanvasElement, hero: Hero, scale: number, size = 120): void {
  canvas.width = size * scale;
  canvas.height = size * scale;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.save();
  g.scale(scale, scale);
  g.translate(size / 2 - hero.x, size / 2 - hero.y + 6);
  hero.draw(g);
  hero.drawOver(g);
  hero.drawOverlay(g);
  g.restore();
}

/** États montrés pour chaque héros (champs internes réglés à la main, visée vers la droite). */
type Setup = (h: Record<string, unknown>) => void;
const STATES: Record<string, [string, Setup][]> = {
  rempart: [
    ['frappe', (h) => Object.assign(h, { swingAnim: 0.1, swingSide: 1 })],
    ['bouclier', (h) => Object.assign(h, { shieldUp: true, shieldAngle: 0 })],
  ],
  thor: [
    ['frappe', (h) => Object.assign(h, { swing: { t: 0.1, side: 1, dir: 0, punch: false } })],
    ['marteau lancé', (h) => Object.assign(h, { hammer: { phase: 'landed', x: 0, y: 0 }, swing: { t: 0.08, side: 1, dir: 0, punch: true } })],
  ],
  flux: [['tir', (h) => Object.assign(h, { recoil: [0, 0.07], muzzleSide: 1 })]],
  turty: [
    ['tir', (h) => Object.assign(h, { recoil: 0.09 })],
    ['tortue', (h) => Object.assign(h, { form: 'turtle' })],
    ['carapace', (h) => Object.assign(h, { shell: { spin: 0.6, windup: 0, dir: 0 } })],
  ],
  tempo: [
    ['tir', (h) => Object.assign(h, { recoil: 0.08 })],
    ['aura Vitesse', (h) => Object.assign(h, { mode: 'speed' })],
  ],
  skater: [
    ['coup de planche', (h) => Object.assign(h, { swing: { step: 0, t: 0.08, aim: 0 }, footTimer: 1 })],
    ['lancer', (h) => Object.assign(h, { throwAnim: 0.25 })],
  ],
};

function render(): void {
  const scale = Number(zoomInput.value);
  root.innerHTML = '';
  animated.length = 0;
  walkers.length = 0;
  const z = Math.max(1, scale * 0.6);

  // Héros vus de dessus : au repos, leurs états d'action, puis une version animée qui tourne et marche.
  for (const entry of HEROES) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>${entry.name}</h2><div class="row"></div>`;
    const row = section.querySelector('.row')!;
    for (const [label, setup] of [['au repos', () => {}] as [string, Setup], ...(STATES[entry.id] ?? [])]) {
      const hero = entry.create();
      hero.outline = COLORS.ally;
      hero.aim = 0;
      setup(hero as unknown as Record<string, unknown>);
      const c = document.createElement('canvas');
      c.title = label;
      drawHero(c, hero, z);
      row.appendChild(c);
    }
    const walker = entry.create();
    walker.outline = COLORS.ally;
    const anim = document.createElement('canvas');
    anim.className = 'anim';
    anim.title = 'Tourne avec la souris et marche (animé)';
    row.appendChild(anim);
    walkers.push({ canvas: anim, hero: walker, scale: z });
    root.appendChild(section);
  }

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

  // Accessoires et projectiles encore en pixel art
  const props = document.createElement('section');
  props.innerHTML = '<h2>Accessoires et projectiles</h2><div class="row"></div>';
  const row = props.querySelector('.row')!;
  const small = Math.max(1, Math.round(scale * 0.6));
  const imgs: [HTMLCanvasElement, number][] = [
    [propImage('turret.base', TURRET_BASE, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } }), scale],
    [propImage('turret.barrel', TURRET_BARREL, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } }), scale],
    ...[0, 1, 2, 3].map((i) => [gearImage(i, COLORS.enemy), small] as [HTMLCanvasElement, number]),
    [bombImage('right'), small],
    ...Array.from({ length: IMPACT_FRAMES }, (_, i) => [impactImage(i), small] as [HTMLCanvasElement, number]),
    ...Array.from({ length: BLAST_FRAMES }, (_, i) => [blastImage(i), small] as [HTMLCanvasElement, number]),
  ];
  for (const [img, s] of imgs) {
    const c = document.createElement('canvas');
    blit(c, img, s);
    row.appendChild(c);
  }
  root.appendChild(props);
}

let last = 0;
function animate(time: number): void {
  const dt = Math.min(0.05, (time - last) / 1000);
  last = time;
  const scale = Number(zoomInput.value);
  const frame = Math.floor((time / 1000) * WALK_FPS) % WALK_FRAMES;
  for (const a of animated) {
    blit(a.canvas, characterFrame(a.entry.def, a.facing, frame, { outline: a.entry.outline, overrides: a.entry.overrides }), scale);
  }
  // Marche sur place en tournant sur lui-même : vitesse simulée, animations avancées à la main.
  for (const w of walkers) {
    const h = w.hero as unknown as Record<string, number>;
    w.hero.aim = time / 1400;
    w.hero.vx = Math.cos(w.hero.aim) * 110;
    w.hero.vy = Math.sin(w.hero.aim) * 110;
    for (const k of ['animTime', 'walkAnim']) if (typeof h[k] === 'number') h[k] += dt;
    if (typeof h.walkCycle === 'number') h.walkCycle += (110 * dt) / 140;
    drawHero(w.canvas, w.hero, w.scale);
  }
  requestAnimationFrame(animate);
}

zoomInput.addEventListener('input', render);
render();
requestAnimationFrame(animate);
