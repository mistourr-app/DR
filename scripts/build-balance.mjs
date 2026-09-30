// Generates balance.generated.js from balance.csv.
//
// balance.csv is the only place balance numbers live. This script turns it into
// a plain data module that registry.js re-exports, so no tunable is hardcoded
// anywhere else. Mirrors the styles.css pipeline: the generated file is
// committed and CI fails if it drifts from the CSV.
//
//   npm run build:balance   regenerate the module
//   npm run balance:check   verify the module matches the CSV
//
// Flags:
//   --check   do not write, exit 1 if the file on disk is stale
//   --print   also dump the resolved strength curve per dungeon

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSV_PATH = path.resolve('balance.csv');
const OUTPUT_PATH = path.resolve('balance.generated.js');

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)$/;

export function parseBalanceCsv(text) {
  const data = {};
  const seen = new Set();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;

    const columns = splitCsvLine(line);
    const [rawPath, rawValue, notes = ''] = columns;

    if (!rawPath) {
      throw new Error(`balance.csv line ${index + 1}: missing path`);
    }
    if (rawValue === undefined) {
      throw new Error(`balance.csv line ${index + 1}: missing value for "${rawPath}"`);
    }
    if (seen.has(rawPath)) {
      throw new Error(`balance.csv line ${index + 1}: duplicate path "${rawPath}"`);
    }
    seen.add(rawPath);

    const value = NUMERIC.test(rawValue.trim()) ? Number(rawValue.trim()) : rawValue;
    assign(data, rawPath.split('.'), value);

    if (notes.includes(',')) {
      throw new Error(`balance.csv line ${index + 1}: notes must not contain a comma`);
    }
  });

  return data;
}

// Notes are the third column, so commas only ever appear inside the notes of a
// quoted field. Keeps hand editing forgiving.
function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(',').map(column => column.trim());

  const columns = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === ',' && !quoted) {
      columns.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  columns.push(current.trim());
  return columns;
}

function assign(target, segments, value) {
  let node = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextIsIndex = /^\d+$/.test(segments[index + 1]);

    if (nextIsIndex) {
      if (!Array.isArray(node[segment])) node[segment] = [];
    } else if (typeof node[segment] !== 'object' || node[segment] === null || Array.isArray(node[segment])) {
      node[segment] = {};
    }

    node = node[segment];
  }

  node[segments[segments.length - 1]] = value;
}

export function validateBalance(data) {
  const errors = [];

  const shape = data.enemyWindow?.shape;
  if (!Array.isArray(shape) || shape.length < 2) {
    errors.push('enemyWindow.shape needs at least two entries');
  } else {
    const total = shape.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 1) > 1e-9) errors.push(`enemyWindow.shape sums to ${total}, expected 1`);
    if (shape.some(weight => weight <= 0)) errors.push('enemyWindow.shape must be strictly positive');
  }

  const floor = data.enemyWindow?.floor;
  if (!floor || typeof floor.from !== 'number' || typeof floor.to !== 'number') {
    errors.push('enemyWindow.floor needs numeric from and to');
  } else if (floor.to <= floor.from) {
    errors.push('enemyWindow.floor.to must be greater than from so the window climbs');
  }

  const enemyTypes = Object.keys(data.enemies || {});
  if (enemyTypes.length === 0) errors.push('no enemies defined');

  enemyTypes.forEach((enemyType) => {
    const def = data.enemies[enemyType];
    ['label', 'hp', 'visionRange', 'color', 'weight'].forEach((field) => {
      if (def[field] === undefined) errors.push(`enemies.${enemyType}.${field} is missing`);
    });

    // Every numeric field must be a real number. Comparing against NaN silently
    // passes, so check explicitly instead of relying on arithmetic.
    ['hp', 'visionRange', 'weight'].forEach((field) => {
      if (typeof def[field] !== 'number' || !Number.isFinite(def[field])) {
        errors.push(`enemies.${enemyType}.${field} must be a finite number, got ${JSON.stringify(def[field])}`);
      }
    });

    if (def.hp <= 0) errors.push(`enemies.${enemyType}.hp must be positive`);
    if (def.visionRange < 1) errors.push(`enemies.${enemyType}.visionRange must be at least 1`);
    if (def.weight <= 0) errors.push(`enemies.${enemyType}.weight must be positive`);
  });

  Object.entries(data.cells || {}).forEach(([cell, def]) => {
    if (!def.label) errors.push(`cells.${cell}.label is missing`);
    if (!def.color) errors.push(`cells.${cell}.color is missing`);
    ['value', 'amount'].forEach((field) => {
      if (def[field] === undefined) return;
      if (typeof def[field] !== 'number' && typeof def[field] !== 'string') {
        errors.push(`cells.${cell}.${field} must be a number or a string`);
      }
    });
  });

  Object.entries(data.campaign?.rows || {}).forEach(([edge, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`campaign.rows.${edge} must be a number`);
  });

  ['hp', 'energy', 'ammo', 'debugAmmo'].forEach((field) => {
    const value = data.player?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`player.${field} must be a positive number`);
    }
  });

  ['damage', 'range'].forEach((field) => {
    const value = data.player?.weapon?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`player.weapon.${field} must be a positive number`);
    }
  });

  const chances = data.campaign?.chances || {};
  Object.entries(chances).forEach(([key, range]) => {
    if (typeof range?.from !== 'number' || typeof range?.to !== 'number') {
      errors.push(`campaign.chances.${key} needs numeric from and to`);
      return;
    }
    if (range.from < 0 || range.to < 0) errors.push(`campaign.chances.${key} cannot be negative`);
    if (range.from > 1 || range.to > 1) errors.push(`campaign.chances.${key} must stay within 0..1`);
  });

  const spawnBudget = Object.values(chances).reduce((sum, range) => sum + range.to, 0);
  if (spawnBudget > 1.000001) errors.push(`chances at the last dungeon sum to ${spawnBudget}, the budget is 1`);

  if (!(data.cells?.GOLD?.amount > 0)) errors.push('cells.GOLD.amount must be positive');

  const upgradeKeys = Object.keys(data.upgrades || {});
  if (upgradeKeys.length === 0) errors.push('no player upgrades defined');

  upgradeKeys.forEach((key) => {
    const def = data.upgrades[key];

    if (!def.label) errors.push(`upgrades.${key}.label is missing`);

    ['effect', 'base', 'step'].forEach((field) => {
      if (typeof def[field] !== 'number' || !Number.isFinite(def[field])) {
        errors.push(`upgrades.${key}.${field} must be a finite number, got ${JSON.stringify(def[field])}`);
      }
    });

    if (def.effect <= 0) errors.push(`upgrades.${key}.effect must be positive`);
    if (def.base < 0) errors.push(`upgrades.${key}.base cannot be negative`);
    if (def.step < 0) errors.push(`upgrades.${key}.step cannot be negative`);

    // A track whose first level is free or negative is dead on arrival.
    if (def.base <= 0 && def.step <= 0) {
      errors.push(`upgrades.${key} can never be bought: first level would cost ${def.base}`);
    }
  });

  // Sanity check the economy: an untouched player has to be able to afford the
  // cheapest track within the first dungeon, otherwise nothing opens up.
  const cheapestFirst = Math.min(...upgradeKeys.map(key => data.upgrades[key].base));
  const goldPerCell = data.cells?.GOLD?.amount;
  const firstDungeonCells = ((data.campaign?.rows?.from ?? 0) - 3) * 5;
  const firstDungeonGold = firstDungeonCells * (chances.GOLD?.to ?? 0) * (goldPerCell ?? 0);

  if (upgradeKeys.length > 0 && cheapestFirst > firstDungeonGold) {
    errors.push(`cheapest upgrade costs ${cheapestFirst} but dungeon 1 yields about ${Math.round(firstDungeonGold)}`);
  }

  const arena = data.arena;
  if (!arena) {
    errors.push('arena is missing');
    return errors;
  }

  ['hpLowThreshold', 'hpHighThreshold'].forEach((field) => {
    if (typeof arena[field] !== 'number' || !Number.isFinite(arena[field])) {
      errors.push(`arena.${field} must be a finite number`);
    }
  });

  if (!(arena.hpLowThreshold < arena.hpHighThreshold)) {
    errors.push('arena.hpLowThreshold must be below arena.hpHighThreshold');
  }

  ['ammo', 'energy'].forEach((field) => {
    if (!Number.isInteger(arena.supply?.[field]) || arena.supply[field] < 0) {
      errors.push(`arena.supply.${field} must be a non negative integer`);
    }
  });

  Object.entries(arena.chances || {}).forEach(([type, entry]) => {
    ['base', 'hpLow', 'hpHigh', 'playerRow'].forEach((field) => {
      if (entry[field] === undefined) return;
      if (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]) || entry[field] < 0) {
        errors.push(`arena.chances.${type}.${field} must be a non negative number`);
      }
    });

    // Bolts and energy exist on the player row only, so playerRow replaces base
    // for them. Everything else must have a base weight for the elder row.
    const hasBase = typeof entry.base === 'number';
    const hasPlayerRowOnly = typeof entry.playerRow === 'number' && entry.base === undefined;
    if (!hasBase && !hasPlayerRowOnly) errors.push(`arena.chances.${type}.base is required`);
  });

  // The player row has to restock itself, otherwise the Elder fight runs dry.
  ['AMMO', 'ENERGY'].forEach((type) => {
    const rate = arena.chances?.[type]?.playerRow;
    if (typeof rate !== 'number' || rate <= 0) {
      errors.push(`arena.chances.${type}.playerRow must be positive, the player needs a lifeline`);
    }
  });

  if (!(arena.attackCellDamage?.min > 0)) errors.push('arena.attackCellDamage.min must be positive');
  if (!(arena.attackCellDamage?.max >= arena.attackCellDamage?.min)) {
    errors.push('arena.attackCellDamage.max must be at least min');
  }

  return errors;
}

export function renderModule(data) {
  const body = JSON.stringify(data, null, 2);

  return `// GENERATED FILE - DO NOT EDIT.
//
// Source: balance.csv
// Regenerate: npm run build:balance
// Verify:     npm run balance:check
//
// Every tunable in the game is defined in balance.csv. This module is the
// machine readable form of it and is committed so that the game and the tests
// never need a build step.

export const BALANCE = ${body};

export default BALANCE;
`;
}

// Builds the strength table for one enemy type on one level of progress.
// Kept here so `npm run balance:check --print` can show the real curve using
// the same maths the game uses.
export function resolveStrengthTable(window, baseHp, progress) {
  const floor = window.floor.from + (window.floor.to - window.floor.from) * progress;
  const lowest = Math.floor(floor);
  const blend = floor - lowest;
  const [weakest, middle, strongest] = window.shape;

  const shares = new Map();
  const add = (offset, weight) => {
    if (weight <= 0) return;
    shares.set(offset, (shares.get(offset) || 0) + weight);
  };

  add(lowest, (1 - blend) * weakest);
  add(lowest + 1, (1 - blend) * middle + blend * weakest);
  add(lowest + 2, (1 - blend) * strongest + blend * middle);
  add(lowest + 3, blend * strongest);

  const total = [...shares.values()].reduce((sum, weight) => sum + weight, 0);
  return [...shares.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, weight]) => ({ hp: baseHp + offset, weight: Math.round((weight / total) * 10000) / 10000 }))
    .filter(tier => tier.weight > 0);
}

function printCurve(data) {
  const total = data.campaign.total;
  const lastIndex = Math.max(1, total - 1);

  console.log('strength window per dungeon (hp:share)');
  Object.entries(data.enemies).forEach(([enemyType, def]) => {
    console.log(`\n  ${enemyType} ${def.label} (base ${def.hp})`);
    for (let index = 0; index < total; index += 1) {
      const progress = index / lastIndex;
      const table = resolveStrengthTable(data.enemyWindow, def.hp, progress);
      const mean = table.reduce((sum, tier) => sum + tier.hp * tier.weight, 0);
      const rendered = table.map(tier => `${tier.hp}:${tier.weight.toFixed(2)}`).join(' ');
      console.log(`    D${String(index + 1).padStart(2)}  ${rendered.padEnd(34)} mean ${mean.toFixed(1)}`);
    }
  });
}

async function main() {
  const check = process.argv.includes('--check');
  const show = process.argv.includes('--print');

  const csv = await readFile(CSV_PATH, 'utf8');
  const data = parseBalanceCsv(csv);
  const errors = validateBalance(data);

  if (errors.length > 0) {
    console.error('balance.csv is not valid:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exitCode = 1;
    return;
  }

  const expected = renderModule(data);
  const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => null);

  if (check) {
    if (current !== expected) {
      console.error(`${path.basename(OUTPUT_PATH)} is out of date with balance.csv.`);
      console.error('Run: npm run build:balance');
      process.exitCode = 1;
      return;
    }
    console.log(`${path.basename(OUTPUT_PATH)} is in sync with balance.csv`);
  } else if (current !== expected) {
    await writeFile(OUTPUT_PATH, expected, 'utf8');
    console.log(`wrote ${path.basename(OUTPUT_PATH)} from balance.csv`);
  } else {
    console.log(`${path.basename(OUTPUT_PATH)} already up to date`);
  }

  if (show) printCurve(data);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
