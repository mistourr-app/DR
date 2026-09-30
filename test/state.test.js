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

// Levels are fetched by id so the tests do not depend on registry order.
const TUTORIAL_LEVEL = getLevelById('tutorial');
const CAMPAIGN_LEVEL = getLevelById('dungeon_01');

function defaultMeta() {
  return { gold: 0, upgrades: {}, progress: { current: 1, allUnlocked: false } };
}

test('malformed metadata falls back and valid gold is persisted', () => {
  storage.set('dcc_data_version', '2');
  storage.set('dcc_meta', JSON.stringify({ gold: 'not-a-number', upgrades: [] }));
  loadMetaState();
  assert.deepEqual(getGameState().metaState, defaultMeta());

  // Unknown upgrade keys are dropped instead of surviving into the game.
  storage.set('dcc_meta', JSON.stringify({ gold: 7, upgrades: { damage: 1, hp: 2 } }));
  loadMetaState();
  addGold(3);

  assert.equal(getGameState().metaState.gold, 10);
  assert.deepEqual(JSON.parse(storage.get('dcc_meta')), {
    gold: 10,
    upgrades: { hp: 2 },
    progress: { current: 1, allUnlocked: false },
  });

  storage.set('dcc_meta', '{bad');
  assert.doesNotThrow(() => loadMetaState());
  assert.deepEqual(getGameState().metaState, defaultMeta());
});

test('upgrade levels are clamped and hostile keys are refused', () => {
  storage.set('dcc_meta', JSON.stringify({
    gold: 0,
    upgrades: {
      hp: 3.9,
      energy: -5,
      weaponDamage: '4',
      maxAmmo: 'lots',
      __proto__: { polluted: true },
      constructor: 1,
      nonsense: 12,
    },
    progress: { current: 999, allUnlocked: 'yes' },
  }));
  loadMetaState();

  const { upgrades, progress } = getGameState().metaState;

  // Floored, negatives dropped, unknown keys gone, prototype keys gone.
  assert.equal(upgrades.hp, 3);
  assert.equal('energy' in upgrades, false);
  assert.equal(upgrades.weaponDamage, 4);
  assert.equal('maxAmmo' in upgrades, false);
  assert.equal('nonsense' in upgrades, false);
  assert.equal(Object.prototype.hasOwnProperty.call(upgrades, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(upgrades, 'constructor'), false);
  assert.equal({}.polluted, undefined, 'prototype must not be polluted');

  // Out of range progress falls back, and the cheat flag must be a real boolean.
  assert.equal(progress.current, 1);
  assert.equal(progress.allUnlocked, false);
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
