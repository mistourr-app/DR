import { getGameState, setAppState, createRunId, isRunActive } from './state.js';
import { getLevelById, validateLevelDefinition, OBJECT_TYPES, ENEMY_DEFS, CELL_DEFS } from './registry.js';
import { DIMS, AppState } from './config.js';
import { play, clearAnimations, scheduleRunCallback, resizeAnimations } from './animation.js';
import { Events, emit, clear as clearEvents } from './events.js';
import { dealDamageToEnemy, dealDamageToBoss, processMeleeCombat, dealDamageToPlayer, initCombat, processPlayerMeleeOnBoss, calculateAndConsumeAttackBonuses } from './combat.js';
import { cleanupDeadEnemies, processEnemyTurns, markThreatMapsDirty } from './enemyAI.js';
import { processBossTurn } from './bossAI.js';
import { createPRNG, generateArenaObject, spawnArenaObject } from './utils.js';
import { startTutorial, stopTutorial, updateTutorial, isClickAllowed } from './tutorial.js';

let _onStateChange = () => {};
let _deathType = 'damage'; // 'damage' или 'exhaustion'

function getRowYForSize(y, totalRows, cellSize) {
  const regularRows = totalRows - 2;
  if (y < regularRows) {
    return y * cellSize;
  }
  return (regularRows * cellSize) + ((y - regularRows) * cellSize * 2);
}

function getRowY(y, totalRows) {
  return getRowYForSize(y, totalRows, DIMS.CELL_SIZE);
}

function getCellValue(data, fallback, minimum = 0) {
  const value = Number(data?.value ?? data?.amount);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, value);
}

function getBonusData(data, fallback) {
  return {
    ...(data && typeof data === 'object' ? data : {}),
    value: getCellValue(data, fallback, 1),
  };
}

function handOffToBoss() {
  const { runState } = getGameState();
  if (!runState || runState.bossTurnScheduled) return;
  if (runState.player.hp <= 0 || runState.boss.currentHp <= 0) return;

  const runId = runState.runId;
  runState.bossTurnScheduled = true;
  scheduleRunCallback(300, () => {
    const currentState = getGameState();
    if (!isRunActive(runId)) return;
    currentState.runState.bossTurnScheduled = false;
    processBossTurn();
  });
}

export function resizeRunVisuals(previousCellSize) {
  const { runState } = getGameState();
  if (!runState) return;

  const oldCellSize = Math.max(1, Number(previousCellSize) || 1);
  const scale = DIMS.CELL_SIZE / oldCellSize;
  const totalRows = runState.totalRows;
  const scalePosition = (visual, x, y) => {
    const baseY = getRowYForSize(y, totalRows, oldCellSize);
    const currentY = Number.isFinite(visual.y) ? visual.y : baseY;
    const currentX = Number.isFinite(visual.x) ? visual.x : x * oldCellSize;
    visual.x = x * DIMS.CELL_SIZE + (currentX - x * oldCellSize) * scale;
    visual.y = getRowYForSize(y, totalRows, DIMS.CELL_SIZE) + (currentY - baseY) * scale;
  };

  runState.rows.forEach((row, y) => {
    row.forEach((cell, x) => {
      scalePosition(cell.visual, x, y);
    });
  });

  scalePosition(runState.player.visual, runState.player.pos.x, runState.player.pos.y);
  runState.player.visual.h = Math.max(1, (runState.player.visual.h || DIMS.CELL_SIZE) * scale);
  scalePosition(runState.boss.visual, runState.boss.pos.x, runState.boss.pos.y);
  runState.scrollY *= scale;
  runState.targetScrollY *= scale;
  runState.floatingTexts.forEach((floatingText) => {
    floatingText.visual.x *= scale;
    floatingText.visual.y *= scale;
  });
  resizeAnimations(scale);
  runState.visualCellSize = DIMS.CELL_SIZE;
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
    const targetCell = rows[targetY]?.[x];
    if (!targetCell || targetCell.type === OBJECT_TYPES.WALL) continue;

    if (targetCell.type === OBJECT_TYPES.ENEMY && Math.abs(x - player.pos.x) <= 1) {
      hasValidMove = true;
      break;
    }
    
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
  clearAnimations();
  if (typeof document !== 'undefined') {
    document.getElementById('game-container')?.classList.remove('damage-flash');
  }
  _deathType = 'damage';
  stopTutorial();
  
  clearEvents();
  markThreatMapsDirty();

  const levelData = getLevelById(levelId);
  if (!levelData) {
    console.error(`Level with id "${levelId}" not found!`);
    return false;
  }

  const validation = validateLevelDefinition(levelData);
  if (!validation.valid) {
    console.error(`Level "${levelId}" is invalid: ${validation.errors.join(', ')}`);
    return false;
  }

  const state = getGameState();
  
  const urlParams = new URLSearchParams(window.location.search);
  const seedParam = urlParams.get('seed');
  const parsedSeed = seedParam === null ? NaN : Number(seedParam);
  const seed = Number.isSafeInteger(parsedSeed) ? parsedSeed : Date.now();
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
  // Стартовая клетка босса должна быть пустой — объект генерируется при первом ходе
  initialRows[bossY][bossX].type = OBJECT_TYPES.EMPTY;
  initialRows[bossY][bossX].data = null;

  const boss = {
    ...bossData,
    pos: { x: bossX, y: bossY },
    visual: { x: bossX * DIMS.CELL_SIZE },
    inventory: {
      attackBonuses: [],
      defenseBonuses: [],
    },
    lastMoveX: null,
  };
  const isDebugBoss = levelId === 'debug_boss';
  const startPos = { x: 2, y: 0 };
  state.runState = {
    runId: createRunId(),
    seed,
    random,
    levelId,
    totalRows: levelData.rows,
    rows: initialRows,
    boss,
    goldCollected: 0,
    goldCommitted: false,
    visualCellSize: DIMS.CELL_SIZE,
    player: {
      hp: 20,
      maxHp: 20,
      energy: 10,
      maxEnergy: 10,
      pos: { ...startPos },
      inventory: {
        weapon: { type: 'crossbow', range: 3, damage: 3 },
        ammo: isDebugBoss ? 10 : 3,
        maxAmmo: isDebugBoss ? 10 : 3,
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
    bossTurnScheduled: false,
  };

  console.log(`Starting run for level: ${levelData.name}`, state.runState);
  emit(Events.RUN_STARTED, { levelId, seed });
  return true;
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
      const targetCellForMove = rows[gy]?.[gx];
      // Если на целевой клетке враг — это ближний бой
      if (targetCellForMove?.type === OBJECT_TYPES.ENEMY) {
        processMeleeAttack(gx, gy);
      } else {
        processPlayerMove(gx, gy);
      }
    }
  } else {
    const targetCell = rows[gy]?.[gx];
    const isMovingHorizontally = gy === player.pos.y && gx !== player.pos.x;
    const isTargetingBoss = gy === runState.boss.pos.y && gx === runState.boss.pos.x;

    if (isMovingHorizontally) {
      processPlayerMove(gx, gy);
    } else if (isTargetingBoss && !player.hasShotOnCurrentRow) {
      const distance = Math.abs(gx - player.pos.x);
      if (player.inventory.ammo > 0 && distance <= player.inventory.weapon.range) {
        processPlayerShotOnBoss(targetCell);
      } else if (distance === 0 && player.inventory.attackBonuses.length > 0) {
        processBossMeleeAction();
      }
    }
  }
}

function processBossMeleeAction(onComplete = () => {}) {
  const { runState } = getGameState();
  if (!runState) return false;
  const { player } = runState;

  if (player.inventory.attackBonuses.length === 0) return false;

  runState.turnOwner = 'processing';
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
          onComplete();
          handOffToBoss();
        }
      });
    }
  });

  return true;
}

function processPlayerMove(targetX, targetY) {
  const { runState } = getGameState();
  const { player, rows } = runState;
  const targetCell = rows[targetY]?.[targetX];

  console.log(`[PLAYER_MOVE] Moving from (${player.pos.x},${player.pos.y}) to (${targetX},${targetY})`);
  
  if (!targetCell) {
    console.log('[PLAYER_MOVE] Target cell is outside the level');
    return;
  }

  if (!isClickAllowed(targetX, targetY)) {
    console.log('[PLAYER_MOVE] Move not allowed by tutorial');
    return;
  }

  if (targetCell.type === OBJECT_TYPES.WALL) {
    console.log('[PLAYER_MOVE] Target cell is a wall');
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

  if (targetY >= runState.totalRows - 2) {
    runState.targetScrollY = getRowY(runState.totalRows - 2, runState.totalRows);
  }

  runState.turnOwner = 'processing';
  console.log('[TURN] turnOwner = processing');

  // Сначала обрабатываем атаки врагов из текущего ряда
  const previousY = player.pos.y;
  const previousX = player.pos.x;
  
  processEnemyTurns(previousY, { x: previousX, y: previousY }, () => {
    console.log(`[PLAYER_MOVE] Enemy attacks completed, player HP: ${player.hp}`);
    
    if (player.hp <= 0) {
      console.log('[PLAYER_MOVE] Player died from enemy attacks');
      _deathType = 'damage';
      setAppState(AppState.RUN_SUMMARY, _onStateChange);
      return;
    }
    
    // Игрок жив, запускаем анимацию перемещения
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

      // Генерируем объект на клетке откуда ушёл игрок (если арена и клетка пустая)
      if (runState.levelPhase === 'boss_arena') {
        const prevCell = rows[previousY][previousX];
        console.log(`[LEAVE_CELL] (${previousX},${previousY}) type=${prevCell.type}`);
        if (prevCell.type === OBJECT_TYPES.EMPTY) {
          spawnArenaObject(prevCell, previousX, previousY, runState.totalRows, player.hp / player.maxHp, runState.random);
        }
      }
      
      console.log(`[PLAYER_MOVE] Animation complete, now at (${targetX},${targetY}), interacting with ${targetCell.type}`);

      let bossInteractionPending = false;

      switch (targetCell.type) {
        case OBJECT_TYPES.HEAL: {
          const healAmount = getCellValue(targetCell.data, CELL_DEFS[OBJECT_TYPES.HEAL].amount);
          const oldHp = player.hp;
          player.hp = Math.min(player.maxHp, oldHp + healAmount);
          const actualHealed = player.hp - oldHp;

          if (actualHealed > 0) {
            createFloatingText(`+${actualHealed}`, '#10b981', player.visual);
          }
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
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
          if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
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
          if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
          break;
        }
        case OBJECT_TYPES.GOLD: {
          const goldAmount = getCellValue(targetCell.data, CELL_DEFS[OBJECT_TYPES.GOLD].amount);
          runState.goldCollected += goldAmount;
          createFloatingText(`+${goldAmount} з.`, CELL_DEFS[OBJECT_TYPES.GOLD].color, player.visual);
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
          break;
        }
        case OBJECT_TYPES.ATTACK_BONUS: {
          if (player.inventory.attackBonuses.length < 2) {
            const bonus = getBonusData(targetCell.data, CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].value);
            player.inventory.attackBonuses.push(bonus);
            createFloatingText(`+${bonus.value} атк.`, CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color, player.visual);
            emit(Events.ITEM_PICKED, { type: 'attack_bonus', value: bonus.value });
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
          } else {
            createFloatingText('ПОЛНО', '#6b7280', player.visual);
            bossInteractionPending = runState.levelPhase === 'boss_arena';
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: { 'visual.alpha': 0 },
              duration: 300,
              onComplete: () => {
                targetCell.type = OBJECT_TYPES.EMPTY;
                targetCell.data = null;
                targetCell.isAnimating = false;
                if (runState.levelPhase === 'boss_arena') {
                  spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
                  bossInteractionPending = false;
                  handOffToBoss();
                }
              }
            });
          }
          break;
        }
        case OBJECT_TYPES.DEFENSE_BONUS: {
          if (player.inventory.defenseBonuses.length < 2) {
            const bonus = getBonusData(targetCell.data, CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].value);
            player.inventory.defenseBonuses.push(bonus);
            createFloatingText(`+${bonus.value} защ.`, CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].color, player.visual);
            emit(Events.ITEM_PICKED, { type: 'defense_bonus', value: bonus.value });
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            if (runState.levelPhase === 'boss_arena') spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
          } else {
            createFloatingText('ПОЛНО', '#6b7280', player.visual);
            bossInteractionPending = runState.levelPhase === 'boss_arena';
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: { 'visual.alpha': 0 },
              duration: 300,
              onComplete: () => {
                targetCell.type = OBJECT_TYPES.EMPTY;
                targetCell.data = null;
                targetCell.isAnimating = false;
                if (runState.levelPhase === 'boss_arena') {
                  spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
                  bossInteractionPending = false;
                  handOffToBoss();
                }
              }
            });
          }
          break;
        }
        case OBJECT_TYPES.ATTACK_CELL: {
          if (runState.levelPhase !== 'boss_arena') {
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            break;
          }

          const cellDamage = getCellValue(targetCell.data, CELL_DEFS[OBJECT_TYPES.ATTACK_CELL].value);
          const actualDamage = calculateAndConsumeAttackBonuses(
            cellDamage,
            runState.boss.currentHp,
            runState.boss.inventory.defenseBonuses,
          );
          bossInteractionPending = true;
          
          targetCell.type = OBJECT_TYPES.EMPTY;
          targetCell.data = null;
          if (runState.levelPhase === 'boss_arena') {
            spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
          }

          const originalY = player.visual.y;
          play({
            target: player,
            props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.5 },
            duration: 150,
            onComplete: () => {
              dealDamageToBoss(actualDamage);
              const bossCell = rows[runState.boss.pos.y][runState.boss.pos.x];
              if (actualDamage > 0) {
                createFloatingText(`-${actualDamage}`, '#ef4444', bossCell.visual);
              }
              play({
                target: player,
                props: { 'visual.y': originalY },
                duration: 150,
                onComplete: () => {
                  bossInteractionPending = false;
                  handOffToBoss();
                }
              });
            }
          });
          break;
        }
        case OBJECT_TYPES.ENEMY: {
          bossInteractionPending = runState.levelPhase === 'boss_arena';
          // Анимация выпадa игрока к врагу
          const playerLungeX = player.visual.x + ((targetX - player.pos.x) * DIMS.CELL_SIZE * 0.3);
          const playerLungeY = player.visual.y + DIMS.CELL_SIZE * 0.3;

          play({
            target: player,
            props: {
              'visual.x': playerLungeX,
              'visual.y': playerLungeY,
            },
            duration: 150,
            onComplete: () => {
              // Бой происходит в момент контакта
              const didPlayerWin = processMeleeCombat(targetCell);

              // Возвращаем игрока на место
              play({
                target: player,
                props: {
                  'visual.x': player.visual.x - ((targetX - player.pos.x) * DIMS.CELL_SIZE * 0.3),
                  'visual.y': player.visual.y - DIMS.CELL_SIZE * 0.3,
                },
                duration: 150,
               onComplete: () => {
                 if (player.hp <= 0) {
                   stopTutorial();
                   setAppState(AppState.RUN_SUMMARY, _onStateChange);
                   return;
                 }

                 if (targetCell.data && targetCell.data.currentHp <= 0) {
                   markThreatMapsDirty();
                 }

                 if (targetCell.data && targetCell.data.currentHp <= 0) {
                    // Враг побежден — анимация смерти
                    targetCell.isAnimating = true;
                    play({
                      target: targetCell,
                      props: {
                        'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5,
                        'visual.alpha': 0
                      },
                      duration: 700,
                      onComplete: () => {
                        targetCell.type = OBJECT_TYPES.EMPTY;
                        targetCell.data = null;
                        if (runState.levelPhase === 'dungeon') {
                          finalizeTurnAfterMove(targetY);
                        } else {
                          spawnArenaObject(targetCell, targetX, targetY, runState.totalRows, player.hp / player.maxHp, runState.random);
                          bossInteractionPending = false;
                          handOffToBoss();
                        }
                      }
                    });
                  } else {
                    // Игрок проиграл бой
                    play({
                      target: targetCell,
                      props: { 'visual.y': targetCell.visual.y + 10 },
                      duration: 100,
                      onComplete: () => {
                        setAppState(AppState.RUN_SUMMARY, _onStateChange);
                      }
                    });
                  }
                }
              });
            }
          });
          break;
        }
        default: {
          // Пустая клетка или другой тип - ничего не делаем
          console.log(`[PLAYER_MOVE] Landed on ${targetCell.type}, no special interaction`);
          break;
        }
      }

      if (runState.levelPhase === 'boss_arena' && !bossInteractionPending) {
        const canMelee = player.inventory.attackBonuses.length > 0 && runState.boss.pos.x === player.pos.x;
        console.log(`[BOSS_ARENA] Checking melee: canMelee=${canMelee}`);
        if (canMelee) {
          bossInteractionPending = true;
          processBossMeleeAction(() => {
            bossInteractionPending = false;
          });
        } else {
          console.log('[BOSS_ARENA] No melee, handing turn to boss');
          handOffToBoss();
        }
      }
      
      if (runState.levelPhase === 'dungeon') {
        console.log(`[DUNGEON] Processing dungeon phase, targetCell.type=${targetCell.type}`);
        // Для всех типов клеток кроме врага завершаем ход сразу
        // Для врага ход завершится в обработчике боя
        if (targetCell.type !== OBJECT_TYPES.ENEMY) {
          finalizeTurnAfterMove(targetY);
        } else {
          console.log('[DUNGEON] Enemy combat in progress, turn will be finalized after combat');
        }
      }
      
      updateTutorial();
      }
    });
  });
}

function processPlayerShot(targetCell) {
  const { runState } = getGameState();
  const { player } = runState;

  runState.turnOwner = 'processing';
  player.hasShotOnCurrentRow = true;
  player.inventory.ammo--;

  console.log('[TUTORIAL] Player shot, ammo:', player.inventory.ammo);

  const enemy = targetCell.data;
  const weaponDamage = player.inventory.weapon.damage;
  
  // Используем универсальную функцию
  const actualDamage = calculateAndConsumeAttackBonuses(weaponDamage, enemy.currentHp);

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
          dealDamageToEnemy(targetCell, actualDamage, false);
          
          // Сразу после нанесения урона обновляем карты угроз
          if (enemy && enemy.currentHp <= 0) {
            markThreatMapsDirty();
          }
          
          createFloatingText(`-${actualDamage}`, '#ef4444', targetCell.visual);

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
                finalizeTurnAfterMove(player.pos.y, false);
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

  console.log(`[SHOT_BOSS] player=(${player.pos.x},${player.pos.y}) boss=(${boss.pos.x},${boss.pos.y})`);
  runState.turnOwner = 'processing';
  player.inventory.ammo--;
  player.hasShotOnCurrentRow = true;

  const weaponDamage = player.inventory.weapon.damage;
  const actualDamage = calculateAndConsumeAttackBonuses(weaponDamage, boss.currentHp, boss.inventory.defenseBonuses);
  const originalBossX = boss.visual.x;

  play({
    target: boss,
    props: { 'visual.x': originalBossX - 6 },
    duration: 80,
    onComplete: () => {
      play({
        target: boss,
        props: { 'visual.x': originalBossX },
        duration: 80,
        onComplete: () => {
          dealDamageToBoss(actualDamage);
          if (actualDamage > 0 && bossCell) {
            createFloatingText(`-${actualDamage}`, '#ef4444', { x: boss.visual.x, y: bossCell.visual.y });
          }
          if (runState.player.hp > 0 && runState.boss.currentHp > 0) {
            runState.turnOwner = 'player';
          }
        }
      });
    }
  });
}

function finalizeTurnAfterMove(targetY, resetShot = true) {
  const { runState } = getGameState();
  const { rows } = runState;
  console.log(`[FINALIZE_TURN] Finalizing turn after move to row ${targetY}`);
  
  if (runState.levelPhase === 'dungeon') {
    runState.targetScrollY = getRowY(targetY, runState.totalRows);
  }
  cleanupDeadEnemies(rows);
  
  // Обновляем карты угроз после перемещения игрока
  markThreatMapsDirty();

  console.log('[TURN] Returning turn to player');
  if (resetShot) {
    runState.player.hasShotOnCurrentRow = false;
  }
  runState.turnOwner = 'player';
  
  // Проверяем, не застрял ли игрок
  checkIfPlayerStuck();
}

function createFloatingText(text, color, position) {
  const { runState } = getGameState();
  const newText = {
    id: `${runState.runId}:${runState.floatingTexts.length}`,
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

/**
 * Отдельная функция для ближнего боя (клик на врага на следующем ряду)
 * Игрок перемещается на клетку врага и дерётся
 */
function processMeleeAttack(enemyX, enemyY) {
  const { runState } = getGameState();
  if (!runState) return;

  const { player, rows } = runState;
  const targetCell = rows[enemyY]?.[enemyX];
  if (!targetCell || targetCell.type !== OBJECT_TYPES.ENEMY || !targetCell.data) return;

  const moveDistance = Math.abs(enemyX - player.pos.x);
  const energyCost = Math.max(0, moveDistance - 1);
  if (player.energy < energyCost) return;

  console.log(`[MELEE_ATTACK] Attacking enemy at (${enemyX},${enemyY})`);
  player.energy -= energyCost;

  const previousX = player.pos.x;
  const previousY = player.pos.y;
  const entersArena = enemyY >= runState.totalRows - 2;
  if (entersArena) {
    runState.levelPhase = 'boss_arena';
    runState.targetScrollY = getRowY(runState.totalRows - 2, runState.totalRows);
    emit(Events.PHASE_CHANGED, { phase: 'boss_arena' });
  }

  runState.turnOwner = 'processing';

  processEnemyTurns(previousY, { x: previousX, y: previousY }, () => {
    if (player.hp <= 0) {
      _deathType = 'damage';
      setAppState(AppState.RUN_SUMMARY, _onStateChange);
      return;
    }

    const targetHeight = entersArena ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE;
    play({
      target: player,
      props: {
        'visual.x': enemyX * DIMS.CELL_SIZE,
        'visual.y': getRowY(enemyY, runState.totalRows),
        'visual.h': targetHeight,
      },
      duration: 250,
      onComplete: () => {
        player.pos.x = enemyX;
        player.pos.y = enemyY;

        if (entersArena) {
          const previousCell = rows[previousY]?.[previousX];
          if (previousCell?.type === OBJECT_TYPES.EMPTY) {
            spawnArenaObject(previousCell, previousX, previousY, runState.totalRows, player.hp / player.maxHp, runState.random);
          }
        }

        const playerLungeY = player.visual.y - DIMS.CELL_SIZE * 0.15;
        play({
          target: player,
          props: { 'visual.y': playerLungeY },
          duration: 100,
          onComplete: () => {
            processMeleeCombat(targetCell);
            play({
              target: player,
              props: { 'visual.y': getRowY(enemyY, runState.totalRows) },
              duration: 100,
              onComplete: () => {
                if (player.hp <= 0) {
                  stopTutorial();
                  setAppState(AppState.RUN_SUMMARY, _onStateChange);
                  return;
                }

                if (targetCell.data?.currentHp <= 0) {
                  markThreatMapsDirty();
                  targetCell.isAnimating = true;
                  play({
                    target: targetCell,
                    props: {
                      'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5,
                      'visual.alpha': 0
                    },
                    duration: 700,
                    onComplete: () => {
                      targetCell.type = OBJECT_TYPES.EMPTY;
                      targetCell.data = null;
                      if (entersArena) {
                        spawnArenaObject(targetCell, enemyX, enemyY, runState.totalRows, player.hp / player.maxHp, runState.random);
                        handOffToBoss();
                      } else {
                        finalizeTurnAfterMove(enemyY);
                      }
                      updateTutorial();
                    }
                  });
                } else {
                  stopTutorial();
                  setAppState(AppState.RUN_SUMMARY, _onStateChange);
                }
              }
            });
          }
        });
      }
    });
  });
}
