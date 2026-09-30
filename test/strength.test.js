import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMPAIGN_LEVELS,
  ENEMY_DEFS,
  ENEMY_STRENGTH_WINDOW,
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

test('the campaign closes with the arcanist window on 10-12', () => {
  assert.deepEqual(LAST.enemyStrength.TYPE_1, [
    { hp: 10, weight: 0.7 },
    { hp: 11, weight: 0.2 },
    { hp: 12, weight: 0.1 },
  ]);
});

test('the window keeps three tiers and only widens by one during a handover', () => {
  const bandSize = ENEMY_STRENGTH_WINDOW.shape.length;

  CAMPAIGN_LEVELS.forEach((level) => {
    Object.entries(level.enemyStrength).forEach(([enemyType, table]) => {
      assert.equal(
        table.length >= bandSize && table.length <= bandSize + 1,
        true,
        `${level.id} ${enemyType} has ${table.length} tiers`,
      );
    });
  });

  // Both ends sit on a whole offset, so the handover tier is absent there.
  Object.keys(ENEMY_DEFS).forEach((enemyType) => {
    assert.equal(FIRST.enemyStrength[enemyType].length, bandSize, `${enemyType} first`);
    assert.equal(LAST.enemyStrength[enemyType].length, bandSize, `${enemyType} last`);
  });
});

test('the window only ever climbs, one hp step at a time', () => {
  CAMPAIGN_LEVELS.forEach((level, index) => {
    const previous = CAMPAIGN_LEVELS[index - 1];
    if (!previous) return;

    Object.keys(ENEMY_DEFS).forEach((enemyType) => {
      const before = previous.enemyStrength[enemyType];
      const after = level.enemyStrength[enemyType];
      const beforeFloor = before[0].hp;
      const afterFloor = after[0].hp;

      assert.equal(afterFloor >= beforeFloor, true, `${level.id} ${enemyType} floor dropped`);
      assert.equal(afterFloor - beforeFloor <= 1, true, `${level.id} ${enemyType} floor jumped`);
      assert.equal(
        after[after.length - 1].hp >= before[before.length - 1].hp,
        true,
        `${level.id} ${enemyType} ceiling dropped`,
      );
    });
  });
});

test('new strengths arrive gradually instead of appearing at full weight', () => {
  const previousHp = new Map();

  CAMPAIGN_LEVELS.forEach((level, index) => {
    // The opening window is given, nothing arrives into it.
    const seed = previousHp.size === 0;

    Object.entries(level.enemyStrength).forEach(([enemyType, table]) => {
      const known = seed ? new Set(table.map(tier => tier.hp)) : (previousHp.get(enemyType) || new Set());

      table.forEach((tier) => {
        if (known.has(tier.hp)) return;
        // A tier that shows up for the first time must show up as a rarity,
        // otherwise the whole window would jump in a single dungeon.
        assert.equal(tier.weight <= 0.15, true, `${level.id} ${enemyType} hp ${tier.hp} appeared at ${tier.weight}`);
      });

      previousHp.set(enemyType, new Set(table.map(tier => tier.hp)));
    });
  });
});

test('a strength that starts fading never comes back', () => {
  // A tier climbs to its peak while the window moves onto it, then wanes on the
  // way out. Once it has started dropping it must keep dropping.
  const history = new Map();

  CAMPAIGN_LEVELS.forEach((level) => {
    Object.entries(level.enemyStrength).forEach(([enemyType, table]) => {
      const seen = history.get(enemyType) || new Map();

      table.forEach((tier) => {
        const state = seen.get(tier.hp);

        // Only once a tier has started dropping is it on its way out.
        if (state && state.peak) {
          assert.equal(
            tier.weight <= state.weight + 1e-9,
            true,
            `${level.id} ${enemyType} hp ${tier.hp} climbed from ${state.weight} to ${tier.weight} after peaking`,
          );
        }

        seen.set(tier.hp, {
          weight: tier.weight,
          peak: Boolean(state && (state.peak || tier.weight < state.weight)),
        });
      });

      history.set(enemyType, seen);
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

test('floor.to is the only ceiling and the window has no hard cap', () => {
  const { floor, shape } = ENEMY_STRENGTH_WINDOW;

  assert.equal(shape.length, 3, 'the band is three tiers wide');
  assert.equal(Math.abs(shape.reduce((sum, w) => sum + w, 0) - 1) < 1e-9, true, 'shape must sum to 1');
  assert.equal(floor.to > floor.from, true, 'the window must climb');

  // The base hp decides where the band starts, floor decides where it ends.
  Object.keys(ENEMY_DEFS).forEach((enemyType) => {
    const base = ENEMY_DEFS[enemyType].hp;
    assert.equal(FIRST.enemyStrength[enemyType][0].hp, base + floor.from, enemyType);
    assert.equal(LAST.enemyStrength[enemyType][2].hp, base + floor.to + 2, enemyType);
  });
});

test('growth is not uniform across types because the band is absolute', () => {
  const ratio = enemyType => {
    const first = FIRST.enemyStrength[enemyType];
    const last = LAST.enemyStrength[enemyType];
    const mean = table => table.reduce((sum, tier) => sum + tier.hp * tier.weight, 0);
    return mean(last) / mean(first);
  };

  // The band moves a fixed number of hp steps, so a low base hp type grows by a
  // much larger factor than a high one. Documented rather than accidental.
  const arcanist = ratio('TYPE_1');
  const spearman = ratio('TYPE_2');
  const warden = ratio('TYPE_3');

  assert.equal(arcanist > spearman, true, `arcanist ${arcanist} vs spearman ${spearman}`);
  assert.equal(spearman > warden, true, `spearman ${spearman} vs warden ${warden}`);
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
