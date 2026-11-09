/**
 * Galerie (page /galerie.html) : tous les personnages vus de dessus — chaque héros au repos,
 * en action, et une version animée qui tourne et marche ; puis les robots d'entraînement,
 * les tourelles et les projectiles. Sert à itérer sur les designs.
 */
import { COLORS } from './config';
import { Bot } from './entities/Bot';
import { Projectile, type ProjectileSpec } from './entities/Projectile';
import { ALLY, ENEMY } from './entities/Team';
import type { Hero } from './heroes/Hero';
import { HEROES } from './heroes/registry';

const root = document.getElementById('gallery')!;
const zoomInput = document.getElementById('zoom') as HTMLInputElement;
const walkers: { canvas: HTMLCanvasElement; hero: Hero; scale: number }[] = [];

/** Prépare un canvas de `size` unités de côté, origine au centre, à l'échelle `scale`. */
function cell(canvas: HTMLCanvasElement, scale: number, size: number, draw: (g: CanvasRenderingContext2D) => void): void {
  canvas.width = size * scale;
  canvas.height = size * scale;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.save();
  g.scale(scale, scale);
  g.translate(size / 2, size / 2);
  draw(g);
  g.restore();
}

/** Dessine un héros (centré) avec sa barre de vie. */
function drawHero(canvas: HTMLCanvasElement, hero: Hero, scale: number, size = 120): void {
  hero.x = 0;
  hero.y = 6;
  cell(canvas, scale, size, (g) => {
    hero.draw(g);
    hero.drawOver(g);
    hero.drawOverlay(g);
  });
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

function section(title: string): HTMLElement {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${title}</h2><div class="row"></div>`;
  root.appendChild(s);
  return s.querySelector('.row')!;
}

function render(): void {
  const scale = Number(zoomInput.value);
  root.innerHTML = '';
  walkers.length = 0;

  // Héros : au repos, leurs états d'action, puis une version animée qui tourne et marche.
  for (const entry of HEROES) {
    const row = section(entry.name);
    for (const [label, setup] of [['au repos', () => {}] as [string, Setup], ...(STATES[entry.id] ?? [])]) {
      const hero = entry.create();
      hero.outline = COLORS.ally;
      hero.aim = 0;
      setup(hero as unknown as Record<string, unknown>);
      const c = document.createElement('canvas');
      c.title = label;
      drawHero(c, hero, scale);
      row.appendChild(c);
    }
    const walker = entry.create();
    walker.outline = COLORS.ally;
    const anim = document.createElement('canvas');
    anim.className = 'anim';
    anim.title = 'Tourne avec la souris et marche (animé)';
    row.appendChild(anim);
    walkers.push({ canvas: anim, hero: walker, scale });
  }

  // Champ de tir : robots ennemi / allié / blessé, tourelle.
  const bots = section("Champ de tir : robots et tourelle");
  for (const [label, bot] of [
    ['robot ennemi', new Bot({ team: ENEMY, x: 0, y: 6, facing: Math.PI })],
    ['robot allié', new Bot({ team: ALLY, x: 0, y: 6, facing: 0 })],
    ['allié blessé', new Bot({ team: ALLY, x: 0, y: 6, facing: 0.6, wounded: true })],
    ['tourelle', new Bot({ team: ENEMY, x: 0, y: 6, kind: 'turret', facing: Math.PI * 0.8 })],
  ] as const) {
    const c = document.createElement('canvas');
    c.title = label;
    cell(c, scale, 90, (g) => {
      bot.draw(g);
      bot.drawOverlay(g);
    });
    bots.appendChild(c);
  }

  // Projectiles (vers la droite)
  const shots = section('Projectiles');
  const base = { x: 0, y: 0, angle: 0, speed: 100, damage: 0, team: ENEMY, range: 100 } as const;
  const specs: [string, Partial<ProjectileSpec>][] = [
    ['balle', { style: 'bullet' }],
    ['onde sonique', { style: 'sonic', radius: 6 }],
    ['onde de feu', { style: 'fire', radius: 26 }],
    ['tourelle', { style: 'enemy', radius: 5 }],
    ['goutte d’eau', { style: 'water', radius: 5 }],
    ...[0, 1, 2, 3].map((i) => ['équipement', { style: 'gear', radius: 11, gear: { index: i, spin: 0 } }] as [string, Partial<ProjectileSpec>]),
  ];
  for (const [label, spec] of specs) {
    const c = document.createElement('canvas');
    c.title = label;
    cell(c, scale, 70, (g) => new Projectile({ ...base, ...spec }).draw(g));
    shots.appendChild(c);
  }
}

let last = 0;
function animate(time: number): void {
  const dt = Math.min(0.05, (time - last) / 1000);
  last = time;
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
