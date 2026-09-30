import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BALANCE,
  CAMPAIGN_CURVE,
  CAMPAIGN_LEVELS,
  CELL_DEFS,
  ENEMY_DEFS,
  ENEMY_STRENGTH_WINDOW,
  LEVEL_CHANCE_KEYS,
  OBJECT_TYPES,
  PLAYER_DEFS,
  ENEMY_TYPE_WEIGHTS,
  rollEnemyType,
} from '../registry.js';
import { parseBalanceCsv, renderModule, resolveStrengthTable, validateBalance, normalizeForCompare } from '../scripts/build-balance.mjs';

const csv = await readFile(new URL('../balance.csv', import.meta.url), 'utf8');
const generated = await readFile(new URL('../balance.generated.js', import.meta.url), 'utf8');

// The game's createPRNG is a plain LCG with a visibly non uniform output, so a
// distribution check built on it would measure that bias instead of rollEnemyType.
function createUniformRandom(seed = 1) {
  let state = seed >>> 0 || 1;
  return function random() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

test('balance.generated.js is in sync with balance.csv', () => {
  // Guards the "single source of truth" promise: hand editing the generated
  // module, or forgetting to regenerate after a CSV edit, fails here. Compared
  // line ending insensitively, because git rewrites them on checkout.
  const parsed = parseBalanceCsv(csv);
  assert.deepEqual(validateBalance(parsed), [], 'balance.csv no longer validates');
  assert.equal(
    normalizeForCompare(renderModule(parsed)),
    normalizeForCompare(generated),
    'balance.generated.js is stale, run: npm run build:balance',
  );
});

test('the generated module is valid javascript and exposes BALANCE', async () => {
  const module = await import('../balance.generated.js');
  assert.equal(typeof module.BALANCE, 'object');
  assert.equal(module.default === module.BALANCE, true);
});

test('the csv parses into the same tree the game consumes', () => {
  assert.deepEqual(parseBalanceCsv(csv), JSON.parse(JSON.stringify(BALANCE)));
});

test('the generator resolver agrees with the game strength table', () => {
  // The report tool and the game must not drift on the curve. The hp sequence
  // has to match exactly; weights are allowed the rounding difference because
  // the game also folds the rounding residue into the heaviest tier.
  CAMPAIGN_LEVELS.forEach((level, index) => {
    const progress = CAMPAIGN_LEVELS.length === 1 ? 0 : index / (CAMPAIGN_LEVELS.length - 1);

    Object.entries(ENEMY_DEFS).forEach(([enemyType, def]) => {
      const reported = resolveStrengthTable(ENEMY_STRENGTH_WINDOW, def.hp, progress);
      const actual = level.enemyStrength[enemyType];

      assert.deepEqual(actual.map(tier => tier.hp), reported.map(tier => tier.hp), `${level.id} ${enemyType} hp`);
      actual.forEach((tier, position) => {
        assert.equal(
          Math.abs(tier.weight - reported[position].weight) < 5e-4,
          true,
          `${level.id} ${enemyType} hp ${tier.hp}: ${tier.weight} vs ${reported[position].weight}`,
        );
      });
    });
  });
});

test('no tunable is hardcoded in the runtime modules', async () => {
  // registry.js and run.js must read their numbers from the generated module.
  const sources = await Promise.all(
    ['registry.js', 'run.js', 'renderer.js', 'combat.js', 'enemyAI.js', 'bossAI.js', 'ui.js'].map(
      name => readFile(new URL(`../${name}`, import.meta.url), 'utf8'),
    ),
  );

  const forbidden = [
    /hp:\s*20\b/,
    /energy:\s*10\b/,
    /damage:\s*3\b/,
    /ammo:\s*3\b/,
    /amount:\s*(6|2|10|5)\b/,
    /hp:\s*(4|7|10)\s*,\s*\n\s*visionRange/,
  ];

  sources.forEach((source, index) => {
    forbidden.forEach((pattern) => {
      assert.equal(pattern.test(source), false, `hardcoded tunable ${pattern} in module ${index}`);
    });
  });
});

test('the csv covers every tunable the game needs', () => {
  assert.equal(BALANCE.campaign.total >= 2, true, 'need at least two dungeons for a ramp');
  assert.equal(typeof CAMPAIGN_CURVE.idPrefix, 'string');
  assert.equal(CAMPAIGN_CURVE.rows.from <= CAMPAIGN_CURVE.rows.to, true);

  LEVEL_CHANCE_KEYS.forEach((key) => {
    const range = CAMPAIGN_CURVE.chances[key];
    assert.equal(typeof range?.from === 'number' && typeof range?.to === 'number', true, `chances.${key}`);
  });

  assert.equal(ENEMY_STRENGTH_WINDOW.shape.length >= 2, true);
  assert.equal(
    Math.abs(ENEMY_STRENGTH_WINDOW.shape.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9,
    true,
    'shape must stay normalised',
  );

  // Enemy spawn weights are relative in the csv and normalised at load, so the
  // only thing to pin is that they sum to 1 and that equal weights stay uniform.
  const share = ENEMY_TYPE_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  assert.equal(Math.abs(share - 1) < 1e-9, true, `enemy shares sum to ${share}`);

  const uniform = Object.values(ENEMY_DEFS).every(def => def.weight === BALANCE.enemies.TYPE_1.weight);
  if (uniform) {
    assert.equal(ENEMY_TYPE_WEIGHTS.length, 3, 'three types ship with equal weight');
    ENEMY_TYPE_WEIGHTS.forEach((entry) => {
      assert.equal(Math.abs(entry.weight - 1 / 3) < 1e-9, true, `${entry.key} share ${entry.weight}`);
    });
  }

  assert.deepEqual(
    ENEMY_TYPE_WEIGHTS.map(entry => entry.key),
    Object.keys(ENEMY_DEFS),
    'weights must cover every enemy type exactly once',
  );

  // Every object type that needs a definition has one in the csv.
  [OBJECT_TYPES.WALL, OBJECT_TYPES.HEAL, OBJECT_TYPES.AMMO, OBJECT_TYPES.ENERGY,
    OBJECT_TYPES.ATTACK_BONUS, OBJECT_TYPES.DEFENSE_BONUS, OBJECT_TYPES.ATTACK_CELL,
    OBJECT_TYPES.GOLD].forEach((type) => {
    assert.equal(Boolean(CELL_DEFS[type]?.label), true, `${type} has no cell definition`);
  });

  // Consumables must be able to actually change the player.
  assert.equal(BALANCE.cells.HEAL.amount > 0, true);
  assert.equal(BALANCE.cells.AMMO.amount > 0, true);
  assert.equal(BALANCE.cells.ENERGY.amount > 0, true);
  assert.equal(BALANCE.cells.GOLD.amount > 0, true);
  assert.equal(BALANCE.cells.ATTACK_BONUS.value > 0, true);
  assert.equal(BALANCE.cells.DEFENSE_BONUS.value > 0, true);
  assert.equal(BALANCE.cells.ATTACK_CELL.value > 0, true);

  assert.equal(PLAYER_DEFS.hp > 0, true);
  assert.equal(PLAYER_DEFS.energy > 0, true);
  assert.equal(PLAYER_DEFS.weapon.damage > 0, true);
  assert.equal(PLAYER_DEFS.weapon.range > 0, true);
  assert.equal(PLAYER_DEFS.ammo > 0, true);
  assert.equal(PLAYER_DEFS.debugAmmo >= PLAYER_DEFS.ammo, true, 'the debug arena should not be stingier');
});

test('the spawn budget still fits the validator', () => {
  const worst = CAMPAIGN_LEVELS.reduce(
    (max, level) => Math.max(max, LEVEL_CHANCE_KEYS.reduce((sum, key) => sum + level.chances[key], 0)),
    0,
  );
  assert.equal(worst <= 1, true, `chances sum to ${worst} on some dungeon`);
});

test('rollEnemyType follows the declared shares', () => {
  // A uniform table must never leave a type unreachable.
  const hits = new Map(ENEMY_TYPE_WEIGHTS.map(entry => [entry.key, 0]));

  const random = createUniformRandom(20260930);

  for (let index = 0; index < 30000; index += 1) {
    const key = rollEnemyType(random);
    assert.equal(hits.has(key), true, `rolled an unknown type ${key}`);
    hits.set(key, hits.get(key) + 1);
  }

  ENEMY_TYPE_WEIGHTS.forEach((entry) => {
    const share = hits.get(entry.key) / 30000;
    assert.equal(Math.abs(share - entry.weight) < 0.01, true, `${entry.key} share ${share} vs ${entry.weight}`);
  });

  // The endpoints must always land on a real type.
  assert.equal(hits.has(rollEnemyType(() => 0)), true);
  assert.equal(hits.has(rollEnemyType(() => 1)), true);
});
