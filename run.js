import { getGameState, setAppState } from './state.js';
import { getLevelById, OBJECT_TYPES, ENEMY_DEFS, CELL_DEFS } from './registry.js';
import { DIMS, AppState } from './config.js';
import { play } from './animation.js';
import { Events, emit, clear as clearEvents } from './events.js';
import { dealDamageToEnemy, dealDamageToBoss, processMeleeCombat, dealDamageToPlayer, initCombat, processPlayerMeleeOnBoss } from './combat.js';
import { cleanupDeadEnemies, processEnemyTurns, markThreatMapsDirty } from './enemyAI.js';
import { processBossTurn } from './bossAI.js';
import { createPRNG, generateArenaObject } from './utils.js';
import { startTutorial, stopTutorial, updateTutorial, isClickAllowed } from './tutorial.js';

let _onStateChange = () => {};
let _deathType = 'damage'; // 'damage' или 'exhaustion'

function getRowY(y, totalRows) {
  const regularRows = totalRows - 2;
  if (y < regularRows) {
    return y * DIMS.CELL_SIZE;
  }
  return (regularRows * DIMS.CELL_SIZE) + ((y - regularRows) * DIMS.CELL_SIZE * 2);
}

export function initRun(callback) {
  _onStateChange = callback;
  initCombat(callback);
}

export function getDeathType() {
  return _deathType;
}

function checkIfPlayerStuck() {
  const { runState } = getGameState();
  if (!runState || runState.levelPhase !== 'dungeon') return false;
  
  const { player, rows } = runState;
  const targetY = player.pos.y + 1;
  
  // Проверяем, есть ли доступные ходы
  if (targetY >= rows.length) return false; // Достигли конца
  
  let hasValidMove = false;
  
  for (let x = 0; x < DIMS.COLS; x++) {
    const targetCell = rows[targetY][x];
    if (targetCell.type === OBJECT_TYPES.WALL) continue;
    
    const moveDistance = Math.abs(x - player.pos.x);
    const energyCost = Math.max(0, moveDistance - 1);
    
    if (player.energy >= energyCost) {
      hasValidMove = true;
      break;
    }
  }
  
  if (!hasValidMove) {
    console.log('[STUCK] Player is stuck without energy!');
    _deathType = 'exhaustion';
    setAppState(AppState.RUN_SUMMARY, _onStateChange);
    return true;
  }
  
  return false;
}

export function startRun(levelId) {
  // Останавливаем туториал перед стартом любого уровня
  stopTutorial();
  
  clearEvents();
  markThreatMapsDirty();
  emit(Events.RUN_STARTED, { levelId });

  const levelData = getLevelById(levelId);
  if (!levelData) {
    console.error(`Level with id "${levelId}" not found!`);
    return;
  }

  const state = getGameState();
  
  const urlParams = new URLSearchParams(window.location.search);
  const seed = parseInt(urlParams.get('seed'), 10) || Date.now();
  const random = createPRNG(seed);

  const initialRows = [];
  
  if (levelData.isTutorial && levelData.layout) {
    // Фиксированный layout для tutorial
    for (let y = 0; y < levelData.layout.length; y++) {
      const row = [];
      for (let x = 0; x < DIMS.COLS; x++) {
        const cellDef = levelData.layout[y][x] || {};
        let type = cellDef.type ? OBJECT_TYPES[cellDef.type.toUpperCase()] : OBJECT_TYPES.EMPTY;
        let data = cellDef.data || null;
        
        if (type === OBJECT_TYPES.ENEMY) {
          const enemyType = cellDef.enemyType || 'TYPE_1';
          data = { 
            ...ENEMY_DEFS[enemyType], 
            currentHp: ENEMY_DEFS[enemyType].hp
          };
        } else if (type === OBJECT_TYPES.ATTACK_BONUS && !data) {
          data = { value: CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].value };
        } else if (type === OBJECT_TYPES.DEFENSE_BONUS && !data) {
          data = { value: CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].value };
        }
        
        row.push({ 
          type, 
          data,
          visual: { x: x * DIMS.CELL_SIZE, y: getRowY(y, levelData.rows), alpha: 1.0 },
          isAnimating: false
        });
      }
      initialRows.push(row);
    }
    startTutorial();
  } else {
    // Процедурная генерация
    const { ENEMY, WALL, HEAL, AMMO, ENERGY, ATTACK_BONUS, DEFENSE_BONUS, GOLD } = levelData.chances;

  for (let y = 0; y < levelData.rows; y++) {
    const row = [];
    for (let x = 0; x < DIMS.COLS; x++) {
      let type = OBJECT_TYPES.EMPTY, data = null;
      if (y > 0 && y < levelData.rows - 2) {
        const rand = random();

        if (rand < ENEMY) {
          type = OBJECT_TYPES.ENEMY;
          const enemyKeys = Object.keys(ENEMY_DEFS);
          const enemyType = enemyKeys[Math.floor(random() * enemyKeys.length)];
          data = { 
            ...ENEMY_DEFS[enemyType], 
            currentHp: ENEMY_DEFS[enemyType].hp,
          };
        } else if (rand < ENEMY + WALL) {
          type = OBJECT_TYPES.WALL;
        } else if (rand < ENEMY + WALL + HEAL) {
          type = OBJECT_TYPES.HEAL;
        } else if (rand < ENEMY + WALL + HEAL + AMMO) {
          type = OBJECT_TYPES.AMMO;
        } else if (rand < ENEMY + WALL + HEAL + AMMO + ENERGY) {
          type = OBJECT_TYPES.ENERGY;
        } else if (rand < ENEMY + WALL + HEAL + AMMO + ENERGY + ATTACK_BONUS) {
          type = OBJECT_TYPES.ATTACK_BONUS;
          data = { value: CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].value };
        } else if (rand < ENEMY + WALL + HEAL + AMMO + ENERGY + ATTACK_BONUS + DEFENSE_BONUS) {
          type = OBJECT_TYPES.DEFENSE_BONUS;
          data = { value: CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].value };
        } else if (rand < ENEMY + WALL + HEAL + AMMO + ENERGY + ATTACK_BONUS + DEFENSE_BONUS + (GOLD || 0)) {
          type = OBJECT_TYPES.GOLD;
        }
      } else if (y >= levelData.rows - 2) {
        const newObject = generateArenaObject(x, y, levelData.rows, random, 1.0);
        type = newObject.type;
        data = newObject.data;
      }
      row.push({ 
        type, 
        data,
        visual: { x: x * DIMS.CELL_SIZE, y: getRowY(y, levelData.rows), alpha: 1.0 },
        isAnimating: false,
      });
    }
    
    // Проверка: хотя бы одна клетка должна быть проходимой
    if (y > 0 && y < levelData.rows - 2) {
      const allWalls = row.every(cell => cell.type === OBJECT_TYPES.WALL);
      if (allWalls) {
        // Освобождаем среднюю клетку
        row[2].type = OBJECT_TYPES.EMPTY;
        row[2].data = null;
      }
    }
    
    initialRows.push(row);
  }
  }

  const bossHpMultiplier = levelData.bossHpMultiplier || 2.5;
  const playerBaseHp = 20;
  const bossData = {
    hp: Math.round(playerBaseHp * bossHpMultiplier),
    currentHp: Math.round(playerBaseHp * bossHpMultiplier),
    label: 'БОСС',
    color: '#FF58F4',
  };

  const bossX = 2;
  const bossY = levelData.rows - 1;
  const bossCell = initialRows[bossY][bossX];
  bossCell.type = OBJECT_TYPES.BOSS;
  bossCell.data = bossData;

  const boss = {
    ...bossData,
    pos: { x: bossX, y: bossY },
    inventory: {
      attackBonuses: [],
      defenseBonuses: [],
    },
    lastMoveX: null,
  };
  const startPos = { x: 2, y: 0 };
  state.runState = {
    seed: seed,
    levelId: levelId,
    totalRows: levelData.rows,
    rows: initialRows,
    boss: boss,
    goldCollected: 0,
    player: {
      hp: 20,
      maxHp: 20,
      energy: 10,
      maxEnergy: 10,
      pos: { ...startPos },
      inventory: {
        weapon: { type: 'crossbow', range: 3, damage: 3 },
        ammo: 3,
        maxAmmo: 3,
        attackBonuses: [],
        defenseBonuses: [],
      },
      hasShotOnCurrentRow: false,
      visual: {
        x: startPos.x * DIMS.CELL_SIZE,
        y: startPos.y * DIMS.CELL_SIZE,
        h: DIMS.CELL_SIZE,
      }
    },
    scrollY: 0,
    targetScrollY: 0,
    floatingTexts: [],
    levelPhase: 'dungeon',
    turnOwner: 'player',
  };

  console.log(`Starting run for level: ${levelData.name}`, state.runState);
  emit(Events.RUN_STARTED, { levelId, seed });
}

export function processPlayerAction(gx, gy) {
  const state = getGameState();
  const { runState } = state;
  if (!runState) return;
  const { player, rows } = runState;

  console.log(`[PLAYER_ACTION] Click at (${gx},${gy}), turnOwner: ${runState.turnOwner}`);

  if (runState.turnOwner !== 'player') {
    console.log('[PLAYER_ACTION] Not player turn, ignoring click');
    return;
  }
  
  if (!isClickAllowed(gx, gy)) return;

  if (runState.levelPhase === 'dungeon') {
    const targetCellForShot = rows[gy]?.[gx];
    const distance = Math.abs(gx - player.pos.x);
    const isShotAction = gy === player.pos.y && targetCellForShot?.type === OBJECT_TYPES.ENEMY;

    if (isShotAction) {
      const canShoot = !player.hasShotOnCurrentRow && distance > 0 && distance <= player.inventory.weapon.range && player.inventory.ammo > 0;
      if (canShoot) {
        let isBlocked = false;
        const direction = Math.sign(gx - player.pos.x);
        for (let i = 1; i < distance; i++) {
          if (rows[gy][player.pos.x + i * direction].type === OBJECT_TYPES.WALL) {
            isBlocked = true;
            break;
          }
        }
        if (isBlocked) return;

        processPlayerShot(targetCellForShot);
      }
    } else if (gy === player.pos.y + 1 && gy < rows.length) {
      processPlayerMove(gx, gy);
    }
  } else {
    const targetCell = rows[gy]?.[gx];
    const isMovingHorizontally = gy === player.pos.y && gx !== player.pos.x;
    const isTargetingBoss = targetCell?.type === OBJECT_TYPES.BOSS;

    if (isMovingHorizontally) {
      processPlayerMove(gx, gy);
    } else if (isTargetingBoss && !player.hasShotOnCurrentRow) {
      const distance = Math.abs(gx - player.pos.x);
      if (player.inventory.ammo > 0 && distance > 0 && distance <= player.inventory.weapon.range) {
        processPlayerShotOnBoss(targetCell);
      }
    }
  }
}

function processPlayerMove(targetX, targetY) {
  const { runState } = getGameState();
  const { player, rows } = runState;
  const targetCell = rows[targetY][targetX];

  console.log(`[PLAYER_MOVE] Moving from (${player.pos.x},${player.pos.y}) to (${targetX},${targetY})`);
  
  // Проверяем, разрешен ли ход в туториале
  if (!isClickAllowed(targetX, targetY)) {
    console.log('[PLAYER_MOVE] Move not allowed by tutorial');
    return;
  }

  const moveDistance = Math.abs(targetX - player.pos.x);
  const energyCost = Math.max(0, moveDistance - 1);

  if (player.energy < energyCost) {
    console.log(`Not enough energy. Have: ${player.energy}, Need: ${energyCost}`);
    return;
  }
  player.energy -= energyCost;

  if (runState.levelPhase === 'dungeon' && targetY >= runState.totalRows - 2) {
    runState.levelPhase = 'boss_arena';
    console.log("[PHASE] Entering Boss Arena phase!");
    emit(Events.PHASE_CHANGED, { phase: 'boss_arena' });
  }

  if (runState.levelPhase === 'boss_arena') {
    const previousCell = rows[player.pos.y][player.pos.x];
    if (previousCell.type === OBJECT_TYPES.EMPTY) {
      const random = createPRNG(runState.seed + player.pos.x * player.pos.y + runState.player.hp);
      const playerHpPercent = player.hp / player.maxHp;
      const { type: newType, data: newData } = generateArenaObject(player.pos.x, player.pos.y, runState.totalRows, random, playerHpPercent);
      previousCell.type = newType; previousCell.data = newData;
    }
  }

  if (targetY >= runState.totalRows - 2) {
    runState.targetScrollY = getRowY(runState.totalRows - 2, runState.totalRows);
  }

  runState.turnOwner = 'processing';
  console.log('[TURN] turnOwner = processing');

  if (targetCell.type === OBJECT_TYPES.WALL) {
    return;
  }

  const targetHeight = (targetY >= runState.totalRows - 2) ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE;

  play({
    target: player,
    props: {
      'visual.x': targetX * DIMS.CELL_SIZE,
      'visual.y': getRowY(targetY, runState.totalRows),
      'visual.h': targetHeight,
    },
    duration: 250,
    onComplete: () => {
      const previousY = player.pos.y;
      const previousX = player.pos.x;
      player.pos.x = targetX;
      player.pos.y = targetY;
      
      console.log(`[PLAYER_MOVE] Animation complete, now at (${targetX},${targetY}), interacting with ${targetCell.type}`);

      let turnHandedOverToBoss = false;

      switch (targetCell.type) {
        case OBJECT_TYPES.HEAL: {
          const healAmount = targetCell.data?.amount || CELL_DEFS[OBJECT_TYPES.HEAL].amount;
          const oldHp = player.hp;
          player.hp = Math.min(player.maxHp, oldHp + healAmount);
          const actualHealed = player.hp - oldHp;

          if (actualHealed > 0) {
            createFloatingText(`+${actualHealed}`, '#10b981', player.visual);
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.AMMO: {
          const ammoAmount = CELL_DEFS[OBJECT_TYPES.AMMO].amount;
          const oldAmmo = player.inventory.ammo;
          player.inventory.ammo = Math.min(player.inventory.maxAmmo, oldAmmo + ammoAmount);
          const actualAdded = player.inventory.ammo - oldAmmo;
          if (actualAdded > 0) {
            createFloatingText(`+${actualAdded} з.`, '#f59e0b', player.visual);
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.ENERGY: {
          const energyAmount = CELL_DEFS[OBJECT_TYPES.ENERGY].amount;
          const oldEnergy = player.energy;
          player.energy = Math.min(player.maxEnergy, oldEnergy + energyAmount);
          const actualAdded = player.energy - oldEnergy;
          if (actualAdded > 0) {
            createFloatingText(`+${actualAdded} э.`, '#3b82f6', player.visual);
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.GOLD: {
          const goldAmount = targetCell.data?.amount || CELL_DEFS[OBJECT_TYPES.GOLD].amount;
          runState.goldCollected += goldAmount;
          createFloatingText(`+${goldAmount} з.`, CELL_DEFS[OBJECT_TYPES.GOLD].color, player.visual);
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.ATTACK_BONUS: {
          if (player.inventory.attackBonuses.length < 2) {
            player.inventory.attackBonuses.push({ ...targetCell.data });
            createFloatingText(`+${targetCell.data.value} атк.`, CELL_DEFS.attack_bonus.color, player.visual);
            emit(Events.ITEM_PICKED, { type: 'attack_bonus', value: targetCell.data.value });
          } else {
            createFloatingText('ПОЛНО', '#6b7280', player.visual);
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: { 'visual.alpha': 0 },
              duration: 300,
              onComplete: () => {}
            });
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.DEFENSE_BONUS: {
          if (player.inventory.defenseBonuses.length < 2) {
            player.inventory.defenseBonuses.push({ ...targetCell.data });
            createFloatingText(`+${targetCell.data.value} защ.`, CELL_DEFS.defense_bonus.color, player.visual);
            emit(Events.ITEM_PICKED, { type: 'defense_bonus', value: targetCell.data.value });
          } else {
            createFloatingText('ПОЛНО', '#6b7280', player.visual);
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: { 'visual.alpha': 0 },
              duration: 300,
              onComplete: () => {}
            });
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.ATTACK_CELL: {
          const cellDamage = targetCell.data.value;
          const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
          const totalDamage = cellDamage + bonusDamage;
          
          // Рассчитываем фактический урон (с учетом защиты босса)
          let damageAfterDefense = totalDamage;
          for (const defBonus of runState.boss.inventory.defenseBonuses) {
            damageAfterDefense -= defBonus.value;
            if (damageAfterDefense <= 0) break;
          }
          const actualDamage = Math.max(0, Math.min(damageAfterDefense, runState.boss.currentHp));
          
          // СНАЧАЛА тратятся бонусы атаки
          let remainingDamage = actualDamage;
          
          for (let i = player.inventory.attackBonuses.length - 1; i >= 0 && remainingDamage > 0; i--) {
            const bonus = player.inventory.attackBonuses[i];
            const consumedAmount = Math.min(remainingDamage, bonus.value);
            
            bonus.value -= consumedAmount;
            remainingDamage -= consumedAmount;

            if (bonus.value <= 0) {
              player.inventory.attackBonuses.splice(i, 1);
            }
          }
          
          const originalY = player.visual.y;
          play({
            target: player,
            props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.5 },
            duration: 150,
            onComplete: () => {
              const finalTotalDamage = cellDamage + player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
              dealDamageToBoss(finalTotalDamage);
              const bossCell = rows[runState.boss.pos.y][runState.boss.pos.x];
              createFloatingText(`-${finalTotalDamage}`, '#ef4444', bossCell.visual);
              play({
                target: player,
                props: { 'visual.y': originalY },
                duration: 150,
                onComplete: () => {
                  if (!turnHandedOverToBoss) {
                    setTimeout(processBossTurn, 300);
                    turnHandedOverToBoss = true;
                  }
                }
              });
            }
          });
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          break;
        }
        case OBJECT_TYPES.ENEMY: {
          const didPlayerWin = processMeleeCombat(targetCell);

          if (targetCell.data && targetCell.data.currentHp <= 0) {
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: { 
                'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5,
                'visual.alpha': 0 
              },
              duration: 700,
              onComplete: () => {}
            });
            continuePlayerTurnAfterInteraction(previousY, previousX, targetY);
          } else {
            play({
              target: targetCell,
              props: { 'visual.y': targetCell.visual.y + 10 },
              duration: 100,                
              onComplete: () => {
                setAppState(AppState.RUN_SUMMARY, _onStateChange);
              }
            });
          }
          break;
        }
        default: {
          // Пустая клетка или другой тип - ничего не делаем
          console.log(`[PLAYER_MOVE] Landed on ${targetCell.type}, no special interaction`);
          break;
        }
      }

      if (runState.levelPhase === 'boss_arena' && !turnHandedOverToBoss) {
        const canMelee = player.inventory.attackBonuses.length > 0 && runState.boss.pos.x === player.pos.x;
        console.log(`[BOSS_ARENA] Checking melee: canMelee=${canMelee}, turnHandedOver=${turnHandedOverToBoss}`);
        if (canMelee) {
          const originalY = player.visual.y;
          play({
            target: player,
            props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.5 },
            duration: 150,
            onComplete: () => {
              processPlayerMeleeOnBoss();
              play({
                target: player,
                props: { 'visual.y': originalY },
                duration: 150,
                onComplete: () => {
                  turnHandedOverToBoss = true;
                  setTimeout(processBossTurn, 300);
                }
              });
            }
          });
        } else {
          console.log('[BOSS_ARENA] No melee, handing turn to boss');
          setTimeout(processBossTurn, 300);
          turnHandedOverToBoss = true;
        }
      }
      
      player.hasShotOnCurrentRow = false;

      if (runState.levelPhase === 'dungeon') {
        const rowPlayerLeft = previousY;
        const colPlayerLeft = previousX;
        console.log(`[DUNGEON] Processing dungeon phase, targetCell.type=${targetCell.type}`);
        if (targetCell.type !== OBJECT_TYPES.ENEMY) {
          continuePlayerTurnAfterInteraction(rowPlayerLeft, colPlayerLeft, targetY);
        } else {
          console.log('[DUNGEON] Enemy combat, turn already handled');
        }
      }
      
      updateTutorial();
    }
  });
}

function processPlayerShot(targetCell) {
  const { runState } = getGameState();
  const { player } = runState;

  player.hasShotOnCurrentRow = true;
  player.inventory.ammo--;

  console.log('[TUTORIAL] Player shot, ammo:', player.inventory.ammo);

  const enemy = targetCell.data;
  const weaponDamage = player.inventory.weapon.damage;
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = weaponDamage + bonusDamage;
  
  // Рассчитываем фактический урон
  const actualDamage = Math.min(totalDamage, enemy.currentHp);
  
  // СНАЧАЛА тратятся бонусы атаки, потом урон оружия
  let remainingDamage = actualDamage;
  
  for (let i = player.inventory.attackBonuses.length - 1; i >= 0 && remainingDamage > 0; i--) {
    const bonus = player.inventory.attackBonuses[i];
    const consumedAmount = Math.min(remainingDamage, bonus.value);
    
    bonus.value -= consumedAmount;
    remainingDamage -= consumedAmount;

    if (bonus.value <= 0) {
      player.inventory.attackBonuses.splice(i, 1);
    }
  }

  play({
    target: targetCell,
    props: { 'visual.alpha': 0.5 },
    duration: 100,
    onComplete: () => {
      play({
        target: targetCell,
        props: { 'visual.alpha': 1.0 },
        duration: 100,
        onComplete: () => {
          const totalDamage = weaponDamage + player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
          dealDamageToEnemy(targetCell, totalDamage, false);

          if (enemy && enemy.currentHp <= 0) {
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: {
                'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5,
                'visual.alpha': 0,
              },
              duration: 700,
              onComplete: () => {
                targetCell.type = OBJECT_TYPES.EMPTY;
                targetCell.data = null;
                updateTutorial();
              }
            });
          } else {
            runState.turnOwner = 'player';
            updateTutorial();
          }
        }
      });
    }
  });
}

function processPlayerShotOnBoss(bossCell) {
  const { runState } = getGameState();
  const { player, boss } = runState;

  player.inventory.ammo--;
  player.hasShotOnCurrentRow = true;

  const weaponDamage = player.inventory.weapon.damage;
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = weaponDamage + bonusDamage;
  
  // Рассчитываем фактический урон (с учетом защиты босса)
  let damageAfterDefense = totalDamage;
  for (const defBonus of boss.inventory.defenseBonuses) {
    damageAfterDefense -= defBonus.value;
    if (damageAfterDefense <= 0) break;
  }
  const actualDamage = Math.max(0, Math.min(damageAfterDefense, boss.currentHp));
  
  // СНАЧАЛА тратятся бонусы атаки
  let remainingDamage = actualDamage;
  
  for (let i = player.inventory.attackBonuses.length - 1; i >= 0 && remainingDamage > 0; i--) {
    const bonus = player.inventory.attackBonuses[i];
    const consumedAmount = Math.min(remainingDamage, bonus.value);
    
    bonus.value -= consumedAmount;
    remainingDamage -= consumedAmount;

    if (bonus.value <= 0) {
      player.inventory.attackBonuses.splice(i, 1);
    }
  }

  play({
    target: bossCell,
    props: { 'visual.alpha': 0.5 },
    duration: 100,
    onComplete: () => {
      play({
        target: bossCell,
        props: { 'visual.alpha': 1.0 },
        duration: 100,
        onComplete: () => {
          const finalTotalDamage = weaponDamage + player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
          dealDamageToBoss(finalTotalDamage);
          createFloatingText(`-${finalTotalDamage}`, '#ef4444', bossCell.visual);
          
          // Возвращаем ход игроку, так как выстрел не заканчивает ход
          if (runState.player.hp > 0 && runState.boss.currentHp > 0) {
            runState.turnOwner = 'player';
          }
        }
      });
    }
  });
}

function continuePlayerTurnAfterInteraction(previousPlayerY, previousPlayerX, targetY) {
  const { runState } = getGameState();
  const { rows } = runState;
  console.log(`[CONTINUE_TURN] Starting, previousY=${previousPlayerY}, previousX=${previousPlayerX}, targetY=${targetY}`);
  
  processEnemyTurns(previousPlayerY, { x: previousPlayerX, y: previousPlayerY }, () => {
    console.log(`[CONTINUE_TURN] Enemy turns completed, player HP: ${runState.player.hp}`);
    
    if (runState.levelPhase === 'dungeon') {
      runState.targetScrollY = getRowY(targetY, runState.totalRows);
    }
    cleanupDeadEnemies(rows);

    if (runState.player.hp <= 0) {
      console.log("[CONTINUE_TURN] Player has been defeated. Switching to summary screen.");
      _deathType = 'damage';
      setAppState(AppState.RUN_SUMMARY, _onStateChange);
    } else {
      console.log('[TURN] Returning turn to player');
      runState.turnOwner = 'player';
      
      // Проверяем, не застрял ли игрок
      checkIfPlayerStuck();
    }
  });
}

function createFloatingText(text, color, position) {
  const { runState } = getGameState();
  const newText = {
    id: Date.now() + Math.random(),
    text,
    color,
    visual: { 
      x: position.x, 
      y: position.y + DIMS.CELL_SIZE * 0.5,
      alpha: 1.0 
    },
  };
  runState.floatingTexts.push(newText);
}
