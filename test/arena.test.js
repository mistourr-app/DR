import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECT_TYPES, ARENA_DEFS, CELL_DEFS } from '../registry.js';
import { generateArenaObject, spawnArenaObject, resolveArenaSupply, createPRNG } from '../utils.js';

const COLS = 5;
const TOTAL_ROWS = 12;
const PLAYER_ROW = TOTAL_ROWS - 2;
const ELDER_ROW = TOTAL_ROWS - 1;
const SPAWNABLE = new Set(Object.values(OBJECT_TYPES));

// Builds the arena the way startRun does: row by row, handing the partially
// built row in so the supply floor can see it.
function buildArena(hpPercent, seed) {
  const random = createPRNG(seed);
  const rows = [];

  for (let y = PLAYER_ROW; y < TOTAL_ROWS; y += 1) {
    const row = [];
    for (let x = 0; x < COLS; x += 1) {
      const object = generateArenaObject(x, y, TOTAL_ROWS, random, hpPercent, { rowCells: row });
      row.push({ type: object.type, data: object.data });
    }
    rows.push(row);
  }

  return rows;
}

function countType(row, type) {
  return row.filter(cell => cell.type === type).length;
}

const HP_BANDS = [1.0, 0.8, 0.6, 0.4, 0.2];

test('every arena cell rolls a real type', () => {
  // Regression guard: a single NaN in the cumulative sum silently turned every
  // cell into the fallback type, and a double converted key produced
  // undefined types. Both looked like "valid" output.
  [PLAYER_ROW, ELDER_ROW].forEach((y) => {
    HP_BANDS.forEach((hpPercent) => {
      for (let seed = 0; seed < 300; seed += 1) {
        const row = [];
        const random = createPRNG(seed * 7 + 1);

        for (let x = 0; x < COLS; x += 1) {
          const object = generateArenaObject(x, y, TOTAL_ROWS, random, hpPercent, { rowCells: row });
          assert.equal(
            SPAWNABLE.has(object.type),
            true,
            `seed ${seed} hp ${hpPercent} row ${y} cell ${x} produced ${JSON.stringify(object.type)}`,
          );
          assert.notEqual(object.type, OBJECT_TYPES.EMPTY, 'an arena cell is never empty');
          row.push({ type: object.type, data: object.data });
        }
      }
    });
  });
});

test('the arena is not only attack cells', () => {
  // The other half of the same regression: a broken table collapsed onto one type.
  const rows = buildArena(0.6, 12345);
  const distinct = new Set(rows.flat().map(cell => cell.type));

  assert.equal(distinct.size >= 4, true, `only saw ${[...distinct].join(', ')}`);
});

test('the player row always holds bolts and energy at fight start', () => {
  HP_BANDS.forEach((hpPercent) => {
    for (let seed = 0; seed < 400; seed += 1) {
      const [playerRow] = buildArena(hpPercent, 500 + seed);

      assert.equal(
        countType(playerRow, OBJECT_TYPES.AMMO) >= ARENA_DEFS.supply.ammo,
        true,
        `seed ${seed} hp ${hpPercent} had no bolts to start`,
      );
      assert.equal(
        countType(playerRow, OBJECT_TYPES.ENERGY) >= ARENA_DEFS.supply.energy,
        true,
        `seed ${seed} hp ${hpPercent} had no energy to start`,
      );
    }
  });
});

test('the player row keeps its lifeline while it is walked', () => {
  // The player consumes cells as they move and the row refills behind them, so
  // the floor has to hold over the whole fight, not just at the start.
  let lowestAmmo = Infinity;
  let lowestEnergy = Infinity;

  for (let seed = 0; seed < 200; seed += 1) {
    const [playerRow] = buildArena(0.6, 7000 + seed);

    for (let step = 0; step < COLS * 3; step += 1) {
      const x = step % COLS;
      const replacement = generateArenaObject(x, PLAYER_ROW, TOTAL_ROWS, createPRNG(step * 31 + seed), 0.6, { rowCells: playerRow });
      playerRow[x] = { type: replacement.type, data: replacement.data };

      lowestAmmo = Math.min(lowestAmmo, countType(playerRow, OBJECT_TYPES.AMMO));
      lowestEnergy = Math.min(lowestEnergy, countType(playerRow, OBJECT_TYPES.ENERGY));
    }
  }

  assert.equal(lowestAmmo >= ARENA_DEFS.supply.ammo, true, `row dropped to ${lowestAmmo} bolt cells`);
  assert.equal(lowestEnergy >= ARENA_DEFS.supply.energy, true, `row dropped to ${lowestEnergy} energy cells`);
});

test('bolts and energy never appear on the elder row', () => {
  for (let seed = 0; seed < 400; seed += 1) {
    const rows = buildArena(0.6, 900 + seed);
    const elderRow = rows[1];

    assert.equal(countType(elderRow, OBJECT_TYPES.AMMO), 0, `seed ${seed} leaked bolts`);
    assert.equal(countType(elderRow, OBJECT_TYPES.ENERGY), 0, `seed ${seed} leaked energy`);
  }
});

test('healing gets more likely as the player weakens', () => {
  const healRate = hpPercent => {
    let total = 0;
    const runs = 400;
    for (let seed = 0; seed < runs; seed += 1) {
      total += countType(buildArena(hpPercent, 1500 + seed)[0], OBJECT_TYPES.HEAL);
    }
    return total / runs;
  };

  const healthy = healRate(1.0);
  const wounded = healRate(ARENA_DEFS.hpLowThreshold - 0.1);

  assert.equal(wounded > healthy, true, `low hp ${wounded} should beat full hp ${healthy}`);
});

test('bonus stacks carry a value and attack cells roll within range', () => {
  const { min, max } = ARENA_DEFS.attackCellDamage;

  for (let seed = 0; seed < 300; seed += 1) {
    buildArena(0.6, 3000 + seed).flat().forEach((cell) => {
      if (cell.type === OBJECT_TYPES.ATTACK_BONUS || cell.type === OBJECT_TYPES.DEFENSE_BONUS) {
        assert.equal(Number.isFinite(cell.data?.value), true, 'bonus needs a value');
        assert.equal(cell.data.value >= 1, true, 'bonus value must be usable');
      }
      if (cell.type === OBJECT_TYPES.ATTACK_CELL) {
        const value = cell.data?.value;
        assert.equal(Number.isInteger(value), true, 'attack cell damage must be whole');
        assert.equal(value >= min && value <= max, true, `attack cell ${value} outside ${min}..${max}`);
      }
      if (cell.type === OBJECT_TYPES.AMMO || cell.type === OBJECT_TYPES.ENERGY) {
        assert.equal(cell.data, null, `${cell.type} carries no value, the run applies the resolved stat`);
      }
    });
  }
});

test('resolveArenaSupply targets the scarcer of the two', () => {
  const ammo = { type: OBJECT_TYPES.AMMO };
  const energy = { type: OBJECT_TYPES.ENERGY };

  assert.equal(resolveArenaSupply([], -1), OBJECT_TYPES.AMMO, 'empty row starts with bolts');
  assert.equal(resolveArenaSupply([ammo], -1), OBJECT_TYPES.ENERGY, 'energy is next when only bolts exist');
  assert.equal(resolveArenaSupply([ammo, energy], -1), null, 'a stocked row needs nothing');
  assert.equal(resolveArenaSupply([energy], -1), OBJECT_TYPES.AMMO, 'bolts are next when only energy exists');

  // The cell being replaced must not count as its own supply. Excluding the only
  // bolt leaves the row short of one, so bolts are still requested.
  assert.equal(resolveArenaSupply([ammo, energy], 0), OBJECT_TYPES.AMMO, 'the replaced bolt is excluded');
  assert.equal(resolveArenaSupply([ammo, energy], 1), OBJECT_TYPES.ENERGY, 'the replaced energy cell is excluded');

  // Missing row information must not crash or invent a supply.
  assert.equal(resolveArenaSupply(null, -1), OBJECT_TYPES.AMMO);
  assert.equal(resolveArenaSupply(undefined, -1), OBJECT_TYPES.AMMO);
});

test('spawnArenaObject restocks the row it writes into', () => {
  const rows = [];
  for (let y = 0; y < TOTAL_ROWS; y += 1) {
    const row = [];
    for (let x = 0; x < COLS; x += 1) {
      row.push({ type: OBJECT_TYPES.EMPTY, data: null, visual: {}, isAnimating: false });
    }
    rows.push(row);
  }

  const random = createPRNG(4242);

  // Strip the player's row down to nothing but one bolt cell, then force a
  // respawn of another cell and confirm the row got its energy back.
  for (let x = 0; x < COLS; x += 1) {
    rows[PLAYER_ROW][x] = { type: OBJECT_TYPES.EMPTY, data: null, visual: {}, isAnimating: false };
  }
  rows[PLAYER_ROW][0] = { type: OBJECT_TYPES.AMMO, data: null, visual: {}, isAnimating: false };

  spawnArenaObject(rows[PLAYER_ROW][1], 1, PLAYER_ROW, TOTAL_ROWS, 0.6, random, rows);
  assert.equal(
    countType(rows[PLAYER_ROW], OBJECT_TYPES.ENERGY) >= ARENA_DEFS.supply.energy,
    true,
    'the vacated cell should have been refilled with the missing supply',
  );

  // The elder row is not protected and must stay free of ammo.
  spawnArenaObject(rows[ELDER_ROW][0], 0, ELDER_ROW, TOTAL_ROWS, 0.6, random, rows);
  assert.equal(countType(rows[ELDER_ROW], OBJECT_TYPES.AMMO), 0);
  assert.equal(countType(rows[ELDER_ROW], OBJECT_TYPES.ENERGY), 0);
});

test('arena payload lives in balance.csv, not in code', async () => {
  const source = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../utils.js', import.meta.url), 'utf8'),
  );

  // The Elder hall tuning must stay in the CSV so it can be changed by hand.
  ['0.20', '0.25', '0.35', '0.5', '0.75', '0.10', '0.15', '0.30'].forEach((literal) => {
    assert.equal(
      source.includes(`chances.${literal}`) || source.includes(`: ${literal}`),
      false,
      `utils.js still hardcodes the chance ${literal}`,
    );
  });

  assert.equal(source.includes('ARENA_DEFS'), true, 'the table must come from the registry');
  assert.equal(CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].value > 0, true);
});