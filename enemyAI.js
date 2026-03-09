import { getGameState } from './state.js';
import { OBJECT_TYPES } from './registry.js';
import { DIMS } from './config.js';
import { dealDamageToPlayer } from './combat.js';
import { play } from './animation.js';

export function updateEnemyAI() {
  const { player, rows } = getGameState().runState;
  rows.forEach((row, y) => {
    row.forEach(cell => {
      if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
        const enemy = cell.data;
        if (y === player.pos.y) {
          const distanceX = player.pos.x - enemy.originalPos.x;
          const visionRange = enemy.visionRange;

          if (Math.abs(distanceX) <= visionRange) {
            let isBlocked = false;
            const direction = Math.sign(distanceX);
            for (let i = 1; i < Math.abs(distanceX); i++) {
              const checkX = enemy.originalPos.x + i * direction;
              if (rows[y][checkX].type === OBJECT_TYPES.WALL) {
                isBlocked = true;
                break;
              }
            }
            
            if (!isBlocked) {
              enemy.aiState = 'alert';
            }
          }
        }
      }
    });
  });
}

export function cleanupDeadEnemies(rows) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell.type === OBJECT_TYPES.ENEMY && cell.data && cell.data.currentHp <= 0) {
        cell.type = OBJECT_TYPES.EMPTY;
        cell.data = null;
      }
    }
  }
}

export function getThreatMaps(rows) {
  const idleThreatMap = new Set();
  const alertThreatMap = new Set();

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < DIMS.COLS; x++) {
      const cell = rows[y][x];
      if (cell.type !== OBJECT_TYPES.ENEMY || !cell.data) continue;

      const enemy = cell.data;
      const targetMap = enemy.aiState === 'alert' ? alertThreatMap : idleThreatMap;

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

  return { idleThreatMap, alertThreatMap };
}

export function processEnemyTurns(y, onAllAttacksComplete) {
  const { player, rows } = getGameState().runState;
  if (y < 0) {
    onAllAttacksComplete();
    return;
  }

  const attackingEnemies = rows[y].filter(cell => 
    cell.type === OBJECT_TYPES.ENEMY && cell.data?.aiState === 'alert'
  );

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
        const damageDealt = dealDamageToPlayer(enemy.currentHp, enemy);

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
