// Draws the WARDEN (enemy.type-3) sprite set from code.
//
// No image-generation dependency: geometry is filled into a Canvas by
// scripts/encode-png.mjs and written as RGBA PNGs. That keeps generation
// reproducible from a bare `npm ci` and reviewable in a diff.
//
//   npm run gen:sprites   write the PNGs
//   npm run gen:sprites -- --check   verify they match the manifest
//
// The files are committed, like styles.css and balance.generated.js, and
// CI fails if they drift from what this script produces.
//
// Set enabled=false on any entry in assets/manifest.json to fall back to the
// procedural drawing; the loader skips missing or disabled assets.
//
// Known limitation: the game only ever drives `idle` on enemy cells today
// (run.js never writes visual.state for enemies), so alert/attack/damaged/death
// sit unused until enemy animations are wired up. They are generated and
// checked now so the set is complete when that happens.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from './encode-png.mjs';

const SIZE = 96;
const MANIFEST_PATH = path.resolve('assets/manifest.json');

const STATES = ['idle', 'alert', 'attack', 'damaged', 'death'];

// Dark palette, cold steel with a lantern-lit visor. The ARCANIST is violet and
// the SPEARMAN is warm; WARDEN gets the desaturated blue-grey that reads as heavy.
const PALETTE = {
  armour: [58, 68, 84],
  armourLit: [86, 100, 122],
  armourShade: [32, 38, 48],
  edge: [124, 142, 168],
  visor: [255, 206, 122],
  visorCore: [255, 245, 214],
  wound: [196, 64, 52],
  shadow: [14, 16, 22],
};

function drawShadow(canvas, cx, groundY, halfWidth) {
  canvas.fillEllipse(cx, groundY, halfWidth, halfWidth * 0.26, PALETTE.shadow, 0.42);
}

// Vertical bands, measured from the ground up. Keeping them in one place is what
// stops the helm from being swallowed by the pauldrons: the helm owns its own
// rows above the shoulder line instead of overlapping them.
const LAYOUT = {
  feetY: 93,      // bottom of the boots; anchor is [0.5, 1] so this is the foot line
  legTopY: 74,
  skirtTopY: 58,
  torsoTopY: 30,
  shoulderY: 32,
  helmTopY: 5,
  helmBotY: 25,
};

// Broad-shouldered armoured figure. Each band is drawn separately top-down so
// the silhouette stays legible at cell size: helm, shoulders, torso, skirt, legs.
function drawBody(canvas, { cx, scale = 1, lean = 0 }) {
  const s = scale;
  const feet = LAYOUT.feetY;

  // Shear the whole figure with `lean`: x offset grows toward the top, so the
  // pose reads as a body tipping rather than a sprite sliding sideways.
  const shear = (y) => lean * (feet - y) * 0.16;

  const shoulderY = LAYOUT.shoulderY;
  const helmTop = LAYOUT.helmTopY;

  const torsoW = 40 * s;
  const torsoH = shoulderY - feet + LAYOUT.skirtTopY - LAYOUT.shoulderY + 28 * s;

  // Torso: wide at the chest, tapering to the belt.
  const torsoBottom = feet - (feet - LAYOUT.skirtTopY);
  for (let i = 0; i <= torsoBottom - shoulderY; i += 1) {
    const y = shoulderY + i;
    const t = i / Math.max(1, torsoBottom - shoulderY);
    const width = torsoW * (1 - 0.2 * t);
    canvas.fillRect(cx - width / 2 + shear(y), y, width, 1, PALETTE.armour, 1);
  }

  // Lit left edge and a shaded right third give the plate a readable direction.
  for (let i = 0; i <= torsoBottom - shoulderY; i += 1) {
    const y = shoulderY + i;
    const t = i / Math.max(1, torsoBottom - shoulderY);
    const width = torsoW * (1 - 0.2 * t);
    const x = cx - width / 2 + shear(y);
    canvas.fillRect(x, y, 2 * s, 1, PALETTE.edge, 0.55);
    canvas.fillRect(x + width * 0.7, y, width * 0.3, 1, PALETTE.armourShade, 0.6);
  }

  // Pauldrons sit ON the shoulder line, flanking the helm rather than under it.
  const shoulderHalf = torsoW * 0.5 + 4 * s;
  for (const side of [-1, 1]) {
    const px = cx + side * shoulderHalf + shear(shoulderY);
    canvas.fillEllipse(px, shoulderY + 2 * s, 12 * s, 9 * s, PALETTE.armourLit, 1);
    canvas.fillEllipse(px - side * 3 * s, shoulderY, 7 * s, 4 * s, PALETTE.edge, 0.45);
  }

  // Belt, then the plate skirt below it.
  const beltY = torsoBottom - 3 * s;
  canvas.fillRect(cx - torsoW * 0.44 + shear(beltY), beltY, torsoW * 0.88, 4 * s, PALETTE.armourShade, 1);
  canvas.fillRect(cx - torsoW * 0.44 + shear(beltY), beltY, 3 * s, 4 * s, PALETTE.edge, 0.45);

  const skirtH = Math.max(1, feet - beltY - 8 * s);
  for (let i = 0; i < skirtH; i += 1) {
    const y = beltY + 4 * s + i;
    const t = i / skirtH;
    const width = torsoW * (0.8 + 0.12 * t);
    canvas.fillRect(cx - width / 2 + shear(y), y, width, 1, i % 7 < 4 ? PALETTE.armour : PALETTE.armourShade, 1);
  }

  // Boots: two blocks with a gap, so the figure stands rather than floats.
  const legY = LAYOUT.legTopY + (feet - LAYOUT.feetY) * 0;
  const legH = Math.max(3, feet - Math.min(feet, legY) - 1);
  for (const side of [-1, 1]) {
    const lx = cx + side * 9 * s + shear(feet) * 0.5;
    canvas.fillRect(lx - 5 * s, feet - legH, 10 * s, legH, PALETTE.armourShade, 1);
    canvas.fillRect(lx - 7 * s, feet - 3 * s, 14 * s, 3 * s, PALETTE.shadow, 1);
  }

  return { shoulderY, torsoBottom, beltY, helmTop, feet, shear };
}

function drawHelm(canvas, { cx, helmTop, scale, lean, glow = 1 }) {
  const s = scale;
  const helmW = 26 * s;
  const helmH = LAYOUT.helmBotY - LAYOUT.helmTopY;
  const hx = cx + lean * 16 * s;
  const hy = helmTop + helmH / 2;

  canvas.fillEllipse(hx, hy, helmW / 2, helmH / 2, PALETTE.armourLit, 1);
  canvas.fillEllipse(hx - helmW * 0.14, hy - helmH * 0.1, helmW * 0.32, helmH * 0.34, PALETTE.edge, 0.4);
  canvas.fillRect(hx - helmW * 0.5, hy + helmH * 0.12, helmW, helmH * 0.26, PALETTE.armourShade, 0.5);

  // Crest ridge along the top of the skull.
  canvas.fillRect(hx - 2 * s, helmTop - 3 * s, 4 * s, 7 * s, PALETTE.armour, 1);
  canvas.fillRect(hx - 1 * s, helmTop - 3 * s, 2 * s, 7 * s, PALETTE.edge, 0.5);

  // Visor slit: the one bright note, the only warm colour on the sprite.
  const slitY = hy + helmH * 0.16;
  canvas.fillRect(hx - helmW * 0.36, slitY - 1, helmW * 0.72, 4 * s, PALETTE.shadow, 1);
  canvas.fillRect(hx - helmW * 0.28, slitY, helmW * 0.56, 2 * s, PALETTE.visor, glow);
  canvas.fillRect(hx - helmW * 0.1, slitY, helmW * 0.2, 2 * s, PALETTE.visorCore, glow);

  return { hx, slitY, helmW, helmH };
}

function drawArm(canvas, { x, y, angle, length, colour = PALETTE.armour, width = 7 }) {
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  const steps = Math.ceil(length);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const px = x + dx * t;
    const py = y + dy * t;
    canvas.fillCircle(px, py, width / 2, i === steps ? PALETTE.armourLit : colour, 1);
  }
}

function drawWarden(state) {
  const canvas = new Canvas(SIZE, SIZE);
  const cx = SIZE / 2;

  if (state === 'death') {
    // Fallen sideways. This pose does not reuse drawBody: collapsing the standing
    // proportions left the helm detached and floating, so the shape is drawn as
    // a horizontal mass lying on the ground with the helm at one end.
    const ground = LAYOUT.feetY;
    canvas.fillEllipse(cx, ground - 1, 31, 7.5, PALETTE.shadow, 0.45);

    // Torso lying on its side, with the plate skirt creased across it.
    canvas.fillEllipse(cx - 2, ground - 10, 25, 9.5, PALETTE.armour, 1);
    canvas.fillEllipse(cx - 8, ground - 13, 15, 6, PALETTE.edge, 0.35);
    canvas.fillEllipse(cx + 12, ground - 8, 14, 6, PALETTE.armourShade, 0.5);
    for (let i = 0; i < 5; i += 1) {
      canvas.fillRect(cx - 18 + i * 8, ground - 15 + i, 2.4, 12, PALETTE.armourShade, 0.7);
    }

    // Helm at the left end, visor dark and cracked open.
    const hx = cx - 24;
    const hy = ground - 11;
    canvas.fillEllipse(hx, hy, 12, 10, PALETTE.armourLit, 1);
    canvas.fillEllipse(hx - 3, hy - 3, 7, 5, PALETTE.edge, 0.4);
    canvas.fillRect(hx - 2, hy - 12, 4, 5, PALETTE.armour, 1);
    canvas.fillRect(hx - 10, hy - 1, 20, 5, PALETTE.shadow, 0.95);
    canvas.fillRect(hx - 4, hy - 2, 4, 2.4, PALETTE.armourShade, 0.85);

    // The pauldron that took the impact, catching the last light.
    canvas.fillEllipse(cx + 22, ground - 13, 10, 7, PALETTE.armourLit, 0.9);
    canvas.fillEllipse(cx + 24, ground - 15, 5.5, 3, PALETTE.edge, 0.5);

    // One arm flung clear, and a boot left in the dirt.
    drawArm(canvas, {
      x: cx + 14,
      y: ground - 9,
      angle: 0.28,
      length: 17,
      colour: PALETTE.armourShade,
      width: 7,
    });
    canvas.fillCircle(cx + 14 + Math.cos(0.28) * 17, ground - 9 + Math.sin(0.28) * 17, 6.5, PALETTE.armour, 1);
    canvas.fillRect(cx - 30, ground - 6, 11, 5, PALETTE.shadow, 1);
    canvas.fillRect(cx - 30, ground - 6, 11, 2, PALETTE.armourShade, 0.6);
    return canvas;
  }

  const lean = state === 'attack' ? 0.8 : state === 'alert' ? -0.3 : 0;
  const s = 1;

  // Motion smear trailing the swing, drawn before the body so it sits behind it.
  if (state === 'attack') {
    for (let i = 0; i < 8; i += 1) {
      const a = -1.0 + i * 0.07;
      drawArm(canvas, {
        x: cx - 14,
        y: LAYOUT.shoulderY + 12,
        angle: a,
        length: 38 - i * 1.6,
        colour: PALETTE.armourShade,
        width: 7 - i * 0.5,
      });
    }
  }

  drawShadow(canvas, cx, LAYOUT.feetY, state === 'attack' ? 20 : 17);

  const body = drawBody(canvas, { cx, lean });

  // Arms hang off the shoulder line. WARDEN keeps both arms low and heavy,
  // except when alerting or swinging.
  const shoulderHalf = 40 * s * 0.5 + 4 * s;
  if (state === 'alert') {
    for (const side of [-1, 1]) {
      drawArm(canvas, {
        x: cx + side * (shoulderHalf - 3),
        y: LAYOUT.shoulderY + 4,
        angle: side > 0 ? 0.5 : Math.PI - 0.5,
        length: 26,
        width: 8,
      });
      // Raised fists catch the light, which is what makes "alert" readable.
      canvas.fillCircle(cx + side * (shoulderHalf + 9), LAYOUT.shoulderY - 4, 7, PALETTE.armourLit, 1);
    }
  } else if (state === 'attack') {
    drawArm(canvas, {
      x: cx + shoulderHalf - 3,
      y: LAYOUT.shoulderY + 5,
      angle: -0.12,
      length: 30,
      width: 9,
    });
    drawArm(canvas, {
      x: cx - shoulderHalf + 3,
      y: LAYOUT.shoulderY + 5,
      angle: Math.PI / 2 + 0.2,
      length: 22,
      width: 8,
    });
  } else {
    for (const side of [-1, 1]) {
      const ax = cx + side * (shoulderHalf - 2);
      drawArm(canvas, {
        x: ax,
        y: LAYOUT.shoulderY + 4,
        angle: Math.PI / 2 + side * 0.14,
        length: 30,
        width: 8,
      });
      canvas.fillCircle(ax + side * 1.5, LAYOUT.shoulderY + 34, 7, PALETTE.armourShade, 1);
    }
  }

  drawHelm(canvas, { cx, helmTop: body.helmTop, scale: s, lean, glow: state === 'alert' ? 1 : 0.85 });

  if (state === 'attack') {
    // Contact arc thrown ahead of the helm.
    const arcX = cx + 30 + lean * 10;
    const arcY = LAYOUT.shoulderY + 18;
    for (let i = 0; i < 16; i += 1) {
      const a = -1.1 + (i / 15) * 0.85;
      canvas.fillCircle(arcX + Math.cos(a) * 21, arcY + Math.sin(a) * 21, 1.8, PALETTE.edge, 0.8);
    }
  }

  if (state === 'damaged') {
    // Cracks across the chest plate, plus a hit burst on the near pauldron.
    const cracks = [
      [-10, -4, -6, 8], [-6, 8, -13, 18], [7, -6, 4, 6], [4, 6, 11, 16],
    ];
    for (const [x1, y1, x2, y2] of cracks) {
      const steps = 14;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const px = cx + x1 + (x2 - x1) * t + body.shear(LAYOUT.shoulderY + y1);
        const py = LAYOUT.shoulderY + y1 + (y2 - y1) * t;
        canvas.fillCircle(px, py, 0.9, PALETTE.wound, 0.85);
      }
    }
    const hitX = cx + shoulderHalf;
    const hitY = LAYOUT.shoulderY + 2;
    canvas.fillCircle(hitX, hitY, 3.6, PALETTE.wound, 0.95);
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      canvas.fillCircle(hitX + Math.cos(a) * 6.5, hitY + Math.sin(a) * 6.5, 1.2, PALETTE.wound, 0.6);
    }
  }

  return canvas;
}

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const manifest = await readManifest();
  const errors = [];

  for (const state of STATES) {
    const id = `enemy.type-3.${state}`;
    const entry = manifest.assets[id];
    if (!entry) throw new Error(`manifest has no entry for ${id}`);

    const [expectedW, expectedH] = entry.sourceSize;
    if (expectedW !== SIZE || expectedH !== SIZE) {
      errors.push(`${id}: manifest says ${expectedW}x${expectedH}, generator writes ${SIZE}x${SIZE}`);
      continue;
    }

    const png = drawWarden(state).toPng();
    // src is relative to the project root, matching the loader and server.js.
    const filePath = path.resolve(entry.src);

    if (checkOnly) {
      let onDisk = null;
      try {
        onDisk = await readFile(filePath);
      } catch {
        errors.push(`${id}: ${entry.src} is missing on disk`);
        continue;
      }
      if (!onDisk.equals(png)) {
        errors.push(`${id}: ${entry.src} differs from the generator output, run npm run gen:sprites`);
      }
      continue;
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, png);
    console.log(`wrote ${entry.src} (${png.length} bytes)`);
  }

  if (checkOnly) {
    if (errors.length > 0) {
      console.error('Sprite check failed:');
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`Sprite check passed: ${STATES.length} WARDEN sprites match the generator.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { drawWarden, SIZE };