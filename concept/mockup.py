"""
Maquette pixel art d'une scène de jeu (Contrôle sur Sanctuaire).
Rendu en 480x270 puis agrandi x4 sans lissage → 1920x1080.
Réutilise les sprites des héros définis dans src/sprites/library.ts.
Aucune dépendance : encodeur PNG maison (zlib + struct).
"""
import math
import random
import re
import struct
import sys
import zlib

LIB, OUT = sys.argv[1], sys.argv[2]
random.seed(11)
W, H = 480, 270
SCALE = 4


def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


img = [[(0, 0, 0) for _ in range(W)] for _ in range(H)]


def inb(x, y):
    return 0 <= x < W and 0 <= y < H


def put(x, y, c):
    x, y = int(x), int(y)
    if inb(x, y):
        img[y][x] = c


def get(x, y):
    return img[int(y)][int(x)]


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def blend(x, y, c, a):
    x, y = int(x), int(y)
    if inb(x, y):
        img[y][x] = mix(img[y][x], c, a)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


def rect(x, y, w, h, c, a=1.0):
    for yy in range(int(y), int(y + h)):
        for xx in range(int(x), int(x + w)):
            if a >= 1:
                put(xx, yy, c)
            else:
                blend(xx, yy, c, a)


BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def dither(x, y, t):
    """Vrai si le pixel doit être allumé pour une intensité t (0..1) : dégradés tramés."""
    return t * 16 > BAYER[int(y) % 4][int(x) % 4] + 0.5


# ------------------------------------------------------------------ palette du décor
P = {
    'stone1': hexc('#4a4f63'), 'stone2': hexc('#535970'), 'stone3': hexc('#444a5d'),
    'mortar': hexc('#2c2f3d'), 'stoneHi': hexc('#646b84'), 'stoneLo': hexc('#383c4d'),
    'grass1': hexc('#3e6b48'), 'grass2': hexc('#4f8a54'), 'grass3': hexc('#2f5538'), 'flower': hexc('#f2d16b'),
    'flower2': hexc('#e97b8f'),
    'water1': hexc('#24527a'), 'water2': hexc('#2f6a98'), 'waterHi': hexc('#8fd3ff'),
    'wallTop': hexc('#9196ab'), 'wallTopLo': hexc('#767b91'), 'wallFace': hexc('#5b5f75'),
    'wallFaceLo': hexc('#474a5c'), 'wallJoint': hexc('#363847'),
    'roof1': hexc('#a8483c'), 'roof2': hexc('#7d3530'), 'roofHi': hexc('#c96652'),
    'wood1': hexc('#8a5a36'), 'wood2': hexc('#5e3b22'), 'woodHi': hexc('#b07a4a'),
    'gold': hexc('#e2b84c'), 'goldLo': hexc('#a9822f'),
    'leaf1': hexc('#2f6b3e'), 'leaf2': hexc('#3f8a4c'), 'leaf3': hexc('#5fae5c'), 'leafLo': hexc('#1f4a2c'),
    'blue': hexc('#4da3ff'), 'red': hexc('#ff4d5e'), 'shield': hexc('#7fd8ff'), 'bullet': hexc('#ffe39a'),
    'sonic': hexc('#5be37d'), 'heal': hexc('#ffd84d'), 'white': (255, 255, 255), 'ink': hexc('#10141a'),
    'hud': hexc('#e9eef5'), 'hudDim': hexc('#8d96a6'), 'orange': hexc('#ffb347'), 'cyan': hexc('#7fd8ff'),
}

# ------------------------------------------------------------------ sprites des héros (library.ts)
src = open(LIB, encoding='utf-8').read()
GRIDS = {}
for body, name in re.findall(r"grid\(`([\s\S]*?)`,\s*'([\w.]+)'\)", src):
    GRIDS[name] = [ln.strip()[1:-1] for ln in body.strip().splitlines()]


def palette_of(const):
    i = src.index('export const ' + const)
    block = src[i:src.index('palette:', i)]
    pal_txt = src[src.index('palette:', i):]
    pal_txt = pal_txt[:pal_txt.index('}')]
    return {k: hexc(v) for k, v in re.findall(r"(\w):\s*'(#[0-9a-fA-F]{6})'", pal_txt)}, block


PAL = {k: palette_of(k.upper() + '_SPRITE')[0] for k in ('flux', 'tempo', 'rempart')}
LEGS = {'flux': 'legs', 'tempo': 'legs', 'rempart': 'knight'}


def compose(hero, facing, step):
    legs = LEGS[hero]
    if facing in ('down', 'up'):
        rows = GRIDS[f'{hero}.{facing}'] + GRIDS[f'{legs}.frontStep' if step else f'{legs}.frontIdle']
    else:
        rows = GRIDS[f'{hero}.right'] + GRIDS[f'{legs}.sideStride' if step else f'{legs}.sideIdle']
    if facing == 'left':
        rows = [r[::-1] for r in rows]
    return rows


def draw_sprite(hero, fx, fy, facing, outline, step=False, overrides=None, alpha=1.0, silhouette=None):
    """Sprite posé pieds en (fx, fy), contour d'1 px à la couleur d'équipe."""
    rows = compose(hero, facing, step)
    pal = dict(PAL[hero])
    if overrides:
        pal.update(overrides)
    h, w = len(rows), len(rows[0])
    ox, oy = int(fx - w // 2), int(fy - h)

    def solid(cx, cy):
        return 0 <= cy < h and 0 <= cx < w and rows[cy][cx] != '.'

    for cy in range(-1, h + 1):
        for cx in range(-1, w + 1):
            x, y = ox + cx, oy + cy
            if solid(cx, cy):
                c = silhouette or pal.get(rows[cy][cx], (255, 0, 255))
                # petit éclairage : plus clair en haut à gauche du sprite
                if not silhouette and cy < h * 0.35:
                    c = shade(c, 1.06)
                (put if alpha >= 1 else lambda a, b, col: blend(a, b, col, alpha))(x, y, c)
            elif any(solid(cx + dx, cy + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                if alpha >= 1:
                    put(x, y, outline)
                else:
                    blend(x, y, outline, alpha)
    return ox, oy, w, h


# ------------------------------------------------------------------ sol
def floor():
    T = 16
    for ty in range(0, H, T):
        off = 8 if (ty // T) % 2 else 0
        for tx in range(-8, W, T):
            x0 = tx + off
            base = random.choice([P['stone1'], P['stone2'], P['stone3'], P['stone1']])
            for y in range(ty, ty + T):
                for x in range(x0, x0 + T):
                    if not inb(x, y):
                        continue
                    lx, ly = x - x0, y - ty
                    if lx == 0 or ly == 0:
                        c = P['mortar']
                    elif lx == 1 or ly == 1:
                        c = P['stoneHi'] if (lx + ly) % 3 else base
                    elif lx == T - 1 or ly == T - 1:
                        c = P['stoneLo']
                    else:
                        r = random.random()
                        c = shade(base, 0.94) if r < 0.08 else shade(base, 1.05) if r < 0.12 else base
                    img[y][x] = c
            # fissure de temps en temps
            if random.random() < 0.18:
                cx, cy = x0 + random.randint(4, 11), ty + random.randint(4, 11)
                for i in range(random.randint(3, 6)):
                    put(cx, cy, P['mortar'])
                    cx += random.choice((-1, 0, 1))
                    cy += 1


def grass_patch(cx, cy, rx, ry):
    for y in range(int(cy - ry - 3), int(cy + ry + 3)):
        for x in range(int(cx - rx - 3), int(cx + rx + 3)):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            edge = 1 + 0.18 * math.sin(x * 0.7 + y * 0.3) + 0.1 * math.sin(y * 1.3)
            if d < edge and inb(x, y):
                r = random.random()
                c = P['grass2'] if r < 0.35 else P['grass3'] if r < 0.5 else P['grass1']
                img[y][x] = c
    for _ in range(int(rx * ry / 9)):
        x = cx + random.uniform(-rx, rx)
        y = cy + random.uniform(-ry, ry)
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.8:
            put(x, y, hexc('#78c06a'))
            put(x, y - 1, P['grass2'])
    for _ in range(int(rx * ry / 60)):
        x = cx + random.uniform(-rx * 0.8, rx * 0.8)
        y = cy + random.uniform(-ry * 0.8, ry * 0.8)
        col = random.choice([P['flower'], P['flower2'], P['white']])
        put(x, y, col)
        put(x, y + 1, P['grass3'])


def canal(x0, x1, y0):
    # Rebord de pierre (face supérieure + face avant), puis l'eau
    for x in range(x0, x1):
        for y in range(y0, y0 + 4):
            put(x, y, P['wallTop'] if y < y0 + 3 else P['wallTopLo'])
        for y in range(y0 + 4, y0 + 8):
            put(x, y, P['wallFace'] if (x // 6 + (y > y0 + 5)) % 2 else P['wallFaceLo'])
        if x % 12 == 0:
            for y in range(y0, y0 + 3):
                put(x, y, P['wallTopLo'])
    for y in range(y0 + 8, H):
        for x in range(x0, x1):
            t = (y - y0 - 8)
            base = P['water1'] if t > 6 else mix(P['water2'], P['water1'], t / 7)
            img[y][x] = base
    # vaguelettes
    for _ in range(70):
        x = random.randint(x0, x1 - 6)
        y = random.randint(y0 + 10, H - 2)
        L = random.randint(2, 5)
        for i in range(L):
            put(x + i, y, P['water2'] if i in (0, L - 1) else P['waterHi'])
    # ombre du rebord sur l'eau
    for x in range(x0, x1):
        for y in range(y0 + 8, y0 + 11):
            if dither(x, y, 0.6 - (y - y0 - 8) * 0.2):
                put(x, y, shade(get(x, y), 0.6))


# ------------------------------------------------------------------ murs (vue 3/4)
def wall_h(x0, x1, y_top, top_h=8, face_h=14):
    """Mur horizontal : dessus clair + façade en briques + ombre portée au sol."""
    for x in range(x0, x1):
        for y in range(y_top, y_top + top_h):
            ly = y - y_top
            c = P['wallTop']
            if ly == 0:
                c = shade(P['wallTop'], 1.15)
            elif ly == top_h - 1:
                c = P['wallTopLo']
            elif (x - x0) % 16 == 0:
                c = P['wallTopLo']
            put(x, y, c)
        for y in range(y_top + top_h, y_top + top_h + face_h):
            ly = y - y_top - top_h
            row = ly // 4
            joint_x = (x - x0 + (row % 2) * 6) % 12 == 0
            c = P['wallJoint'] if ly % 4 == 3 or joint_x else (P['wallFace'] if (row + (x // 12)) % 3 else P['wallFaceLo'])
            if ly == 0:
                c = shade(P['wallFace'], 0.8)
            put(x, y, c)
    # ombre portée (soleil en haut à gauche → ombre vers le bas à droite)
    for x in range(x0 + 3, x1 + 4):
        for y in range(y_top + top_h + face_h, y_top + top_h + face_h + 7):
            if inb(x, y) and dither(x, y, 0.75 - (y - y_top - top_h - face_h) * 0.1):
                put(x, y, shade(get(x, y), 0.62))


def wall_v(x, y0, y1, w=14, face_h=12):
    """Mur vertical : on voit le dessus, et la façade seulement au bout."""
    for yy in range(y0, y1):
        for xx in range(x, x + w):
            lx = xx - x
            c = P['wallTop']
            if lx == 0:
                c = shade(P['wallTop'], 1.15)
            elif lx == w - 1:
                c = P['wallTopLo']
            elif (yy - y0) % 16 == 0:
                c = P['wallTopLo']
            put(xx, yy, c)
        for xx in range(x + w, x + w + 5):
            if dither(xx, yy, 0.7 - (xx - x - w) * 0.14):
                put(xx, yy, shade(get(xx, yy), 0.62))
    for yy in range(y1, y1 + face_h):
        for xx in range(x, x + w):
            ly = yy - y1
            joint = ly % 4 == 3 or (xx - x + (ly // 4 % 2) * 4) % 8 == 0
            put(xx, yy, P['wallJoint'] if joint else P['wallFace'])
    for yy in range(y1 + face_h, y1 + face_h + 5):
        for xx in range(x + 2, x + w + 4):
            if dither(xx, yy, 0.6):
                put(xx, yy, shade(get(xx, yy), 0.65))


def crate(x, y, s=14):
    rect(x + 3, y + s + 4, s, 3, P['ink'], 0.35)  # ombre
    for yy in range(y, y + 5):  # dessus
        for xx in range(x, x + s):
            put(xx, yy, P['woodHi'] if yy == y else P['wood1'])
    for yy in range(y + 5, y + s + 4):  # face
        for xx in range(x, x + s):
            edge = xx in (x, x + s - 1) or yy in (y + 5, y + s + 3)
            diag = abs((xx - x) - (yy - y - 5) * s / (s - 1)) < 1.2
            put(xx, yy, P['wood2'] if edge or diag else P['wood1'])
    for xx in range(x, x + s):
        put(xx, y + 4, P['wood2'])


def barrel(x, y):
    rect(x + 2, y + 14, 12, 3, P['ink'], 0.35)
    for yy in range(y, y + 15):
        for xx in range(x, x + 12):
            dx = (xx - x - 5.5) / 6
            if dx * dx > 1:
                continue
            c = P['wood1'] if abs(dx) < 0.55 else P['wood2']
            if yy in (y + 3, y + 11):
                c = hexc('#3a3f52')
            put(xx, yy, c)
    for xx in range(x + 1, x + 11):
        put(xx, y, P['woodHi'])


def lantern(x, y):
    rect(x, y - 2, 1, 10, hexc('#2a2f38'))
    rect(x - 2, y - 7, 5, 6, hexc('#2a2f38'))
    rect(x - 1, y - 6, 3, 4, hexc('#ffd27a'))
    put(x, y - 5, P['white'])


def tree(cx, cy, r):
    rect(cx - 3, cy + r - 6, 6, 14, P['wood2'])
    for y in range(cy - r, cy + r):
        for x in range(cx - r, cx + r):
            d = math.hypot((x - cx) / r, (y - cy) / (r * 0.85))
            wob = 1 + 0.12 * math.sin(math.atan2(y - cy, x - cx) * 7)
            if d < wob and inb(x, y):
                lit = (x - cx) + (y - cy) < -r * 0.3
                dark = (x - cx) + (y - cy) > r * 0.5
                c = P['leaf3'] if lit else P['leafLo'] if dark else P['leaf2']
                if random.random() < 0.18:
                    c = P['leaf1']
                img[y][x] = c
    for y in range(cy + r, cy + r + 8):  # ombre du feuillage
        for x in range(cx - r + 6, cx + r + 6):
            if inb(x, y) and dither(x, y, 0.55):
                put(x, y, shade(get(x, y), 0.65))


def roof(x0, y0):
    for y in range(y0, H):
        for x in range(x0, W):
            ly = y - y0
            row = ly // 5
            tile_x = (x - x0 + (row % 2) * 4) % 8
            c = P['roof1']
            if ly % 5 == 4:
                c = P['roof2']
            elif tile_x == 0:
                c = P['roof2']
            elif ly % 5 == 0:
                c = P['roofHi']
            put(x, y, c)
    for x in range(x0, W):  # faîtage + bord
        put(x, y0, shade(P['roof2'], 0.8))
        put(x, y0 + 1, P['roofHi'])
    for y in range(y0, H):
        put(x0, y, shade(P['roof2'], 0.8))
    # cheminée
    rect(x0 + 60, y0 - 14, 12, 22, P['wallFace'])
    rect(x0 + 60, y0 - 16, 12, 3, P['wallTop'])
    rect(x0 + 62, y0 - 15, 8, 1, P['ink'])
    for i, (dx, dy) in enumerate([(66, -22), (68, -28), (65, -34), (69, -40)]):  # fumée
        rect(x0 + dx - 2 + i % 2, y0 + dy, 4 + i, 3, hexc('#c7cbd6'), 0.35)


# ------------------------------------------------------------------ point de contrôle
def control_point(cx, cy, rx, ry, owner_col, capture_col, progress):
    for y in range(cy - ry - 2, cy + ry + 3):
        for x in range(cx - rx - 2, cx + rx + 3):
            d = math.hypot((x - cx) / rx, (y - cy) / ry)
            if d <= 1.0:
                c = get(x, y)
                c = mix(c, owner_col, 0.16)
                if 0.62 < d < 0.7:
                    c = mix(P['goldLo'], P['gold'], 0.5)
                img[y][x] = c
            if 0.97 < d <= 1.05:
                ang = math.atan2((y - cy) / ry, (x - cx) / rx)
                if int((ang + math.pi) * 9) % 2 == 0:
                    put(x, y, owner_col)
            # arc de capture adverse à l'intérieur de l'anneau doré
            if 0.74 < d < 0.82:
                ang = (math.atan2((y - cy) / ry, (x - cx) / rx) + math.pi / 2) % (2 * math.pi)
                if ang < progress * 2 * math.pi:
                    put(x, y, capture_col)
    # emblème central (losange)
    for y in range(-8, 9):
        for x in range(-11, 12):
            if abs(x) / 11 + abs(y) / 8 <= 1:
                inner = abs(x) / 11 + abs(y) / 8 <= 0.55
                put(cx + x, cy + y, shade(owner_col, 1.15) if inner else shade(owner_col, 0.75))


def plaza(cx, cy, rx, ry):
    """Place circulaire : pavés en anneaux concentriques autour du point, bordure claire."""
    rnd = random.Random(5)
    shades = {}
    for y in range(cy - ry - 3, cy + ry + 4):
        for x in range(cx - rx - 3, cx + rx + 4):
            if not inb(x, y):
                continue
            nx, ny = (x - cx) / rx, (y - cy) / ry
            d = math.hypot(nx, ny)
            if d > 1.04:
                continue
            if d > 0.97:
                img[y][x] = P['wallTop'] if d < 1.0 else P['wallTopLo']
                continue
            r = d * rx
            ring = int(r // 9)
            ang = (math.atan2(ny, nx) + math.pi) / (2 * math.pi)
            segs = max(6, ring * 7)
            seg = int(ang * segs + ring * 0.5)
            key = (ring, seg % segs)
            if key not in shades:
                shades[key] = rnd.choice([hexc('#5c6177'), hexc('#646a80'), hexc('#575c71'), hexc('#6b7187')])
            c = shades[key]
            if r % 9 < 1 or (ang * segs + ring * 0.5) % 1 < 1 / max(8, r * 0.9):
                c = P['mortar']
            elif r % 9 < 2:
                c = shade(c, 1.12)
            img[y][x] = c


def tufts(n):
    """Brins d'herbe dans les joints des dalles."""
    for _ in range(n):
        x, y = random.randint(0, W - 1), random.randint(0, H - 1)
        if get(x, y) == P['mortar']:
            put(x, y, P['grass1'])
            put(x, y - 1, P['grass2'])
            if random.random() < 0.5:
                put(x + 1, y, P['grass3'])


def bush(cx, cy, r):
    for y in range(cy + r - 2, cy + r + 3):
        for x in range(cx - r + 2, cx + r + 4):
            if dither(x, y, 0.6):
                put(x, y, shade(get(x, y), 0.6))
    for y in range(cy - r, cy + r):
        for x in range(cx - r, cx + r):
            d = math.hypot(x - cx, (y - cy) * 1.15) / r
            wob = 1 + 0.15 * math.sin(math.atan2(y - cy, x - cx) * 5)
            if d < wob and inb(x, y):
                lit = (x - cx) + (y - cy) < -r * 0.2
                c = P['leaf3'] if lit else P['leaf2'] if d < 0.7 else P['leafLo']
                if random.random() < 0.15:
                    c = P['leaf1']
                img[y][x] = c
    for _ in range(3):
        put(cx + random.randint(-r // 2, r // 2), cy + random.randint(-r // 2, r // 3), P['flower2'])


def banner(x, y, col, trim):
    for yy in range(y, y + 15):
        for xx in range(x, x + 9):
            ly = yy - y
            if ly > 10 and abs(xx - (x + 4)) > 14 - ly:
                continue  # pointe
            c = col if 1 < xx - x < 7 else trim
            if ly == 0:
                c = trim
            put(xx, yy, c)
    for yy in range(y + 4, y + 9):  # emblème
        put(x + 4, yy, trim)
    put(x + 3, y + 6, trim)
    put(x + 5, y + 6, trim)
    rect(x - 1, y - 1, 11, 1, hexc('#2a2f38'))


def motes(cx, cy, r, col, n):
    for _ in range(n):
        a = random.uniform(0, 2 * math.pi)
        d = random.uniform(4, r)
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.8
        put(x, y, col)
        if random.random() < 0.4:
            blend(x + 1, y, col, 0.4)


def heal_aura(cx, cy, rx, ry, t):
    for y in range(cy - ry - 1, cy + ry + 2):
        for x in range(cx - rx - 1, cx + rx + 2):
            d = math.hypot((x - cx) / rx, (y - cy) / ry)
            if d <= 1:
                blend(x, y, P['heal'], 0.10)
            if 0.94 < d <= 1.04:
                ang = math.atan2(y - cy, x - cx)
                if int((ang + t) * 8) % 2 == 0:
                    put(x, y, P['heal'])


def ground_ring(cx, cy, hw, col):
    rx, ry = hw + 3, 3
    for y in range(cy - ry - 1, cy + ry + 2):
        for x in range(cx - rx - 1, cx + rx + 2):
            d = math.hypot((x - cx) / rx, (y - cy) / ry)
            if d < 0.9:
                blend(x, y, P['ink'], 0.45)
            elif d < 1.15:
                put(x, y, col)


def health_bar(cx, top, frac, col, w=18):
    x0 = cx - w // 2
    rect(x0 - 1, top - 1, w + 2, 4, P['ink'])
    rect(x0, top, w, 2, hexc('#2c313c'))
    rect(x0, top, int(w * frac), 2, col)
    for i in range(1, 4):
        put(x0 + i * w // 4, top, P['ink'])
        put(x0 + i * w // 4, top + 1, P['ink'])


def health_pack(x, y):
    rect(x - 7, y + 4, 15, 4, P['wallFaceLo'])
    rect(x - 7, y + 2, 15, 3, P['wallTop'])
    rect(x - 1, y - 6, 3, 9, P['cyan'])
    rect(x - 4, y - 3, 9, 3, P['cyan'])
    rect(x, y - 5, 1, 7, P['white'])
    rect(x - 3, y - 2, 7, 1, P['white'])


# ------------------------------------------------------------------ police pixel 5x7
FONT = {
    '0': ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    '1': ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    '2': ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    '3': ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    '4': ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    '5': ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    '6': ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    '7': ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    '8': ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    '9': ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'B': ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    'C': ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'F': ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    'G': ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'I': ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    'K': ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    'X': ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    '%': ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
    '/': ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    ':': ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    '-': ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    '+': ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    ' ': ["00000"] * 7,
}


def text(x, y, s, col, scale=1, shadow=True):
    cx = x
    for ch in s:
        g = FONT.get(ch, FONT[' '])
        for gy, row in enumerate(g):
            for gx, bit in enumerate(row):
                if bit == '1':
                    for sy in range(scale):
                        for sx in range(scale):
                            px, py = cx + gx * scale + sx, y + gy * scale + sy
                            if shadow:
                                put(px + 1, py + 1, P['ink'])
                            put(px, py, col)
        cx += 6 * scale
    return cx


def text_w(s, scale=1):
    return len(s) * 6 * scale - scale


def panel(x, y, w, h, border=None):
    rect(x, y, w, h, P['ink'], 0.78)
    if border:
        for xx in range(x, x + w):
            put(xx, y, border)
            put(xx, y + h - 1, border)
        for yy in range(y, y + h):
            put(x, yy, border)
            put(x + w - 1, yy, border)


# ------------------------------------------------------------------ effets
def tracer(x0, y0, x1, y1, col, length=7):
    d = math.hypot(x1 - x0, y1 - y0)
    for i in range(length):
        t = i / length
        blend(x0 + (x1 - x0) * t * length / d, y0 + (y1 - y0) * t * length / d, col, 0.35 + 0.65 * t)


def sparks(cx, cy, col, n=7, r=6):
    for _ in range(n):
        a = random.uniform(0, 2 * math.pi)
        d = random.uniform(1, r)
        put(cx + math.cos(a) * d, cy + math.sin(a) * d, random.choice([col, P['white']]))


def shield_arc(cx, cy, facing_ang, radius, half):
    for y in range(int(cy - radius - 6), int(cy + radius + 6)):
        for x in range(int(cx - radius - 6), int(cx + radius + 6)):
            dx, dy = x - cx, (y - cy) * 1.15
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            da = abs((ang - facing_ang + math.pi) % (2 * math.pi) - math.pi)
            if da > half:
                continue
            if radius - 2.5 <= d <= radius + 2.5:
                edge = d > radius + 1.5
                hexa = (int(x / 3) + int(y / 3)) % 2 == 0
                if edge:
                    put(x, y, mix(P['shield'], P['white'], 0.5))
                else:
                    blend(x, y, P['shield'], 0.55 if hexa else 0.38)


def light(cx, cy, r, col, strength):
    """Lumière additive tramée (4 paliers) : rendu pixel art plutôt qu'un dégradé lisse."""
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            if not inb(x, y):
                continue
            d = math.hypot(x - cx, (y - cy) * 1.25) / r
            if d >= 1:
                continue
            f = (1 - d) ** 1.6 * strength
            level = math.floor(f * 4 + BAYER[y % 4][x % 4] / 16) / 4
            if level <= 0:
                continue
            c = img[y][x]
            img[y][x] = tuple(min(255, int(c[i] + col[i] * level * 0.55)) for i in range(3))


# ================================================================== SCÈNE
floor()
tufts(900)
grass_patch(60, 70, 70, 48)
grass_patch(470, 120, 36, 70)
grass_patch(30, 205, 40, 20)
canal(0, 210, 230)

# Zone « hors de vue » au nord du mur : sera assombrie à la fin
wall_h(70, 206, 40)
wall_h(274, 430, 40)
wall_v(30, 62, 196)
banner(112, 49, hexc('#2f6a98'), P['gold'])
banner(160, 49, hexc('#2f6a98'), P['gold'])
banner(318, 49, hexc('#8a2f3a'), P['gold'])
banner(366, 49, hexc('#8a2f3a'), P['gold'])
tree(452, 44, 34)
lantern(203, 46)
lantern(277, 46)

PT = (256, 152)
plaza(PT[0], PT[1], 96, 70)
control_point(PT[0], PT[1], 60, 42, P['blue'], P['red'], 0.32)
bush(58, 190, 11)
bush(74, 198, 8)
bush(452, 196, 12)
heal_aura(160, 148, 34, 24, 0.4)
health_pack(98, 166)

crate(122, 102)
crate(136, 110)
crate(330, 186)
barrel(348, 182)

# Ombres des personnages
for fx, fy, r in [(160, 152, 9), (205, 188, 9), (318, 128, 13), (376, 168, 9)]:
    for y in range(fy - 3, fy + 3):
        for x in range(fx - r, fx + r + 1):
            if ((x - fx) / r) ** 2 + ((y - fy) / 3) ** 2 < 1:
                blend(x, y, P['ink'], 0.4)

# Anneaux d'équipe
ground_ring(160, 152, 7, P['blue'])
ground_ring(205, 188, 7, P['blue'])
ground_ring(318, 128, 10, P['red'])
ground_ring(376, 168, 7, P['red'])

# Flux rouge : traînée de Transfert (fantômes) puis le vrai
draw_sprite('flux', 412, 160, 'left', P['red'], silhouette=P['red'], alpha=0.22)
draw_sprite('flux', 396, 165, 'left', P['red'], silhouette=P['red'], alpha=0.4)

# Personnages (de l'arrière vers l'avant)
draw_sprite('rempart', 318, 128, 'left', P['red'])
draw_sprite('tempo', 160, 152, 'right', P['blue'], overrides={'a': P['heal']})
draw_sprite('flux', 376, 168, 'left', P['red'], step=True)
draw_sprite('flux', 205, 188, 'right', P['blue'], step=True)

# Bouclier de Rempart (vers la gauche) + impacts des balles
shield_arc(318, 116, math.pi, 26, math.radians(62))
for sx, sy in [(293, 104), (292, 116), (294, 124)]:
    sparks(sx, sy, P['bullet'], 6, 4)

# Rafale du Flux bleu vers le bouclier
mx, my = 216, 176
for i, (tx, ty) in enumerate([(292, 104), (292, 116), (293, 124)]):
    for k in (0.25, 0.55, 0.85):
        px, py = mx + (tx - mx) * k + i, my + (ty - my) * k
        tracer(px - (tx - mx) * 0.08, py - (ty - my) * 0.08, px, py, P['bullet'], 8)
rect(mx - 1, my - 1, 3, 3, hexc('#fff3c4'))

# Tempo : projectiles soniques vers le Flux rouge
for k in (0.35, 0.62):
    ox, oy = 172 + (370 - 172) * k, 142 + (156 - 142) * k
    for y in range(-3, 4):
        for x in range(-3, 4):
            d = math.hypot(x, y)
            if d <= 2.6:
                put(ox + x, oy + y, P['white'] if d < 1.2 else P['sonic'])
            elif d <= 3.4:
                blend(ox + x, oy + y, P['sonic'], 0.4)

# Barres de vie
health_bar(160, 126, 0.85, P['blue'])
health_bar(205, 162, 0.78, P['hud'])
health_bar(318, 98, 0.62, P['red'], 24)
health_bar(376, 142, 0.4, P['red'])
text(366, 128, '-20', P['bullet'])

# Toit au premier plan (bas à droite)
roof(372, 214)

# ------------------------------------------------------------------ lumière et ambiance
# Hors de vue (au nord du mur) : brouillard tramé
for y in range(0, 40):
    for x in range(W):
        f = 0.75 - y / 40 * 0.25
        if dither(x, y, 0.85):
            img[y][x] = shade(img[y][x], 1 - f)
        else:
            img[y][x] = shade(img[y][x], 0.55)

light(PT[0], PT[1], 80, P['blue'], 0.45)
light(203, 44, 46, hexc('#ffc56b'), 0.9)
light(277, 44, 46, hexc('#ffc56b'), 0.9)
motes(203, 52, 30, hexc('#ffe7a8'), 10)
motes(277, 52, 30, hexc('#ffe7a8'), 10)
motes(PT[0], PT[1], 70, hexc('#bfe4ff'), 18)
light(98, 160, 24, P['cyan'], 0.8)
light(mx, my, 20, hexc('#ffe39a'), 1.0)
light(160, 146, 40, P['heal'], 0.35)
light(300, 114, 22, P['shield'], 0.6)

# Étalonnage « fin de journée » + vignette tramée
for y in range(H):
    for x in range(W):
        r, g, b = img[y][x]
        r, g, b = min(255, r * 1.04 + 4), g * 0.98, b * 0.93
        dx, dy = (x - W / 2) / (W / 2), (y - H / 2) / (H / 2)
        v = dx * dx * 0.6 + dy * dy * 0.75
        if v > 0.45 and dither(x, y, min(1, (v - 0.45) * 1.6)):
            r, g, b = r * 0.78, g * 0.78, b * 0.82
        img[y][x] = (int(r), int(g), int(b))

# ------------------------------------------------------------------ HUD pixel
# Bandeau du point : BLEU 45 % | point | 12 % ROUGE
cx = W // 2
panel(cx - 86, 6, 66, 18, P['blue'])
rect(cx - 85, 7, int(64 * 0.45), 16, P['blue'], 0.35)
text(cx - 82, 12, 'BLEU', P['blue'])
text(cx - 50, 12, '45%', P['hud'])
panel(cx + 20, 6, 66, 18)
rect(cx + 86 - 1 - int(64 * 0.12), 7, int(64 * 0.12), 16, P['red'], 0.3)
text(cx + 24, 12, '12%', P['hud'])
text(cx + 52, 12, 'ROUGE', P['red'])
for y in range(-12, 13):
    for x in range(-12, 13):
        d = math.hypot(x, y)
        if d <= 9:
            put(cx + x, 15 + y, P['blue'] if d < 8 else P['ink'])
        elif d <= 12:
            ang = (math.atan2(y, x) + math.pi / 2) % (2 * math.pi)
            put(cx + x, 15 + y, P['red'] if ang < 0.32 * 2 * math.pi and d > 10 else P['ink'])
for y in range(-4, 5):
    for x in range(-4, 5):
        if abs(x) + abs(y) <= 4:
            put(cx + x, 15 + y, P['ink'])
for i, col in enumerate([P['blue'], hexc('#2c313c')]):
    rect(cx - 30 - i * 7, 27, 4, 4, col)
for i in range(2):
    rect(cx + 26 + i * 7, 27, 4, 4, hexc('#2c313c'))
text(cx - text_w('MANCHE 2') // 2, 31, 'MANCHE 2', P['hudDim'])

# Fil des éliminations
panel(W - 78, 6, 72, 12)
x = text(W - 74, 9, 'NOVA', P['blue'])
x = text(x + 2, 9, 'X', P['hudDim'])
text(x + 2, 9, 'ROOK', P['red'])

# PV (bas gauche)
text(10, 234, 'FLUX', P['orange'])
text(10, 244, '136', P['hud'], 2)
text(48, 251, '/175', P['hudDim'])
for i in range(7):
    x0 = 10 + i * 11
    fill = max(0, min(1, (136 - i * 25) / 25))
    rect(x0, 262, 10, 4, hexc('#2c313c'))
    rect(x0, 262, int(10 * fill), 4, P['hud'])

# Compétences (bas centre)
def slot(x, y, col, label, icon):
    panel(x, y, 22, 22, col)
    icon(x + 11, y + 11, col)
    text(x + 11 - text_w(label) // 2, y - 9, label, P['hud'])

def icon_blink(cx, cy, col):
    for k in (-4, 2):
        for i in range(-4, 5):
            put(cx + k + (4 - abs(i)) // 1 - 2, cy + i, col)
            put(cx + k + (4 - abs(i)) // 1 - 1, cy + i, col)

def icon_recall(cx, cy, col):
    for a in range(0, 300, 6):
        r = math.radians(a - 60)
        put(cx + math.cos(r) * 6, cy + math.sin(r) * 6, col)
    rect(cx, cy - 4, 1, 5, col)
    rect(cx, cy, 3, 1, col)

slot(W // 2 - 34, 238, P['orange'], 'CLIC D', icon_blink)
for i in range(3):
    rect(W // 2 - 34 + i * 8, 262, 6, 2, P['orange'] if i < 2 else hexc('#2c313c'))
slot(W // 2 + 12, 238, P['cyan'], 'ESPACE', icon_recall)

# Munitions (bas droite)
text(W - 64, 238, '32', P['hud'], 2)
text(W - 38, 245, '/40', P['hudDim'])
for i in range(40):
    rect(W - 92 + i * 2, 262, 1, 4, P['bullet'] if i < 32 else hexc('#2c313c'))

# Viseur sur le bouclier
ch = (300, 112)
for a in range(0, 360, 20):
    r = math.radians(a)
    put(ch[0] + math.cos(r) * 5, ch[1] + math.sin(r) * 5, P['white'])
put(ch[0], ch[1], P['white'])

# ------------------------------------------------------------------ export PNG (x4, sans lissage)
def write_png(path):
    rows = []
    for y in range(H):
        line = bytearray()
        for x in range(W):
            line += bytes(img[y][x]) * SCALE
        for _ in range(SCALE):
            rows.append(b'\x00' + bytes(line))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', W * SCALE, H * SCALE, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


write_png(OUT)
print('ok', OUT)
