import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const {
  UPGRADE_DEFS,
  UPGRADE_KEY_TO_STAT,
  PLAYER_DEFS,
  CELL_DEFS,
  OBJECT_TYPES,
  upgradeCost,
  upgradeTotalCost,
  resolvePlayerStats,
} = await import('../registry.js');
const {
  loadMetaState,
  addGold,
  buyUpgrade,
  getUpgradeLevel,
  getProgress,
  setCurrentLevel,
  setAllLevelsUnlocked,
  resetProgress,
  getGameState,
} = await import('../state.js');

const KEYS = Object.keys(UPGRADE_DEFS);

function freshPlayer(gold = 0, upgrades = {}) {
  storage.clear();
  storage.set('dcc_meta', JSON.stringify({ gold, upgrades }));
  loadMetaState();
}

test('every upgrade track feeds a resolved stat and has a sane shape', () => {
  assert.equal(KEYS.length, 8, 'eight tracks ship');

  KEYS.forEach((key) => {
    const def = UPGRADE_DEFS[key];
    const statKey = UPGRADE_KEY_TO_STAT[key];

    assert.equal(typeof def.label, 'string', `${key} needs a label`);
    assert.equal(def.effect > 0, true, `${key} effect must be positive`);
    assert.equal(def.base >= 0 && def.step >= 0, true, `${key} price fields`);
    assert.equal(typeof statKey, 'string', `${key} maps to no stat`);
  });

  // No two tracks may feed the same stat, otherwise one would mask the other.
  const statKeys = KEYS.map(key => UPGRADE_KEY_TO_STAT[key]);
  assert.equal(new Set(statKeys).size, statKeys.length, 'tracks collide on a stat');
});

test('an untouched player resolves to the base kit', () => {
  const stats = resolvePlayerStats({});

  assert.equal(stats.maxHp, PLAYER_DEFS.hp);
  assert.equal(stats.maxEnergy, PLAYER_DEFS.energy);
  assert.equal(stats.weaponDamage, PLAYER_DEFS.weapon.damage);
  assert.equal(stats.weaponRange, PLAYER_DEFS.weapon.range);
  assert.equal(stats.maxAmmo, PLAYER_DEFS.ammo);
  assert.equal(stats.attackBonusValue, CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].value);
  assert.equal(stats.defenseBonusValue, CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].value);
  assert.equal(stats.energyPerCell, CELL_DEFS[OBJECT_TYPES.ENERGY].amount);
  assert.equal(stats.boltsPerCell, CELL_DEFS[OBJECT_TYPES.AMMO].amount);
});

test('resolvePlayerStats ignores junk input', () => {
  const base = resolvePlayerStats({});
  const junk = resolvePlayerStats({
    hp: -3,
    energy: 'lots',
    weaponDamage: Number.NaN,
    maxAmmo: Infinity,
    unknownTrack: 99,
  });

  assert.deepEqual(junk, base, 'junk must not move any stat');
});

test('a fractional level floors instead of being rejected', () => {
  // Normalisation floors, so 2.9 levels must behave exactly like 2.
  assert.deepEqual(
    resolvePlayerStats({ maxAmmo: 2.9 }),
    resolvePlayerStats({ maxAmmo: 2 }),
  );
  assert.equal(
    resolvePlayerStats({ maxAmmo: 0.9 }).maxAmmo,
    resolvePlayerStats({}).maxAmmo,
    'below one level is worth nothing',
  );
});

test('each level adds exactly one effect', () => {
  KEYS.forEach((key) => {
    const statKey = UPGRADE_KEY_TO_STAT[key];
    const effect = UPGRADE_DEFS[key].effect;

    for (const levels of [1, 3, 7]) {
      const levelsObject = { [key]: levels };
      const stats = resolvePlayerStats(levelsObject);
      assert.equal(
        stats[statKey],
        resolvePlayerStats({})[statKey] + effect * levels,
        `${key} at ${levels}`,
      );
    }
  });
});

test('the price of the next level grows linearly', () => {
  KEYS.forEach((key) => {
    const { base, step } = UPGRADE_DEFS[key];

    assert.equal(upgradeCost(key, 0), base, `${key} first level`);

    for (let level = 0; level < 12; level += 1) {
      assert.equal(upgradeCost(key, level), base + step * level, `${key} at level ${level}`);
      // Strictly more expensive than the previous one.
      assert.equal(upgradeCost(key, level + 1) > upgradeCost(key, level), true, `${key} must escalate`);
    }
  });

  assert.equal(upgradeCost('unknown_track', 0), null);
  // Negative and fractional levels cannot produce a cheaper price.
  assert.equal(upgradeCost('hp', -5), UPGRADE_DEFS.hp.base);
  assert.equal(upgradeCost('hp', 2.9), upgradeCost('hp', 2));
});

test('upgradeTotalCost matches the sum of the individual prices', () => {
  KEYS.forEach((key) => {
    let running = 0;
    for (let level = 0; level < 10; level += 1) running += upgradeCost(key, level);

    assert.equal(upgradeTotalCost(key, 10), running, key);
    assert.equal(upgradeTotalCost(key, 0), 0, key);
    assert.equal(upgradeTotalCost('unknown', 5), null);
  });
});

test('buying costs exactly the quoted price and raises the level', () => {
  const cost = upgradeCost('hp', 0);
  freshPlayer(cost);

  assert.equal(buyUpgrade('hp'), true, 'affordable');
  assert.equal(getUpgradeLevel('hp'), 1);
  assert.equal(getGameState().metaState.gold, 0, 'exact price deducted');

  // The next level costs strictly more and the player is now broke.
  assert.equal(upgradeCost('hp', 1) > cost, true);
  assert.equal(buyUpgrade('hp'), false, 'too poor');
  assert.equal(getUpgradeLevel('hp'), 1, 'level unchanged');
  assert.equal(getGameState().metaState.gold, 0, 'no gold lost on a refusal');
});

test('unknown tracks can never be bought', () => {
  freshPlayer(10000);

  assert.equal(buyUpgrade('nonsense'), false);
  assert.equal(buyUpgrade('__proto__'), false);
  assert.equal(buyUpgrade('constructor'), false);
  assert.equal(getGameState().metaState.upgrades.nonsense, undefined);
  assert.equal(getGameState().metaState.gold, 10000, 'gold untouched');
});

test('buying is unlimited and lands in the save', () => {
  freshPlayer(1000000);
  for (let index = 0; index < 40; index += 1) assert.equal(buyUpgrade('energy'), true);

  assert.equal(getUpgradeLevel('energy'), 40);
  assert.equal(resolvePlayerStats({ energy: 40 }).maxEnergy, PLAYER_DEFS.energy + 40 * UPGRADE_DEFS.energy.effect);

  const saved = JSON.parse(storage.get('dcc_meta'));
  assert.equal(saved.upgrades.energy, 40);
});

test('the economy lets the player afford the cheapest track on dungeon 1', () => {
  const cheapest = Math.min(...KEYS.map(key => upgradeCost(key, 0)));

  freshPlayer(cheapest);
  const buyable = KEYS.filter(key => upgradeCost(key, 0) <= cheapest);

  assert.equal(buyable.length >= 1, true, 'at least one track must open immediately');
  buyable.forEach(key => assert.equal(buyUpgrade(key), true, key));
});

test('a whole campaign clears the whole grid without going negative', () => {
  // Every track bought to a generous target level, paid with the income of a
  // perfect run. This is the shape of the intended progression.
  const targets = { hp: 8, energy: 5, weaponDamage: 5, maxAmmo: 3, attackBonus: 4, defenseBonus: 4, energyPerCell: 4, boltsPerCell: 3 };
  const totalCost = Object.entries(targets).reduce((sum, [key, level]) => sum + upgradeTotalCost(key, level), 0);

  freshPlayer(totalCost);
  Object.entries(targets).forEach(([key, level]) => {
    for (let index = 0; index < level; index += 1) assert.equal(buyUpgrade(key), true, `${key} level ${index + 1}`);
  });

  assert.equal(getGameState().metaState.gold, 0, 'exactly spent');

  const stats = resolvePlayerStats(getGameState().metaState.upgrades);
  // The end game build has to outpace the hardest enemy tier in the window.
  const hardestArcanist = 12;
  const hardestWarden = 18;

  assert.equal(stats.maxHp > hardestWarden, true, 'might must survive a Warden hit');
  assert.equal(
    stats.weaponDamage + 2 * stats.attackBonusValue > hardestWarden,
    true,
    'a loaded crossbow shot must break a Warden',
  );
  assert.equal(stats.maxAmmo >= 4, true, 'needs more than one bolt');
  assert.equal(hardestArcanist > 0, true);
});

test('progress only moves forward and is clamped to the campaign', async () => {
  const { CAMPAIGN_LEVELS } = await import('../registry.js');
  freshPlayer();
  assert.equal(getProgress().current, 1);

  setCurrentLevel(5);
  assert.equal(getProgress().current, 5);

  // Never rewinds.
  setCurrentLevel(2);
  assert.equal(getProgress().current, 5);

  // Nonsense below the range is rejected outright.
  setCurrentLevel(0);
  setCurrentLevel(-1);
  setCurrentLevel(2.5);
  assert.equal(getProgress().current, 5, 'invalid values are refused');

  // Running past the campaign clamps to the last dungeon, which is how clearing
  // the final one behaves.
  setCurrentLevel(9999);
  assert.equal(getProgress().current, CAMPAIGN_LEVELS.length);
});

test('the unlock cheat is opt in and survives a save round trip', () => {
  freshPlayer();
  assert.equal(getProgress().allUnlocked, false, 'off by default');

  setAllLevelsUnlocked(true);
  assert.equal(getProgress().allUnlocked, true);
  assert.equal(JSON.parse(storage.get('dcc_meta')).progress.allUnlocked, true);

  setAllLevelsUnlocked(false);
  assert.equal(getProgress().allUnlocked, false);
  assert.equal(setAllLevelsUnlocked('yes'), false, 'only an explicit true enables it');
});

test('resetProgress clears upgrades and progress but keeps gold', () => {
  freshPlayer(777, { hp: 5, energy: 3 });
  setCurrentLevel(9);
  setAllLevelsUnlocked(true);

  resetProgress();

  assert.deepEqual(getGameState().metaState.upgrades, {});
  assert.equal(getProgress().current, 1);
  assert.equal(getProgress().allUnlocked, false);
  assert.equal(getGameState().metaState.gold, 777, 'gold is never wiped by a reset');
});

test('gold only ever grows through addGold', () => {
  freshPlayer(10);

  addGold(5);
  assert.equal(getGameState().metaState.gold, 15);

  addGold(-100);
  addGold(0);
  addGold('lots');
  addGold(Number.NaN);
  assert.equal(getGameState().metaState.gold, 15, 'bogus deposits ignored');
});
