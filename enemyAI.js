import { getGameState } from './state.js';
import { OBJECT_TYPES } from './registry.js';
import { DIMS } from './config.js';
import { dealDamageToPlayer } from './combat.js';
import { play } from './animation.js';

let cachedThreatMaps = null;
let threatMapsDirty = true;

export function markThreatMapsDirty() {
  threatMapsDirty = true;
}

export function cleanupDeadEnemies(rows) {
  let hasChanges = false;
  
  for (const row of rows) {
    for (const cell of row) {
      if (cell.type === OBJECT_TYPES.ENEMY && cell.data && cell.data.currentHp <= 0) {
        cell.type = OBJECT_TYPES.EMPTY;
        cell.data = null;
        hasChanges = true;
      }
    }
  }
  
  if (hasChanges) markThreatMapsDirty();
}

function canEnemySeePlayer(enemy, enemyX, enemyY, playerPos, rows) {
  if (enemyY !== playerPos.y) return false;
  
  const distanceX = Math.abs(playerPos.x - enemyX);
  if (distanceX > enemy.visionRange) return false;

  const direction = Math.sign(playerPos.x - enemyX);
  for (let i = 1; i < distanceX; i++) {
    if (rows[enemyY][enemyX + i * direction].type === OBJECT_TYPES.WALL) {
      return false;
    }
  }
  
  return true;
}

export function getThreatMaps(rows, playerPos) {
  if (!threatMapsDirty && cachedThreatMaps) {
    return cachedThreatMaps;
  }

  const idleThreatMap = new Set();
  const alertThreatMap = new Set();

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < DIMS.COLS; x++) {
      const cell = rows[y][x];
      if (cell.type !== OBJECT_TYPES.ENEMY || !cell.data) continue;

      const enemy = cell.data;
      const isAlert = canEnemySeePlayer(enemy, x, y, playerPos, rows);
      const targetMap = isAlert ? alertThreatMap : idleThreatMap;

      targetMap.add(`${x},${y}`);

      for (let i = 1; i <= enemy.visionRange; i++) {
        const checkX = x - i;
        if (checkX < 0) break;
        if (rows[y][checkX].type === OBJECT_TYPES.WALL) break;
        targetMap.add(`${checkX},${y}`);
      }
      for (let i = 1; i <= enemy.visionRange; i++) {
        const checkX = x + i;
        if (checkX >= DIMS.COLS) break;
        if (rows[y][checkX].type === OBJECT_TYPES.WALL) break;
        targetMap.add(`${checkX},${y}`);
      }
    }
  }

  cachedThreatMaps = { idleThreatMap, alertThreatMap };
  threatMapsDirty = false;
  return cachedThreatMaps;
}

export function processEnemyTurns(y, onAllAttacksComplete) {
  const { player, rows } = getGameState().runState;
  console.log('processEnemyTurns called for row:', y);
  if (y < 0) {
    onAllAttacksComplete();
    return;
  }

  const attackingEnemies = [];
  for (let x = 0; x < DIMS.COLS; x++) {
    const cell = rows[y][x];
    if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
      if (canEnemySeePlayer(cell.data, x, y, player.pos, rows)) {
        console.log('Enemy at', x, y, 'can see player, attacking!');
        attackingEnemies.push(cell);
      }
    }
  }

  console.log('Attacking enemies:', attackingEnemies.length);
  if (attackingEnemies.length === 0) {
    onAllAttacksComplete();
    return;
  }

  function playNextAttack(index) {
    if (index >= attackingEnemies.length) {
      onAllAttacksComplete();
      return;
    }

    const enemyCell = attackingEnemies[index];
    const enemy = enemyCell.data;
    const originalY = enemyCell.visual.y;

    play({
      target: enemyCell,
      props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.3 },
      duration: 150,
      onComplete: () => {
        dealDamageToPlayer(enemy.currentHp, enemy);

        play({
          target: enemyCell,
          props: { 'visual.y': originalY },
          duration: 150,
          onComplete: () => playNextAttack(index + 1)
        });
      }
    });
  }

  playNextAttack(0);
}

export function isEnemyOnCell(x, y, rows) {
  return rows[y]?.[x]?.type === OBJECT_TYPES.ENEMY;
}
