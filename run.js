import { getGameState, setAppState } from './state.js';
import { getLevelById, OBJECT_TYPES, ENEMY_DEFS, CELL_DEFS } from './registry.js';
import { DIMS, AppState } from './config.js';
import { play } from './animation.js';
import { Events, emit, clear as clearEvents } from './events.js';
import { dealDamageToEnemy, dealDamageToBoss, processMeleeCombat, dealDamageToPlayer, initCombat, processPlayerMeleeOnBoss } from './combat.js';
import { cleanupDeadEnemies, processEnemyTurns, markThreatMapsDirty } from './enemyAI.js';
import { processBossTurn } from './bossAI.js';
import { createPRNG, generateArenaObject } from './utils.js';

let _onStateChange = () => {};

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

export function startRun(levelId) {
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
  const { ENEMY, WALL, HEAL, AMMO, ENERGY, ATTACK_BONUS, DEFENSE_BONUS } = levelData.chances;

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
    initialRows.push(row);
  }

  const bossHpMultiplier = levelData.bossHpMultiplier || 2.5;
  const playerBaseHp = 20;
  const bossData = {
    hp: Math.round(playerBaseHp * bossHpMultiplier),
    currentHp: Math.round(playerBaseHp * bossHpMultiplier),
    label: 'БОСС',
    color: '#c026d3',
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

  if (runState.turnOwner !== 'player') return;

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

  const moveDistance = Math.abs(targetX - player.pos.x);
  const energyCost = Math.max(0, moveDistance - 1);

  if (player.energy < energyCost) {
    console.log(`Not enough energy. Have: ${player.energy}, Need: ${energyCost}`);
    return;
  }
  player.energy -= energyCost;

  if (runState.levelPhase === 'dungeon' && targetY >= runState.totalRows - 2) {
    runState.levelPhase = 'boss_arena';
    console.log("Entering Boss Arena phase!");
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

      let turnHandedOverToBoss = false;

      switch (targetCell.type) {
        case OBJECT_TYPES.HEAL: {
          const healAmount = CELL_DEFS[OBJECT_TYPES.HEAL].amount;
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
          const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
          const totalDamage = targetCell.data.value + bonusDamage;
          player.inventory.attackBonuses = [];
          
          const originalY = player.visual.y;
          play({
            target: player,
            props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.5 },
            duration: 150,
            onComplete: () => {
              dealDamageToBoss(totalDamage);
              const bossCell = rows[runState.boss.pos.y][runState.boss.pos.x];
              createFloatingText(`-${totalDamage}`, '#ef4444', bossCell.visual);
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
      }

      if (runState.levelPhase === 'boss_arena' && !turnHandedOverToBoss) {
        const canMelee = player.inventory.attackBonuses.length > 0 && runState.boss.pos.x === player.pos.x;
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
          setTimeout(processBossTurn, 300);
          turnHandedOverToBoss = true;
        }
      }
      
      player.hasShotOnCurrentRow = false;

      if (runState.levelPhase === 'dungeon') {
        const rowPlayerLeft = previousY;
        const colPlayerLeft = previousX;
        if (targetCell.type !== OBJECT_TYPES.ENEMY) {
          continuePlayerTurnAfterInteraction(rowPlayerLeft, colPlayerLeft, targetY);
        }
      }
      if (targetCell.type !== OBJECT_TYPES.ENEMY && runState.levelPhase === 'dungeon') {
        runState.turnOwner = 'player';
      }
    }
  });
}

function processPlayerShot(targetCell) {
  const { runState } = getGameState();
  const { player } = runState;

  player.hasShotOnCurrentRow = true;
  player.inventory.ammo--;

  const enemy = targetCell.data;
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = player.inventory.weapon.damage + bonusDamage;
  
  player.inventory.attackBonuses = [];

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
              }
            });
          } else {
            runState.turnOwner = 'player';
          }
        }
      });
    }
  });
}

function processPlayerShotOnBoss(bossCell) {
  const { runState } = getGameState();
  const { player } = runState;

  player.inventory.ammo--;
  player.hasShotOnCurrentRow = true;

  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = player.inventory.weapon.damage + bonusDamage;

  player.inventory.attackBonuses = [];

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
          dealDamageToBoss(totalDamage);
          createFloatingText(`-${totalDamage}`, '#ef4444', bossCell.visual);
          
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
  processEnemyTurns(previousPlayerY, { x: previousPlayerX, y: previousPlayerY }, () => {
    if (runState.levelPhase === 'dungeon') {
      runState.targetScrollY = getRowY(targetY, runState.totalRows);
    }
    cleanupDeadEnemies(rows);

    if (runState.player.hp <= 0) {
      console.log("Player has been defeated. Switching to summary screen.");
      setAppState(AppState.RUN_SUMMARY, _onStateChange);
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
