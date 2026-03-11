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
  if (!playerPos) {
    playerPos = getGameState().runState?.player?.pos;
  }
  
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

export function processEnemyTurns(y, playerOldPos, onAllAttacksComplete) {
  const { player, rows } = getGameState().runState;
  console.log(`[ENEMY_TURNS] Starting enemy turns for row ${y}, playerOldPos:`, playerOldPos);
  
  if (y < 0) {
    console.log('[ENEMY_TURNS] Row < 0, completing immediately');
    onAllAttacksComplete();
    return;
  }

  const attackingEnemies = [];
  for (let x = 0; x < DIMS.COLS; x++) {
    const cell = rows[y][x];
    if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
      if (canEnemySeePlayer(cell.data, x, y, playerOldPos, rows)) {
        console.log(`[ENEMY_TURNS] Enemy at (${x},${y}) can see player, adding to attack queue`);
        attackingEnemies.push(cell);
      }
    }
  }

  if (attackingEnemies.length === 0) {
    console.log('[ENEMY_TURNS] No attacking enemies, completing immediately');
    onAllAttacksComplete();
    return;
  }
  
  console.log(`[ENEMY_TURNS] ${attackingEnemies.length} enemies will attack`);

  function playNextAttack(index) {
    const { runState } = getGameState();
    
    console.log(`[ENEMY_TURNS] Processing attack ${index + 1}/${attackingEnemies.length}, player HP: ${runState.player.hp}`);
    
    if (index >= attackingEnemies.length) {
      console.log('[ENEMY_TURNS] All attacks completed');
      onAllAttacksComplete();
      return;
    }
    
    if (runState.player.hp <= 0) {
      console.log('[ENEMY_TURNS] Player dead, stopping attacks');
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
        const damage = dealDamageToPlayer(enemy.currentHp, enemy);
        console.log(`[ENEMY_TURNS] Enemy dealt ${damage} damage, player HP now: ${runState.player.hp}`);

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

export function updateEnemyAI() {
  markThreatMapsDirty();
}
