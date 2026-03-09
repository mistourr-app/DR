import { getGameState } from './state.js';
import { OBJECT_TYPES, CELL_DEFS } from './registry.js';
import { DIMS } from './config.js';
import { dealDamageToPlayer, dealDamageToBoss } from './combat.js';
import { play } from './animation.js';
import { generateNewArenaObject } from './run.js';

function createPRNG(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

export function processBossTurn() {
  const { runState, runState: { player, boss, rows, seed } } = getGameState();
  runState.turnOwner = 'processing';
  console.log("Boss is taking a turn.");

  const random = createPRNG(seed + boss.pos.x * boss.pos.y);

  const hpPercent = boss.currentHp / boss.hp;
  let aiProfile = 'balanced';
  if (hpPercent > 0.6) {
    aiProfile = 'aggressive';
  } else if (hpPercent <= 0.25) {
    aiProfile = 'defensive';
  }

  let bestScore = -1;
  let bestMoves = [];

  for (let newX = 0; newX < DIMS.COLS; newX++) {
    if (newX === boss.pos.x) continue;
    
    const targetCell = rows[boss.pos.y][newX];
    let score = random() * 0.5;

    switch (aiProfile) {
      case 'aggressive':
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL && player.pos.x === newX) score += 200;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 50;
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 5;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 1;
        break;
      case 'defensive':
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 200;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 100;
        if (player.pos.x === newX) score -= 50;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 10;
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL && player.pos.x === newX) score += 5;
        break;
      case 'balanced':
      default:
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL && player.pos.x === newX) score += 100;
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 40;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 20;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 20;
        break;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [newX];
    } else if (Math.abs(score - bestScore) < 0.1) {
      bestMoves.push(newX);
    }
  }

  let targetX;
  if (bestMoves.length > 0) {
    targetX = bestMoves[Math.floor(random() * bestMoves.length)];
  } else {
    const allPossibleMoves = Array.from({length: DIMS.COLS}, (_, i) => i).filter(i => i !== boss.pos.x);
    targetX = allPossibleMoves[Math.floor(random() * allPossibleMoves.length)];
  }
  console.log(`Boss AI profile: ${aiProfile}, chose move to ${targetX}`);

  const targetCell = rows[boss.pos.y][targetX];
  const bossCell = rows[boss.pos.y][boss.pos.x];
  
  play({
    target: bossCell.visual,
    props: { x: targetX * DIMS.CELL_SIZE },
    duration: 200,
    onComplete: () => {
      boss.pos.x = targetX;

      const landedCellType = targetCell.type;
      const landedCellData = targetCell.data;

      if (landedCellType === OBJECT_TYPES.ATTACK_BONUS) {
        if (boss.inventory.attackBonuses.length < 2) {
          boss.inventory.attackBonuses.push({ ...landedCellData });
        }
      } else if (landedCellType === OBJECT_TYPES.DEFENSE_BONUS) {
        if (boss.inventory.defenseBonuses.length < 2) {
          boss.inventory.defenseBonuses.push({ ...landedCellData });
        }
      }

      const random = createPRNG(runState.seed + bossCell.visual.x * bossCell.visual.y + runState.boss.currentHp);
      const { type: newType, data: newData } = generateNewArenaObject(bossCell.visual.x / DIMS.CELL_SIZE, boss.pos.y, runState.totalRows, random);
      bossCell.type = newType;
      bossCell.data = newData;

      targetCell.type = OBJECT_TYPES.BOSS;
      targetCell.data = boss;
      targetCell.visual.x = targetX * DIMS.CELL_SIZE;

      if (landedCellType === OBJECT_TYPES.ATTACK_CELL && player.pos.x === targetX) {
        const cellDamage = landedCellData.value;
        const bonusDamage = boss.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
        const totalDamage = cellDamage + bonusDamage;
        boss.inventory.attackBonuses = [];

        const originalY = targetCell.visual.y;
        play({
          target: targetCell,
          props: { 'visual.y': originalY - DIMS.CELL_SIZE * 0.5 },
          duration: 150,
          onComplete: () => {
            dealDamageToPlayer(totalDamage, boss);
            play({
              target: targetCell,
              props: { 'visual.y': originalY },
              duration: 150,
              onComplete: () => {
                if (player.hp > 0) {
                  runState.turnOwner = 'player';
                }
              }
            });
          }
        });
      } else {
        if (player.hp > 0) {
          runState.turnOwner = 'player';
        }
      }
    }
  });
}
