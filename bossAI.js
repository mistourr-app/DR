import { getGameState } from './state.js';
import { OBJECT_TYPES, CELL_DEFS } from './registry.js';
import { DIMS } from './config.js';
import { calculateAttackOutcome, applyPlayerDamage } from './combat.js';
import { play } from './animation.js';
import { createPRNG, generateArenaObject, spawnArenaObject } from './utils.js';
import { updateTutorial } from './tutorial.js';

export function processBossTurn() {
  const { runState } = getGameState();
  if (!runState) return;
  const { player, boss, rows, seed } = runState;
  
  if (!boss || boss.currentHp <= 0 || player.hp <= 0) {
    console.log('[BOSS_TURN] Boss or player is unavailable, skipping turn');
    return;
  }

  runState.bossTurnScheduled = false;
  if (runState.turnOwner !== 'processing' && runState.turnOwner !== 'boss') {
    return;
  }

  player.hasShotOnCurrentRow = false;
  runState.turnOwner = 'processing';
  console.log("[BOSS_TURN] Boss is taking a turn, player HP:", player.hp, "boss HP:", boss.currentHp);

  const random = runState.random || createPRNG(seed + boss.pos.x * boss.pos.y);

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
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL) score += 200;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 50;
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 5;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 1;
        break;
      case 'defensive':
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 200;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 100;
        if (player.pos.x === newX) score -= 50;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 10;
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL) score += 5;
        break;
      case 'balanced':
      default:
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL) score += 100;
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

  // Разрыв циклов: избегаем возврата на предыдущую позицию
  if (bestMoves.length > 1 && boss.lastMoveX != null) {
    const filtered = bestMoves.filter(m => m !== boss.lastMoveX);
    if (filtered.length > 0) bestMoves = filtered;
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
  const oldBossX = boss.pos.x;

  play({
    target: boss,
    props: { 'visual.x': targetX * DIMS.CELL_SIZE },
    duration: 200,
    onComplete: () => {
       const landedCellType = targetCell.type;
       const landedCellData = targetCell.data;
       let bossActionPending = false;

      console.log(`[BOSS_MOVE] from x=${oldBossX} to x=${targetX}, landedOn=${landedCellType}`);
      console.log(`[BOSS_CELL] bossCell(${oldBossX}) type=${bossCell.type}`);

      // Сбрасываем visual старой клетки на своё место
      bossCell.visual.x = oldBossX * DIMS.CELL_SIZE;

      // Босс перемещается на новую позицию
      boss.pos.x = targetX;
       if (boss) boss.lastMoveX = oldBossX;

      // Генерируем объект на старой позиции босса
      spawnArenaObject(bossCell, oldBossX, boss.pos.y, runState.totalRows, boss.currentHp / boss.hp, runState.random);
      console.log(`[BOSS_CELL_AFTER] bossCell(${oldBossX}) type=${bossCell.type}`);

      console.log(`[BOSS_PICKUP] landedCellType=${landedCellType}, landedCellData=`, landedCellData, 'boss inv:', boss.inventory);

       if (landedCellType === OBJECT_TYPES.ATTACK_BONUS) {
         if (boss.inventory.attackBonuses.length < 2) {
           boss.inventory.attackBonuses.push({ ...landedCellData });
           targetCell.type = OBJECT_TYPES.EMPTY;
           targetCell.data = null;
         } else {
           bossActionPending = true;
           targetCell.isAnimating = true;
           play({
             target: targetCell,
             props: { 'visual.alpha': 0 },
             duration: 300,
             onComplete: () => {
               targetCell.type = OBJECT_TYPES.EMPTY;
               targetCell.data = null;
               targetCell.isAnimating = false;
               bossActionPending = false;
               if (player.hp > 0) {
                 runState.turnOwner = 'player';
                 updateTutorial();
               }
             }
           });
         }
       } else if (landedCellType === OBJECT_TYPES.DEFENSE_BONUS) {
         if (boss.inventory.defenseBonuses.length < 2) {
           boss.inventory.defenseBonuses.push({ ...landedCellData });
           targetCell.type = OBJECT_TYPES.EMPTY;
           targetCell.data = null;
         } else {
           bossActionPending = true;
           targetCell.isAnimating = true;
           play({
             target: targetCell,
             props: { 'visual.alpha': 0 },
             duration: 300,
             onComplete: () => {
               targetCell.type = OBJECT_TYPES.EMPTY;
               targetCell.data = null;
               targetCell.isAnimating = false;
               bossActionPending = false;
               if (player.hp > 0) {
                 runState.turnOwner = 'player';
                 updateTutorial();
               }
             }
           });
         }
       } else if (landedCellType === OBJECT_TYPES.HEAL) {
         const healAmount = CELL_DEFS[OBJECT_TYPES.HEAL].amount;
         const oldHp = boss.currentHp;
         boss.currentHp = Math.min(boss.hp, oldHp + healAmount);
         targetCell.type = OBJECT_TYPES.EMPTY;
         targetCell.data = null;
       } else if (landedCellType === OBJECT_TYPES.ATTACK_CELL) {
         const cellDamage = landedCellData?.value || CELL_DEFS[OBJECT_TYPES.ATTACK_CELL].value;
         targetCell.type = OBJECT_TYPES.EMPTY;
         targetCell.data = null;
         const attackBonuses = boss.inventory.attackBonuses;
        const defenseBonuses = player.inventory.defenseBonuses;
        const originalY = targetCell.visual.y;
        play({
          target: targetCell,
          props: { 'visual.y': originalY - DIMS.CELL_SIZE * 0.5 },
          duration: 150,
          onComplete: () => {
            const outcome = calculateAttackOutcome(
              cellDamage,
              attackBonuses,
              defenseBonuses,
              player.hp,
            );
            applyPlayerDamage(outcome.hpDamage, boss);
            play({
              target: targetCell,
              props: { 'visual.y': originalY },
              duration: 150,
              onComplete: () => {
                if (player.hp > 0) {
                  console.log('[BOSS_TURN] Boss attack complete, returning to player');
                  runState.turnOwner = 'player';
                  updateTutorial();
                } else {
                  console.log('[BOSS_TURN] Player dead after boss attack');
                }
              }
            });
          }
        });
         return;
       } else {
         targetCell.type = OBJECT_TYPES.EMPTY;
         targetCell.data = null;
       }

       if (bossActionPending) return;

       if (player.hp > 0) {
        console.log('[BOSS_TURN] Boss turn complete, returning to player');
        runState.turnOwner = 'player';
        updateTutorial();
      } else {
        console.log('[BOSS_TURN] Player dead');
      }
    }
  });
}
