import { OBJECT_TYPES, CELL_DEFS, ARENA_DEFS } from './registry.js';

const RANDOM_MODULUS = 233280;

export function createPRNG(seed = Date.now()) {
  const numericSeed = Number(seed);
  let state = Number.isFinite(numericSeed) ? Math.trunc(numericSeed) : Date.now();
  state = ((state % RANDOM_MODULUS) + RANDOM_MODULUS) % RANDOM_MODULUS;

  return function() {
    state = ((Math.imul(state, 9301) + 49297) % RANDOM_MODULUS + RANDOM_MODULUS) % RANDOM_MODULUS;
    return state / RANDOM_MODULUS;
  };
}

// Counts cells of a type in an arena row, skipping the cell that is about to be
// replaced so a supply does not count itself.
function countRowType(rowCells, type, exceptX = -1) {
  if (!Array.isArray(rowCells)) return 0;

  let count = 0;
  for (let index = 0; index < rowCells.length; index += 1) {
    if (index === exceptX) continue;
    if (rowCells[index]?.type === type) count += 1;
  }

  return count;
}

// Returns the type the player row is short of, or null when it is stocked.
// Forcing the scarcer of the two keeps the row alternating toward the floor
// without any extra state, so a seeded run stays reproducible.
export function resolveArenaSupply(rowCells, exceptX = -1) {
  const ammo = countRowType(rowCells, OBJECT_TYPES.AMMO, exceptX);
  const energy = countRowType(rowCells, OBJECT_TYPES.ENERGY, exceptX);
  const needAmmo = ammo < ARENA_DEFS.supply.ammo;
  const needEnergy = energy < ARENA_DEFS.supply.energy;

  if (!needAmmo && !needEnergy) return null;
  if (needAmmo && needEnergy) return ammo <= energy ? OBJECT_TYPES.AMMO : OBJECT_TYPES.ENERGY;
  return needAmmo ? OBJECT_TYPES.AMMO : OBJECT_TYPES.ENERGY;
}

function buildArenaData(type, randomValue) {
  if (type === OBJECT_TYPES.ATTACK_BONUS || type === OBJECT_TYPES.DEFENSE_BONUS) {
    return { value: CELL_DEFS[type].value };
  }

  if (type === OBJECT_TYPES.ATTACK_CELL) {
    const { min, max } = ARENA_DEFS.attackCellDamage;
    return { value: Math.floor(randomValue() * (max - min + 1)) + min };
  }

  return null;
}

// Builds the chance table for one arena cell. Entries are relative and get
// normalised, so they never have to add up to 1.
//
// Keys come back as OBJECT_TYPES values, so the table has exactly one entry per
// spawnable type. A weight that is missing or not a positive number is skipped:
// a single NaN would poison the cumulative sum and silently turn every cell into
// the fallback type.
function arenaChances(isPlayerRow, hpPercent) {
  const table = ARENA_DEFS.chances;
  const chances = {};

  Object.keys(table).forEach((entryName) => {
    const type = OBJECT_TYPES[entryName];
    if (!type) return;

    const entry = table[entryName];
    let weight;

    if (entry.playerRow !== undefined) {
      // A player row only entry, never offered on the elder row.
      if (!isPlayerRow) return;
      weight = entry.playerRow;
    } else if (hpPercent < ARENA_DEFS.hpLowThreshold) {
      weight = entry.hpLow ?? entry.base;
    } else if (hpPercent > ARENA_DEFS.hpHighThreshold) {
      weight = entry.hpHigh ?? entry.base;
    } else {
      weight = entry.base;
    }

    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return;
    chances[type] = weight;
  });

  return chances;
}

/**
 * Rolls one object for the Elder hall.
 * @param {object} [context] - `{ rowCells }` lets the supply floor look at the
 *   cells already placed in this row so the player's row never runs dry.
 */
export function generateArenaObject(x, y, totalRows, random, hpPercent = 1.0, context = {}) {
  const isPlayerRow = y === totalRows - 2;
  const randomValue = typeof random === 'function' ? random : createPRNG(x * 1000 + y * 17 + totalRows);

  if (isPlayerRow) {
    const forced = resolveArenaSupply(context.rowCells, x);
    if (forced) return { type: forced, data: buildArenaData(forced, randomValue) };
  }

  const chances = arenaChances(isPlayerRow, hpPercent);
  const totalChance = Object.values(chances).reduce((sum, chance) => sum + chance, 0);
  const normalizedChances = {};
  for (const key in chances) {
    normalizedChances[key] = chances[key] / totalChance;
  }

  const rand = randomValue();
  let cumulativeChance = 0;

  for (const key in normalizedChances) {
    if (rand < (cumulativeChance += normalizedChances[key])) {
      // The table is already keyed by OBJECT_TYPES values, so no second lookup.
      return { type: key, data: buildArenaData(key, randomValue) };
    }
  }

  const fallbackType = OBJECT_TYPES.ATTACK_CELL;
  return { type: fallbackType, data: buildArenaData(fallbackType, randomValue) };
}

export function spawnArenaObject(cell, x, y, totalRows, hpPercent = 1.0, random = null, rows = null) {
  const prevType = cell.type;
  const randomValue = typeof random === 'function'
    ? random
    : createPRNG(x * 1000 + y * 17 + totalRows);

  // The replaced cell still holds its old type, so the supply floor has to look
  // at the row and skip it.
  const rowCells = Array.isArray(rows) ? rows[y] : null;
  const { type, data } = generateArenaObject(x, y, totalRows, randomValue, hpPercent, { rowCells });

  cell.type = type;
  cell.data = data;
  cell.visual.alpha = 1.0;
  cell.isAnimating = false;
  console.log(`[SPAWN] (${x},${y}) ${prevType} → ${type}`, data);
}
