import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

const { loadMetaState, addGold, getGameState } = await import('../state.js');
const { validateLevelDefinition, getLevelById } = await import('../registry.js');

// Уровни берём по id, чтобы тесты не зависели от порядка в реестре.
const TUTORIAL_LEVEL = getLevelById('tutorial');
const CAMPAIGN_LEVEL = getLevelById('dungeon_01');

test('malformed metadata falls back and valid gold is persisted', () => {
  storage.set('dcc_data_version', '2');
  storage.set('dcc_meta', JSON.stringify({ gold: 'not-a-number', upgrades: [] }));
  loadMetaState();
  assert.deepEqual(getGameState().metaState, { gold: 0, upgrades: {} });

  storage.set('dcc_meta', JSON.stringify({ gold: 7, upgrades: { damage: 1 } }));
  loadMetaState();
  addGold(3);

  assert.equal(getGameState().metaState.gold, 10);
  assert.deepEqual(JSON.parse(storage.get('dcc_meta')), { gold: 10, upgrades: { damage: 1 } });

  storage.set('dcc_meta', '{bad');
  assert.doesNotThrow(() => loadMetaState());
  assert.deepEqual(getGameState().metaState, { gold: 0, upgrades: {} });
});

test('level validation rejects impossible definitions', () => {
  assert.equal(validateLevelDefinition(TUTORIAL_LEVEL).valid, true);

  const invalid = {
    ...CAMPAIGN_LEVEL,
    id: 'bad id',
    rows: 2,
    bossHpMultiplier: 0,
    chances: {
      ENEMY: 0.9,
      WALL: 0.9,
      HEAL: 0,
      AMMO: 0,
      ENERGY: 0,
      ATTACK_BONUS: 0,
      DEFENSE_BONUS: 0,
      GOLD: 0,
    },
  };

  const validation = validateLevelDefinition(invalid);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length >= 3);
});

test('level validation rejects unsafe cell payloads and values', () => {
  const layoutLevel = JSON.parse(JSON.stringify(TUTORIAL_LEVEL));
  layoutLevel.layout[0][0] = { type: 'attack_cell' };
  layoutLevel.layout[3][2] = { type: 'heal', data: { amount: -1 } };
  layoutLevel.layout[5][2] = { type: 'enemy', enemyType: 'UNKNOWN' };

  assert.doesNotThrow(() => validateLevelDefinition(layoutLevel));
  assert.equal(validateLevelDefinition(layoutLevel).valid, false);

  const chanceLevel = JSON.parse(JSON.stringify(CAMPAIGN_LEVEL));
  chanceLevel.chances.ENEMY = Symbol('invalid');
  assert.doesNotThrow(() => validateLevelDefinition(chanceLevel));
  assert.equal(validateLevelDefinition(chanceLevel).valid, false);

  const stringChanceLevel = JSON.parse(JSON.stringify(CAMPAIGN_LEVEL));
  stringChanceLevel.chances.ENEMY = '0.15';
  assert.equal(validateLevelDefinition(stringChanceLevel).valid, false);

  const oversizedLevel = { ...CAMPAIGN_LEVEL, rows: 101 };
  assert.equal(validateLevelDefinition(oversizedLevel).valid, false);
});
