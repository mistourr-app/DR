import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMPAIGN_LEVELS,
  ENEMY_DEFS,
  ENEMY_STRENGTH_TIERS,
  rollEnemyHp,
} from '../registry.js';

const FIRST = CAMPAIGN_LEVELS[0];
const LAST = CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.length - 1];
const SAMPLE_SIZE = 40000;
const TOLERANCE = 0.01;

// The game's createPRNG is a plain LCG whose output is not perfectly uniform,
// so a distribution test built on it would measure that bias instead of
// rollEnemyHp. xorshift32 is uniform enough for the tolerance used here.
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

function sample(table, seed) {
  const random = createUniformRandom(seed);
  const hits = new Map(table.map(tier => [tier.hp, 0]));

  for (let index = 0; index < SAMPLE_SIZE; index += 1) {
    const hp = rollEnemyHp(table, random);
    assert.equal(hits.has(hp), true, `rolled ${hp} which is not part of the table`);
    hits.set(hp, hits.get(hp) + 1);
  }

  return hits;
}

test('every campaign dungeon resolves a strength table for every enemy type', () => {
  CAMPAIGN_LEVELS.forEach((level) => {
    assert.deepEqual(
      Object.keys(level.enemyStrength).sort(),
      Object.keys(ENEMY_DEFS).sort(),
      level.id,
    );

    Object.entries(level.enemyStrength).forEach(([enemyType, table]) => {
      assert.equal(Array.isArray(table) && table.length > 0, true, `${level.id} ${enemyType}`);

      table.forEach((tier) => {
        assert.equal(tier.weight > 0, true, `${level.id} ${enemyType} hp ${tier.hp} must be positive`);
        assert.equal(Number.isInteger(tier.hp), true, `${level.id} ${enemyType} hp must be an integer`);
        assert.equal(tier.hp > 0, true, `${level.id} ${enemyType} hp must be above zero`);
      });

      const total = table.reduce((sum, tier) => sum + tier.weight, 0);
      assert.equal(Math.abs(total - 1) < 1e-6, true, `${level.id} ${enemyType} weights sum to ${total}`);
    });
  });
});

test('dungeon 1 opens with the agreed arcanist window 3-5', () => {
  assert.deepEqual(FIRST.enemyStrength.TYPE_1, [
    { hp: 3, weight: 0.7 },
    { hp: 4, weight: 0.2 },
    { hp: 5, weight: 0.1 },
  ]);
});

test('the weak tier fades out as the campaign progresses', () => {
  // base hp 4, so offset -1 is hp 3 and it must be gone by the last dungeon.
  assert.equal(FIRST.enemyStrength.TYPE_1[0].hp, 3);
  assert.equal(LAST.enemyStrength.TYPE_1.some(tier => tier.hp <= 4), false);

  CAMPAIGN_LEVELS.forEach((level, index) => {
    const previous = CAMPAIGN_LEVELS[index - 1];
    if (!previous) return;

    Object.keys(ENEMY_DEFS).forEach((enemyType) => {
      const before = previous.enemyStrength[enemyType].map(tier => tier.hp);
      const after = level.enemyStrength[enemyType].map(tier => tier.hp);
      assert.equal(after.length > 0, true, `${level.id} ${enemyType}`);

      // The window slides upwards, it never drops its floor or raises its ceiling.
      assert.equal(Math.min(...after) >= Math.min(...before), true, `${level.id} ${enemyType} floor`);
      assert.equal(Math.max(...after) >= Math.max(...before), true, `${level.id} ${enemyType} ceiling`);
    });
  });
});

test('the last dungeon puts its mass on the tiers above the base hp', () => {
  Object.entries(ENEMY_DEFS).forEach(([enemyType, def]) => {
    const table = LAST.enemyStrength[enemyType];
    const strongest = table.reduce((best, tier) => (tier.weight > best.weight ? tier : best));

    assert.equal(strongest.hp > def.hp, true, `${enemyType} peak tier should sit above base hp`);
    assert.equal(table.some(tier => tier.hp <= def.hp), false, `${enemyType} should have no base or below`);
  });
});

test('the ladder defines no hard ceiling and stays extendable', () => {
  const offsets = ENEMY_STRENGTH_TIERS.map(tier => tier.offset);

  // Offsets must be contiguous so that no tier can be skipped by accident.
  offsets.forEach((offset, index) => {
    assert.equal(offset === offsets[0] + index, true, `offset ${offset} at index ${index}`);
  });

  // The top offset is unbounded by design; growth happens by appending a row.
  assert.equal(offsets[offsets.length - 1] < ENEMY_DEFS.TYPE_1.hp, false, 'the ladder does reach above base hp');
});

test('rollEnemyHp reproduces the declared weights', () => {
  const cases = [
    ['dungeon 1 arcanist', FIRST.enemyStrength.TYPE_1],
    ['dungeon 15 arcanist', CAMPAIGN_LEVELS[14].enemyStrength.TYPE_1],
    ['dungeon 30 arcanist', LAST.enemyStrength.TYPE_1],
    ['dungeon 30 warden', LAST.enemyStrength.TYPE_3],
  ];

  cases.forEach(([name, table]) => {
    const hits = sample(table, 20260930);

    table.forEach((tier) => {
      const share = hits.get(tier.hp) / SAMPLE_SIZE;
      assert.equal(
        Math.abs(share - tier.weight) < TOLERANCE,
        true,
        `${name}: hp ${tier.hp} rolled ${share.toFixed(4)} expected ${tier.weight}`,
      );
    });
  });
});

test('rollEnemyHp is stable and safe on a degenerate table', () => {
  const random = createUniformRandom(1);

  assert.equal(rollEnemyHp([], random), null);
  assert.equal(rollEnemyHp(null, random), null);
  assert.equal(rollEnemyHp(undefined, random), null);
  assert.equal(rollEnemyHp([{ hp: 7, weight: 1 }], random), 7);

  // A roll of exactly 1 must still land inside the table.
  assert.equal(rollEnemyHp([{ hp: 2, weight: 0.5 }, { hp: 9, weight: 0.5 }], () => 1), 9);
  assert.equal(rollEnemyHp([{ hp: 2, weight: 0.5 }, { hp: 9, weight: 0.5 }], () => 0), 2);
});

test('the warden is a heavy that only reaches its neighbours', () => {
  assert.equal(ENEMY_DEFS.TYPE_3.label, 'WARDEN');
  assert.equal(ENEMY_DEFS.TYPE_3.visionRange, 1);
  assert.equal(ENEMY_DEFS.TYPE_3.actionRange, 1);
  assert.equal(ENEMY_DEFS.TYPE_3.hp > ENEMY_DEFS.TYPE_2.hp, true);
  assert.equal(ENEMY_DEFS.TYPE_2.label, 'SPEARMAN');
  assert.equal(ENEMY_DEFS.TYPE_2.hp, 7);
});
