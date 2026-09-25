import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'UTC';
globalThis.window = { location: { search: '' } };

const { getGameState } = await import('../state.js');
const { DIMS } = await import('../config.js');
const { OBJECT_TYPES } = await import('../registry.js');
const { startRun, processPlayerAction, resizeRunVisuals } = await import('../run.js');
const { processBossTurn } = await import('../bossAI.js');
const { updateAnimations, isAnimating, clearAnimations } = await import('../animation.js');

function setCell(runState, x, y, type, data = null) {
  runState.rows[y][x].type = type;
  runState.rows[y][x].data = data;
}

function prepareBossArena(runState, playerX = runState.boss.pos.x) {
  const playerY = runState.boss.pos.y - 1;
  runState.levelPhase = 'boss_arena';
  runState.turnOwner = 'player';
  runState.player.pos = { x: playerX, y: playerY };
  runState.player.visual.x = playerX * DIMS.CELL_SIZE;
  runState.player.visual.y = playerY * DIMS.CELL_SIZE;
  runState.player.hasShotOnCurrentRow = false;
}

test('a wall click does not spend energy or change the turn', () => {
  window.location.search = '';
  assert.equal(startRun('test_arena'), true);
  const runState = getGameState().runState;
  setCell(runState, 2, 1, OBJECT_TYPES.WALL);
  const energy = runState.player.energy;
  const position = { ...runState.player.pos };

  processPlayerAction(2, 1);

  assert.equal(runState.player.energy, energy);
  assert.deepEqual(runState.player.pos, position);
  assert.equal(runState.turnOwner, 'player');
  assert.equal(isAnimating(), false);
});

test('a dungeon turn allows only one crossbow shot', () => {
  window.location.search = '';
  assert.equal(startRun('test_arena'), true);
  const runState = getGameState().runState;
  const enemyData = () => ({
    label: 'ENEMY', hp: 1, currentHp: 1, visionRange: 2, actionRange: 2, color: '#f00',
  });
  setCell(runState, 1, 0, OBJECT_TYPES.ENEMY, enemyData());
  setCell(runState, 3, 0, OBJECT_TYPES.ENEMY, enemyData());
  runState.player.inventory.ammo = 2;

  processPlayerAction(1, 0);
  updateAnimations(1000);
  updateAnimations(1000);
  updateAnimations(1000);

  assert.equal(runState.player.inventory.ammo, 1);
  assert.equal(runState.player.hasShotOnCurrentRow, true);
  assert.equal(runState.turnOwner, 'player');

  processPlayerAction(3, 0);
  assert.equal(runState.player.inventory.ammo, 1);
  assert.equal(runState.rows[0][3].data.currentHp, 1);
  clearAnimations();
});

test('attack and defense bonuses can be picked up without exceptions', () => {
  window.location.search = '';
  assert.equal(startRun('test_arena'), true);
  let runState = getGameState().runState;
  setCell(runState, 2, 1, OBJECT_TYPES.ATTACK_BONUS, { value: 3 });
  processPlayerAction(2, 1);
  updateAnimations(300);
  assert.deepEqual(runState.player.inventory.attackBonuses, [{ value: 3 }]);

  assert.equal(startRun('test_arena'), true);
  runState = getGameState().runState;
  setCell(runState, 2, 1, OBJECT_TYPES.DEFENSE_BONUS, { value: 4 });
  processPlayerAction(2, 1);
  updateAnimations(300);
  assert.deepEqual(runState.player.inventory.defenseBonuses, [{ value: 4 }]);
});

test('the same seed produces the same procedural map', () => {
  window.location.search = '?seed=123';
  assert.equal(startRun('dungeon_01'), true);
  const firstMap = JSON.stringify(getGameState().runState.rows);

  assert.equal(startRun('dungeon_01'), true);
  const secondMap = JSON.stringify(getGameState().runState.rows);

  assert.equal(firstMap, secondMap);
  assert.equal(getGameState().runState.seed, 123);
});

test('boss full inventory pickup returns the turn to the player', () => {
  window.location.search = '';
  assert.equal(startRun('debug_boss'), true);
  const runState = getGameState().runState;
  const arenaY = runState.boss.pos.y;
  runState.levelPhase = 'boss_arena';
  runState.turnOwner = 'boss';
  runState.player.hasShotOnCurrentRow = true;
  runState.boss.inventory.attackBonuses = [{ value: 2 }, { value: 3 }];

  for (let x = 0; x < 5; x += 1) {
    if (x === runState.boss.pos.x) continue;
    setCell(runState, x, arenaY, OBJECT_TYPES.ATTACK_BONUS, { value: 2 });
  }

  processBossTurn();
  updateAnimations(200);
  updateAnimations(300);

  assert.equal(runState.turnOwner, 'player');
  assert.equal(runState.player.hasShotOnCurrentRow, false);
  assert.equal(isAnimating(), false);
  clearAnimations();
});

test('crossbow shoots a boss in the same column', () => {
  window.location.search = '';
  assert.equal(startRun('debug_boss'), true);
  const runState = getGameState().runState;
  prepareBossArena(runState);
  runState.player.inventory.ammo = 1;
  const initialBossHp = runState.boss.currentHp;

  processPlayerAction(runState.boss.pos.x, runState.boss.pos.y);
  assert.equal(runState.player.inventory.ammo, 0);
  assert.equal(runState.turnOwner, 'processing');

  updateAnimations(1000);
  updateAnimations(1000);

  assert.equal(runState.boss.currentHp, initialBossHp - 3);
  assert.equal(runState.turnOwner, 'player');
  assert.equal(runState.bossTurnScheduled, false);
  assert.equal(runState.player.hasShotOnCurrentRow, true);
  clearAnimations();
});

test('crossbow continues to shoot a boss in an adjacent column', () => {
  window.location.search = '';
  assert.equal(startRun('debug_boss'), true);
  const runState = getGameState().runState;
  prepareBossArena(runState, runState.boss.pos.x - 1);
  runState.player.inventory.ammo = 1;
  const initialBossHp = runState.boss.currentHp;

  processPlayerAction(runState.boss.pos.x, runState.boss.pos.y);
  updateAnimations(1000);
  updateAnimations(1000);

  assert.equal(runState.player.inventory.ammo, 0);
  assert.equal(runState.boss.currentHp, initialBossHp - 3);
  assert.equal(runState.turnOwner, 'player');
  assert.equal(runState.bossTurnScheduled, false);
  assert.equal(runState.player.hasShotOnCurrentRow, true);
  clearAnimations();
});

test('a boss shot keeps the player turn until position changes', () => {
  window.location.search = '';
  assert.equal(startRun('debug_boss'), true);
  const runState = getGameState().runState;
  prepareBossArena(runState);
  runState.player.inventory.ammo = 1;
  const playerX = runState.player.pos.x;
  const playerY = runState.player.pos.y;

  processPlayerAction(runState.boss.pos.x, runState.boss.pos.y);
  updateAnimations(1000);
  updateAnimations(1000);
  assert.equal(runState.turnOwner, 'player');
  assert.equal(runState.bossTurnScheduled, false);

  setCell(runState, playerX - 1, playerY, OBJECT_TYPES.EMPTY);
  processPlayerAction(playerX - 1, playerY);
  updateAnimations(1000);

  assert.equal(runState.player.pos.x, playerX - 1);
  assert.equal(runState.bossTurnScheduled, true);
  clearAnimations();
});

test('same-column melee remains available without ammo', () => {
  window.location.search = '';
  assert.equal(startRun('debug_boss'), true);
  const runState = getGameState().runState;
  prepareBossArena(runState);
  runState.player.inventory.ammo = 0;
  runState.player.inventory.attackBonuses = [{ value: 4 }];
  const initialBossHp = runState.boss.currentHp;

  processPlayerAction(runState.boss.pos.x, runState.boss.pos.y);
  updateAnimations(1000);
  updateAnimations(1000);

  assert.deepEqual(runState.player.inventory.attackBonuses, []);
  assert.equal(runState.boss.currentHp, initialBossHp - 4);
  assert.equal(runState.bossTurnScheduled, true);
  clearAnimations();
});

test('distant melee requires jump energy and resets the row shot flag', () => {
  window.location.search = '';
  assert.equal(startRun('test_arena'), true);
  const runState = getGameState().runState;
  setCell(runState, 4, 1, OBJECT_TYPES.ENEMY, {
    ...{ label: 'ENEMY', hp: 4, currentHp: 4, visionRange: 2, actionRange: 2, color: '#f00' },
  });
  runState.player.energy = 0;

  processPlayerAction(4, 1);
  assert.equal(runState.player.energy, 0);
  assert.equal(runState.turnOwner, 'player');
  assert.equal(isAnimating(), false);

  runState.player.energy = 2;
  runState.player.hasShotOnCurrentRow = true;
  processPlayerAction(4, 1);
  for (let index = 0; index < 8; index += 1) {
    updateAnimations(1000);
  }

  assert.equal(runState.player.hasShotOnCurrentRow, false);
  assert.equal(runState.turnOwner, 'player');
  clearAnimations();
});

test('melee entering the boss arena hands off after combat', () => {
  window.location.search = '';
  assert.equal(startRun('dungeon_01'), true);
  const runState = getGameState().runState;
  const arenaY = runState.totalRows - 2;
  runState.player.pos = { x: 2, y: arenaY - 1 };
  runState.player.visual.y = (arenaY - 1) * DIMS.CELL_SIZE;
  runState.player.energy = 10;
  runState.rows[arenaY - 1].forEach((cell) => {
    cell.type = OBJECT_TYPES.EMPTY;
    cell.data = null;
  });
  setCell(runState, 2, arenaY, OBJECT_TYPES.ENEMY, {
    label: 'ENEMY', hp: 4, currentHp: 4, visionRange: 2, actionRange: 2, color: '#f00',
  });

  processPlayerAction(2, arenaY);
  for (let index = 0; index < 8; index += 1) {
    updateAnimations(1000);
  }

  assert.equal(runState.levelPhase, 'boss_arena');
  assert.equal(runState.bossTurnScheduled, true);
  clearAnimations();
});

test('resizing rebases queued animation endpoints', () => {
  window.location.search = '';
  assert.equal(startRun('test_arena'), true);
  const runState = getGameState().runState;
  setCell(runState, 4, 1, OBJECT_TYPES.EMPTY);
  runState.player.energy = 10;
  processPlayerAction(4, 1);
  assert.equal(isAnimating(), true);

  const previousCellSize = DIMS.CELL_SIZE;
  DIMS.CELL_SIZE = previousCellSize / 2;
  resizeRunVisuals(previousCellSize);
  updateAnimations(125);
  assert.equal(runState.player.visual.x, 96);
  updateAnimations(125);
  clearAnimations();
  DIMS.CELL_SIZE = previousCellSize;
});
