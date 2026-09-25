import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_CURVE,
  CAMPAIGN_LEVELS,
  LEVELS,
  LEVEL_CHANCE_KEYS,
  getLevelById,
  validateLevelDefinition,
} from '../registry.js';

const FIRST = CAMPAIGN_LEVELS[0];
const LAST = CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.length - 1];
const TOTAL = CAMPAIGN_CURVE.total;

function chanceSum(level) {
  return LEVEL_CHANCE_KEYS.reduce((total, key) => total + level.chances[key], 0);
}

test('campaign contains exactly 30 levels with unique ids and names', () => {
  assert.equal(TOTAL, 30);
  assert.equal(CAMPAIGN_LEVELS.length, TOTAL);
  assert.equal(new Set(CAMPAIGN_LEVELS.map(level => level.id)).size, TOTAL);
  assert.equal(new Set(CAMPAIGN_LEVELS.map(level => level.name)).size, TOTAL);
});

test('levels are numbered from Dungeon 1 to Dungeon 30', () => {
  CAMPAIGN_LEVELS.forEach((level, index) => {
    assert.equal(level.name, `Dungeon ${index + 1}`);
    assert.equal(level.id, `dungeon_${String(index + 1).padStart(2, '0')}`);
    assert.equal(level.difficulty, index + 1);
  });
  assert.equal(FIRST.name, 'Dungeon 1');
  assert.equal(LAST.name, 'Dungeon 30');
});

test('rows grow from 30 on the first level to 75 on the last level', () => {
  assert.equal(FIRST.rows, 30);
  assert.equal(LAST.rows, 75);
  CAMPAIGN_LEVELS.forEach((level, index) => {
    const previous = CAMPAIGN_LEVELS[index - 1];
    if (!previous) return;
    assert.equal(level.rows >= previous.rows, true, `rows must not decrease at ${level.id}`);
    assert.equal(level.rows >= 3 && level.rows <= 100, true, level.id);
  });
});

test('boss hp grows linearly from 1.2 to 5', () => {
  assert.equal(FIRST.bossHpMultiplier, 1.2);
  assert.equal(LAST.bossHpMultiplier, 5);
  CAMPAIGN_LEVELS.forEach((level, index) => {
    const previous = CAMPAIGN_LEVELS[index - 1];
    if (!previous) return;
    assert.equal(level.bossHpMultiplier >= previous.bossHpMultiplier, true, level.id);
  });
  // HP считается как round(20 * multiplier), поэтому финальный босс заметно живучее первого.
  assert.equal(Math.round(20 * FIRST.bossHpMultiplier), 24);
  assert.equal(Math.round(20 * LAST.bossHpMultiplier), 100);
});

test('enemy and wall density never decrease', () => {
  assert.equal(FIRST.chances.ENEMY, 0.1);
  assert.equal(LAST.chances.ENEMY, 0.2);
  assert.equal(FIRST.chances.WALL, 0.15);
  assert.equal(LAST.chances.WALL, 0.3);
  CAMPAIGN_LEVELS.forEach((level, index) => {
    const previous = CAMPAIGN_LEVELS[index - 1];
    if (!previous) return;
    assert.equal(level.chances.ENEMY >= previous.chances.ENEMY, true, level.id);
    assert.equal(level.chances.WALL >= previous.chances.WALL, true, level.id);
  });
});

test('support items become scarcer towards the last level', () => {
  ['HEAL', 'AMMO', 'ENERGY', 'ATTACK_BONUS', 'DEFENSE_BONUS'].forEach((key) => {
    assert.equal(FIRST.chances[key] >= LAST.chances[key], true, key);
    CAMPAIGN_LEVELS.forEach((level, index) => {
      const previous = CAMPAIGN_LEVELS[index - 1];
      if (!previous) return;
      assert.equal(level.chances[key] <= previous.chances[key] + 1e-9, true, `${key} at ${level.id}`);
    });
  });
});

test('chances stay complete and never exceed the spawn budget of 1', () => {
  CAMPAIGN_LEVELS.forEach((level) => {
    assert.deepEqual(Object.keys(level.chances).sort(), [...LEVEL_CHANCE_KEYS].sort(), level.id);
    LEVEL_CHANCE_KEYS.forEach((key) => {
      const value = level.chances[key];
      assert.equal(typeof value === 'number' && Number.isFinite(value), true, `${level.id}.${key}`);
      assert.equal(value >= 0 && value <= 1, true, `${level.id}.${key}`);
    });
    assert.equal(chanceSum(level) <= 1, true, `${level.id} sum ${chanceSum(level)}`);
  });
  assert.equal(chanceSum(FIRST) <= chanceSum(LAST), true);
});

test('every campaign level passes the shared level validation', () => {
  CAMPAIGN_LEVELS.forEach((level) => {
    const result = validateLevelDefinition(level);
    assert.equal(result.valid, true, `${level.id}: ${result.errors.join(', ')}`);
  });
});

test('campaign generation is deterministic for the same curve position', () => {
  const rebuilt = CAMPAIGN_LEVELS.map((level, index) => ({ index, snapshot: { ...level.chances } }));
  const replayed = rebuilt.map(({ index, snapshot }) => {
    const level = getLevelById(`dungeon_${String(index + 1).padStart(2, '0')}`);
    return { index, snapshot: { ...level.chances } };
  });
  assert.deepEqual(replayed, rebuilt);
});

test('retired level ids are gone from the registry', () => {
  ['sector_1', 'sector_2', 'core'].forEach((id) => {
    assert.equal(getLevelById(id), undefined, id);
  });
  const registryIds = LEVELS.map(level => level.id);
  registryIds.forEach((id) => {
    assert.equal(/^sector_/.test(id), false, id);
    assert.equal(id === 'core', false, id);
  });
  // Учебный и отладочные уровни остаются в реестре.
  assert.equal(getLevelById('tutorial').isTutorial, true);
  assert.equal(getLevelById('debug_boss').hidden, true);
  assert.equal(getLevelById('test_arena').hidden, true);
});

test('campaign levels are listed in ascending order after the static levels', () => {
  const campaignIds = LEVELS.filter(level => /^dungeon_\d+$/.test(level.id)).map(level => level.id);
  assert.deepEqual(campaignIds, CAMPAIGN_LEVELS.map(level => level.id));
  assert.equal(LEVELS.length, TOTAL + 3);
  // Ни один уровень кампании не скрыт: все 30 доступны сразу.
  assert.equal(CAMPAIGN_LEVELS.filter(level => level.hidden).length, 0);
});
