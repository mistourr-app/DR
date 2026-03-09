import { getGameState, setAppState } from './state.js';
import { getLevelById, OBJECT_TYPES, ENEMY_DEFS, CELL_DEFS } from './registry.js';
import { DIMS, AppState } from './config.js';
import { play } from './animation.js';

// Глобальный колбэк для смены состояния. Устанавливается через initRun.
let _onStateChange = () => {};

/**
 * Простой генератор псевдослучайных чисел (PRNG) на основе LCG.
 * @param {number} seed - Начальное значение.
 * @returns {function(): number} - Функция, возвращающая число от 0 до 1.
 */
function createPRNG(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/**
 * Генерирует объекты для арены босса.
 * @param {Array<object>} row - Ряд для заполнения.
 * @param {boolean} isPlayerRow - Является ли это рядом игрока.
 * @param {function} random - PRNG функция.
 */
function generateNewArenaObject(x, y, totalRows, random) {
  const isPlayerRow = y === totalRows - 2;
  const chances = { ATTACK_CELL: 0.35, ATTACK_BONUS: 0.25, DEFENSE_BONUS: 0.25, HEAL: 0.15 };
  if (isPlayerRow) {
    chances.AMMO = 0.05;
    chances.ENERGY = 0.05;
  }

  // Нормализуем шансы, чтобы их сумма была равна 1, и пустые клетки не генерировались
  const totalChance = Object.values(chances).reduce((sum, chance) => sum + chance, 0);
  const normalizedChances = {};
  for (const key in chances) {
    normalizedChances[key] = chances[key] / totalChance;
  }

  const rand = random(); // Случайное число от 0 до 1
  let cumulativeChance = 0;

  // Проходим по нормализованным шансам
  for (const key in normalizedChances) {
    if (rand < (cumulativeChance += normalizedChances[key])) {
      const type = OBJECT_TYPES[key];
      let data = null;
      // Для бонусов и клеток атаки нужно добавить значение
      if (type === OBJECT_TYPES.ATTACK_BONUS || type === OBJECT_TYPES.DEFENSE_BONUS || type === OBJECT_TYPES.ATTACK_CELL) {
        data = { value: CELL_DEFS[type].value };
      }
      return { type, data };
    }
  }

  // В качестве запасного варианта, если что-то пошло не так (хотя не должно)
  const fallbackType = OBJECT_TYPES.ATTACK_CELL;
  return { type: fallbackType, data: { value: CELL_DEFS[fallbackType].value } };
}

function getRowY(y, totalRows) {
  const regularRows = totalRows - 2;
  if (y < regularRows) {
    return y * DIMS.CELL_SIZE;
  }
  // Для рядов арены: высота всех обычных рядов + смещение внутри арены
  return (regularRows * DIMS.CELL_SIZE) + ((y - regularRows) * DIMS.CELL_SIZE * 2);
}

/**
 * Устанавливает глобальный колбэк смены состояния из main.js.
 * @param {function} callback
 */
export function initRun(callback) {
  _onStateChange = callback;
}

/**
 * Начинает новый забег, инициализируя runState.
 * @param {string} levelId - ID уровня для запуска.
 */
export function startRun(levelId) {
  const levelData = getLevelById(levelId);
  if (!levelData) {
    console.error(`Level with id "${levelId}" not found!`);
    return;
  }

  const state = getGameState();
  
  // Используем seed из URL или генерируем случайный
  const urlParams = new URLSearchParams(window.location.search);
  const seed = parseInt(urlParams.get('seed'), 10) || Date.now();
  const random = createPRNG(seed);

  // Генерируем ряды на основе шансов уровня
  const initialRows = [];
  const { ENEMY, WALL, HEAL, AMMO, ENERGY, ATTACK_BONUS, DEFENSE_BONUS } = levelData.chances;

  for (let y = 0; y < levelData.rows; y++) {
    const row = [];
    for (let x = 0; x < DIMS.COLS; x++) {
      let type = OBJECT_TYPES.EMPTY, data = null;
      // Генерация начинается со второго ряда (y > 0) и заканчивается за 2 ряда до конца.
      // Последние два ряда зарезервированы для арены босса.
      if (y > 0 && y < levelData.rows - 2) {
        const rand = random();

        if (rand < ENEMY) {
          type = OBJECT_TYPES.ENEMY;
          // Улучшенная логика: выбираем случайного врага из всех доступных в ENEMY_DEFS
          const enemyKeys = Object.keys(ENEMY_DEFS);
          const enemyType = enemyKeys[Math.floor(random() * enemyKeys.length)];
          // Глубокое клонирование, чтобы избежать изменения оригинального объекта в регистре
          data = { 
            ...ENEMY_DEFS[enemyType], 
            currentHp: ENEMY_DEFS[enemyType].hp,
            aiState: 'idle', // Начальное состояние
            originalPos: { x, y }, // Запоминаем исходную позицию для анимаций
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
        // --- Генерация объектов на арене босса ---
        const isPlayerRow = y === levelData.rows - 2;
        const newObject = generateNewArenaObject(x, y, levelData.rows, random);
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

  // Создаем босса
  const bossHpMultiplier = levelData.bossHpMultiplier || 2.5; // Значение по умолчанию, если не задано
  const playerBaseHp = 20;
  const bossData = {
    hp: Math.round(playerBaseHp * bossHpMultiplier),
    currentHp: Math.round(playerBaseHp * bossHpMultiplier),
    label: 'БОСС',
    color: '#c026d3', // Fuchsia
  };

  // Размещаем босса на последнем ряду
  const bossX = 2; // Центр
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
  };
  const startPos = { x: 2, y: 0 };
  // Создаем и сбрасываем состояние для нового забега
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
      pos: { ...startPos }, // Логическая позиция
      inventory: {
        weapon: { type: 'crossbow', range: 3, damage: 3 }, // Урон арбалета, как в вашем примере
        ammo: 3,
        maxAmmo: 3,
        attackBonuses: [],
        defenseBonuses: [],
      },
      hasShotOnCurrentRow: false,
      visual: { // Визуальная позиция для рендера
        x: startPos.x * DIMS.CELL_SIZE,
        y: startPos.y * DIMS.CELL_SIZE,
        h: DIMS.CELL_SIZE,
      }
    },
    scrollY: 0, // Начальная позиция камеры
    targetScrollY: 0, // Целевая позиция камеры для плавной анимации
    floatingTexts: [], // Массив для всплывающих цифр урона/лечения
    levelPhase: 'dungeon', // 'dungeon' | 'boss_arena'
    turnOwner: 'player', // 'player' | 'boss'
  };

  console.log(`Starting run for level: ${levelData.name}`, state.runState);
}

/**
 * Обрабатывает попытку игрока переместиться на указанную клетку.
 * @param {number} gx 
 * @param {number} gy 
 */
export function processPlayerAction(gx, gy) {
  const state = getGameState();
  const { runState } = state;
  if (!runState) return;
  const { player, rows } = runState;

  // Блокируем ввод, если сейчас не ход игрока
  if (runState.turnOwner !== 'player') return;

  if (runState.levelPhase === 'dungeon') {
    // --- Логика фазы "Подземелье" ---
    const targetCellForShot = rows[gy]?.[gx];
    const distance = Math.abs(gx - player.pos.x);
    const isShotAction = gy === player.pos.y && targetCellForShot?.type === OBJECT_TYPES.ENEMY;

    if (isShotAction) {
      // Проверяем условия для выстрела
      const canShoot = !player.hasShotOnCurrentRow && distance > 0 && distance <= player.inventory.weapon.range && player.inventory.ammo > 0;
      if (canShoot) {
        // Проверяем, нет ли стены на пути
        let isBlocked = false;
        const direction = Math.sign(gx - player.pos.x);
        for (let i = 1; i < distance; i++) {
          if (rows[gy][player.pos.x + i * direction].type === OBJECT_TYPES.WALL) {
            isBlocked = true;
            break;
          }
        }
        if (isBlocked) return; // Не стреляем через стену

        processPlayerShot(targetCellForShot);
      }
    } else if (gy === player.pos.y + 1 && gy < rows.length) {
      // Если не выстрел, проверяем, является ли целью перемещение
      processPlayerMove(gx, gy);
    }
  } else {
    // --- Логика фазы "Арена босса" ---    
    const targetCell = rows[gy]?.[gx];
    const isMovingHorizontally = gy === player.pos.y && gx !== player.pos.x;
    const isTargetingBoss = targetCell?.type === OBJECT_TYPES.BOSS;

    if (isMovingHorizontally) {
      // 1. Обработка горизонтального перемещения
      processPlayerMove(gx, gy);
    } else if (isTargetingBoss) {
      // 2. Обработка атаки на босса
      if (player.inventory.ammo > 0) {
        // Иначе, если есть заряды, стреляем
        // Передаем клетку босса напрямую
        processPlayerShotOnBoss(targetCell);
      }
    }
  }
}

function processPlayerMove(targetX, targetY) {
  const { runState } = getGameState();
  const { player, rows } = runState;
  const targetCell = rows[targetY][targetX];

  // --- Проверка и списание энергии ---
  const moveDistance = Math.abs(targetX - player.pos.x);
  const energyCost = Math.max(0, moveDistance - 1); // Перемещение на соседнюю клетку (distance=1) стоит 0

  if (player.energy < energyCost) {
    // TODO: Показать сообщение "НЕДОСТАТОЧНО ЭНЕРГИИ"
    console.log(`Not enough energy. Have: ${player.energy}, Need: ${energyCost}`);
    return;
  }
  player.energy -= energyCost;

  // Проверяем, не пора ли переключиться в фазу арены, ПОСЛЕ того как ход сделан
  if (runState.levelPhase === 'dungeon' && targetY >= runState.totalRows - 2) {
    runState.levelPhase = 'boss_arena';
    console.log("Entering Boss Arena phase!");
  }

  // Если мы на арене, и это перемещение, то на покинутой клетке нужно сгенерировать новый объект
  if (runState.levelPhase === 'boss_arena') {
    const previousCell = rows[player.pos.y][player.pos.x];
    // Проверяем, что клетка пуста (т.е. мы на ней стояли и подобрали объект в прошлый ход)
    if (previousCell.type === OBJECT_TYPES.EMPTY) {
      const random = createPRNG(runState.seed + player.pos.x * player.pos.y + runState.player.hp);
      const { type: newType, data: newData } = generateNewArenaObject(player.pos.x, player.pos.y, runState.totalRows, random);
      previousCell.type = newType; previousCell.data = newData;
    }
  }

  // Скроллим камеру, как только игрок ступает на предпоследний ряд
  if (targetY >= runState.totalRows - 2) {
    runState.targetScrollY = getRowY(runState.totalRows - 2, runState.totalRows);
  }

  runState.turnOwner = 'processing'; // Блокируем ввод на время анимации

    // Проверка на стены
    if (targetCell.type === OBJECT_TYPES.WALL) {
      // TODO: Показать сообщение "ПУТЬ ЗАБЛОКИРОВАН"
      return;
    }

    const targetHeight = (targetY >= runState.totalRows - 2) ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE;

    // Запускаем анимацию движения
    play({
      target: player,
      props: {
        'visual.x': targetX * DIMS.CELL_SIZE,
        'visual.y': getRowY(targetY, runState.totalRows),
        'visual.h': targetHeight,
      },
      duration: 250, // мс
      onComplete: () => {
        // Эта логика выполнится ПОСЛЕ завершения анимации
        const previousY = player.pos.y; // Запоминаем старую Y-координату
        player.pos.x = targetX;
        player.pos.y = targetY;

        let turnHandedOverToBoss = false;

        // --- Взаимодействие с объектами на клетке ---
        switch (targetCell.type) {
          case OBJECT_TYPES.HEAL: {
            const healAmount = 6;
            const oldHp = player.hp;
            player.hp = Math.min(player.maxHp, oldHp + healAmount);
            const actualHealed = player.hp - oldHp;

            if (actualHealed > 0) {
              createFloatingText(`+${actualHealed}`, '#10b981', player.visual);
            }
            // Клетка всегда становится пустой после подбора
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            break;
          }
          case OBJECT_TYPES.AMMO: {
            const ammoAmount = 2;
            const oldAmmo = player.inventory.ammo;
            player.inventory.ammo = Math.min(player.inventory.maxAmmo, oldAmmo + ammoAmount);
            const actualAdded = player.inventory.ammo - oldAmmo;
            if (actualAdded > 0) {
              createFloatingText(`+${actualAdded} з.`, '#f59e0b', player.visual);
            }
            // Клетка всегда становится пустой после подбора
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            break;
          }
          case OBJECT_TYPES.ENERGY: {
            const energyAmount = 10;
            const oldEnergy = player.energy;
            player.energy = Math.min(player.maxEnergy, oldEnergy + energyAmount);
            const actualAdded = player.energy - oldEnergy;
            if (actualAdded > 0) {
              createFloatingText(`+${actualAdded} э.`, '#3b82f6', player.visual);
            }
            // Клетка всегда становится пустой после подбора
            targetCell.type = OBJECT_TYPES.EMPTY;
            targetCell.data = null;
            break;
          }
          case OBJECT_TYPES.ATTACK_BONUS: {
            if (player.inventory.attackBonuses.length < 2) {
              player.inventory.attackBonuses.push({ ...targetCell.data });
              createFloatingText(`+${targetCell.data.value} атк.`, CELL_DEFS.attack_bonus.color, player.visual);

              // Клетка всегда становится пустой после подбора
              targetCell.type = OBJECT_TYPES.EMPTY;
              targetCell.data = null;
            }
            break;
          }
          case OBJECT_TYPES.DEFENSE_BONUS: {
            if (player.inventory.defenseBonuses.length < 2) {
              player.inventory.defenseBonuses.push({ ...targetCell.data });
              createFloatingText(`+${targetCell.data.value} защ.`, CELL_DEFS.defense_bonus.color, player.visual);

              // Клетка всегда становится пустой после подбора
              targetCell.type = OBJECT_TYPES.EMPTY;
              targetCell.data = null;
            }
            break;
          }
          case OBJECT_TYPES.ATTACK_CELL: {
            // Атака сработает, только если босс на противоположной клетке
            if (runState.boss.pos.x === targetX) {
              const damage = targetCell.data.value;
              dealDamageToBoss(damage);
              createFloatingText(`+${damage} атк.`, CELL_DEFS.attack_cell.color, player.visual);
              
              // Если мы еще не атаковали бонусами, то ход боссу передается после этой атаки
              if (!turnHandedOverToBoss) { // turnHandedOverToBoss будет true, если была атака бонусами
                setTimeout(processBossTurn, 300);
                turnHandedOverToBoss = true;
              }
              // Клетка становится пустой, новый объект сгенерируется при уходе
              targetCell.type = OBJECT_TYPES.EMPTY;
              targetCell.data = null;
            }
            break;
          }
          case OBJECT_TYPES.ENEMY: {
            const didPlayerWin = processMeleeCombat(targetCell);

            // Эта логика выполнится после того, как урон рассчитан
            if (targetCell.data && targetCell.data.currentHp <= 0) {
              // Враг побежден. Игрок занимает его место.
              // Запускаем анимацию исчезновения врага.
              targetCell.isAnimating = true;
              // Анимация "отлета" врага вниз
              play({
                target: targetCell,
                props: { 
                  'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5, // Улетает чуть дальше
                  'visual.alpha': 0 
                },
                duration: 700, // Анимация длится 0.7 секунды, чтобы быть медленнее скролла
                onComplete: () => {
                }
              });
              // Сразу же продолжаем ход, не дожидаясь окончания анимации
              continuePlayerTurnAfterInteraction(previousY, targetY);
            } else {
              // Враг выжил. Игрок погибает.
              // Запускаем короткую анимацию "удара" врага
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

        // --- Логика атаки на арене ПОСЛЕ подбора бонусов ---
        if (runState.levelPhase === 'boss_arena' && !turnHandedOverToBoss) {
          const canMelee = player.inventory.attackBonuses.length > 0 && runState.boss.pos.x === targetX;
          if (canMelee) {
            // Если можем атаковать бонусами, делаем это.
            // Эта функция сама передаст ход боссу.
            processPlayerMeleeOnBoss();
            turnHandedOverToBoss = true;
          }
        }
        // Если игрок перешел на новый ряд
        if (targetY > previousY) {
          player.hasShotOnCurrentRow = false;
        }

        // --- Фаза хода врагов ---
        // Эта функция запустит цепочку атак и по завершении обновит игру.
        if (runState.levelPhase === 'dungeon') {
          // В подземелье враги ходят после нашего хода, если мы не в бою
          const rowPlayerLeft = previousY;
          if (targetCell.type !== OBJECT_TYPES.ENEMY) {
            continuePlayerTurnAfterInteraction(rowPlayerLeft, targetY);
          }
        } else if (!turnHandedOverToBoss) {
          // Если мы на арене, но не атаковали (например, просто подобрали бонус),
          // то ход все равно переходит к боссу.
          // Если мы не атаковали, а переместились, ход переходит боссу
          // На арене после нашего хода ходит босс
          // Запускаем ход босса с небольшой задержкой
          setTimeout(processBossTurn, 300);
        }
        // Если мы не в бою и не на арене, возвращаем управление игроку
        if (targetCell.type !== OBJECT_TYPES.ENEMY && runState.levelPhase === 'dungeon') {
          runState.turnOwner = 'player';
        }
      }
    });
}

function processPlayerShot(targetCell) {
  const { runState } = getGameState();
  const { player } = runState;

  // Устанавливаем флаг, что выстрел на этом ряду был сделан
  player.hasShotOnCurrentRow = true;

  // Тратим заряд
  player.inventory.ammo--;

  const enemy = targetCell.data;
  // Урон = урон оружия + все бонусы атаки
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = player.inventory.weapon.damage + bonusDamage;
  
  player.inventory.attackBonuses = []; // Тратим все бонусы

  // Анимация выстрела (например, вспышка на враге)
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
          // Наносим урон после анимации
          dealDamageToEnemy(targetCell, totalDamage, false); // false, т.к. бонусы уже потрачены

          if (enemy && enemy.currentHp <= 0) {
            // Враг побежден
            targetCell.isAnimating = true;
            play({
              target: targetCell,
              props: {
                'visual.y': targetCell.visual.y - DIMS.CELL_SIZE * 1.5, // Улетает чуть дальше
                'visual.alpha': 0,
              },
              duration: 700, // Анимация длится 0.7 секунды
              onComplete: () => {
                // В отличие от ближнего боя, после выстрела ход не сдвигается.
                // Поэтому мы должны очистить данные врага немедленно после анимации,
                // чтобы его собственная зона угрозы исчезла, а зоны других врагов остались.
                targetCell.type = OBJECT_TYPES.EMPTY; // Меняем тип, чтобы рендерер не пытался рисовать врага
                targetCell.data = null; // Очищаем данные
              }
            });
          } else {
            // Если враг не убит, просто обновляем AI
            // Важно: после выстрела нужно обновить AI, чтобы враги могли среагировать.
            setTimeout(updateEnemyAI, 0);
            runState.turnOwner = 'player'; // Возвращаем ход игроку
          }
        }
      });
    }
  });
}

/**
 * Обрабатывает выстрел игрока в босса.
 * @param {object} bossCell 
 */
function processPlayerShotOnBoss(bossCell) {
  const { runState } = getGameState();
  const { player } = runState;

  player.inventory.ammo--;

  // Урон = урон оружия + все бонусы атаки
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalDamage = player.inventory.weapon.damage + bonusDamage;

  player.inventory.attackBonuses = []; // Тратим все бонусы

  // Анимация выстрела
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
          // Выстрел больше не передает ход боссу. Ход передается только после перемещения.
          // setTimeout(processBossTurn, 200); 
        }
      });
    }
  });
}
/**
 * Обрабатывает атаку игрока на босса в ближнем бою.
 * Тратит один бонус атаки.
 */
function processPlayerMeleeOnBoss() {
  const { runState } = getGameState();
  const { player, boss } = runState;

  if (player.inventory.attackBonuses.length === 0) return;

  runState.turnOwner = 'processing'; // Блокируем ввод

  // Урон = сумма всех бонусов атаки.
  const damage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  // Тратим все бонусы
  player.inventory.attackBonuses = [];

  const bossCell = runState.rows[boss.pos.y][boss.pos.x];

  // Короткая анимация "удара" игрока
  const originalPlayerY = player.visual.y;
  play({
    target: player.visual,
    props: { y: originalPlayerY - 20 },
    duration: 100,
    onComplete: () => {
      dealDamageToBoss(damage);
      play({
        target: player.visual,
        props: { y: originalPlayerY },
        duration: 100,
        onComplete: () => setTimeout(processBossTurn, 200) // Ход босса после атаки
      });
    }
  });
}

/**
 * Логика хода босса. Пока очень простая.
 */
function processBossTurn() {
  const { runState, runState: { player, boss, rows, seed } } = getGameState();
  runState.turnOwner = 'processing';
  console.log("Boss is taking a turn.");

  const random = createPRNG(seed + boss.pos.x * boss.pos.y);

  // 2. Найти лучшую клетку для перемещения (или остаться на месте)
  // --- Улучшенный AI: Динамическая смена тактики ---
  const hpPercent = boss.currentHp / boss.hp;
  let aiProfile = 'balanced';
  if (hpPercent > 0.6) {
    aiProfile = 'aggressive';
  } else if (hpPercent <= 0.25) {
    aiProfile = 'defensive';
  }

  let bestScore = -1;
  let bestMoves = [];

  // Босс рассматривает для хода все клетки на своем ряду, кроме той, на которой он стоит.
  for (let newX = 0; newX < DIMS.COLS; newX++) {
    if (newX === boss.pos.x) continue;
    
    const targetCell = rows[boss.pos.y][newX];
    let score = random() * 0.5; // Небольшая случайность для разнообразия

    // Оценка хода в зависимости от профиля AI
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
        // Старается уйти с линии огня игрока
        if (player.pos.x === newX) score -= 50;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 10;
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL && player.pos.x === newX) score += 5;
        break;
      case 'balanced':
      default:
        // Атака и сбор бонусов возможны только при перемещении
        if (targetCell.type === OBJECT_TYPES.ATTACK_CELL && player.pos.x === newX) score += 100;
        if (targetCell.type === OBJECT_TYPES.HEAL) score += 40;
        if (targetCell.type === OBJECT_TYPES.ATTACK_BONUS) score += 20;
        if (targetCell.type === OBJECT_TYPES.DEFENSE_BONUS) score += 20;
        break;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [newX];
    } else if (Math.abs(score - bestScore) < 0.1) { // Сравниваем с погрешностью из-за float
      bestMoves.push(newX);
    }
  }

  // 3. Выполнить действие
  let targetX;
  if (bestMoves.length > 0) {
    targetX = bestMoves[Math.floor(random() * bestMoves.length)];
  } else {
    // Если нет "хороших" ходов, выбираем случайный из доступных
    const allPossibleMoves = Array.from({length: DIMS.COLS}, (_, i) => i).filter(i => i !== boss.pos.x);
    targetX = allPossibleMoves[Math.floor(random() * allPossibleMoves.length)];
  }
  console.log(`Boss AI profile: ${aiProfile}, chose move to ${targetX}`);

    // Перемещаемся на новую клетку
    const targetCell = rows[boss.pos.y][targetX];
    const bossCell = rows[boss.pos.y][boss.pos.x];
    
    // Анимация движения босса
    play({
      target: bossCell.visual, // Анимируем visual-объект старой ячейки
      props: { x: targetX * DIMS.CELL_SIZE },
      duration: 200,
      onComplete: () => {
        boss.pos.x = targetX;

        // Сохраняем тип клетки ДО любой перезаписи
        const landedCellType = targetCell.type;
        const landedCellData = targetCell.data;

        // Подбор бонусов боссом
        if (landedCellType === OBJECT_TYPES.ATTACK_BONUS) {
          if (boss.inventory.attackBonuses.length < 2) {
            boss.inventory.attackBonuses.push({ ...landedCellData });
          }
        } else if (landedCellType === OBJECT_TYPES.DEFENSE_BONUS) {
          if (boss.inventory.defenseBonuses.length < 2) {
            boss.inventory.defenseBonuses.push({ ...landedCellData });
          }
        }

        // На покинутой клетке генерируем новый объект
        const random = createPRNG(runState.seed + bossCell.visual.x * bossCell.visual.y + runState.boss.currentHp);
        const { type: newType, data: newData } = generateNewArenaObject(bossCell.visual.x / DIMS.CELL_SIZE, boss.pos.y, runState.totalRows, random);
        bossCell.type = newType;
        bossCell.data = newData;

        // Перемещаем босса на новую клетку
        targetCell.type = OBJECT_TYPES.BOSS;
        targetCell.data = boss;
        targetCell.visual.x = targetX * DIMS.CELL_SIZE;

        // Если босс встал на клетку атаки и игрок напротив — атакуем с анимацией
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
                  // Передаём ход игроку только если он жив
                  // (dealDamageToPlayer уже вызвал setAppState если hp <= 0)
                  if (player.hp > 0) {
                    runState.turnOwner = 'player';
                  }
                }
              });
            }
          });
        } else {
          // Атаки не было — сразу передаём ход
          if (player.hp > 0) {
            runState.turnOwner = 'player';
          }
        }
      }
    });
}

/**
 * Наносит урон боссу и проверяет на победу.
 * @param {number} damage 
 */
function dealDamageToBoss(damage) {
  const { runState } = getGameState();
  const { boss } = runState;
  const bossCell = runState.rows[boss.pos.y][boss.pos.x];
  let remainingDamage = damage;

  // Сначала урон поглощается бонусами защиты босса
  for (let i = boss.inventory.defenseBonuses.length - 1; i >= 0; i--) {
    const bonus = boss.inventory.defenseBonuses[i];
    const absorbedAmount = Math.min(remainingDamage, bonus.value);
    
    bonus.value -= absorbedAmount;
    remainingDamage -= absorbedAmount;

    if (bonus.value <= 0) {
      boss.inventory.defenseBonuses.splice(i, 1);
    }
    if (remainingDamage <= 0) break;
  }

  const actualDamageToHp = Math.min(remainingDamage, boss.currentHp);
  boss.currentHp -= actualDamageToHp;
  createFloatingText(`-${damage}`, '#facc15', bossCell.visual); // Показываем общий урон

  if (boss.currentHp <= 0) {
    runState.turnOwner = 'processing'; // Блокируем любой ввод
    console.log("BOSS DEFEATED! VICTORY!");
    // Анимация "смерти" босса
    play({
      target: bossCell.visual,
      props: { alpha: 0 }, // target уже bossCell.visual, поэтому путь просто 'alpha'
      duration: 1000,
      onComplete: () => {
        bossCell.data = null;
        setAppState(AppState.RUN_VICTORY, _onStateChange);
      }
    });
  }
}

/**
 * Обрабатывает логику ближнего боя.
 * Урон игрока = сумма бонусов атаки + текущее HP. HP игрока тратится.
 * @param {object} enemyCell - Ячейка с врагом.
 * @returns {boolean} - true, если игрок победил, false - если враг выжил.
 */
function processMeleeCombat(enemyCell) {
  const { player } = getGameState().runState;
  const enemy = enemyCell.data;
  
  // 1. Запоминаем силу атаки каждого участника ПЕРЕД обменом ударами.
  // Атака равна текущему здоровью на момент начала боя.
  const playerAttackPower = player.hp; 
  const enemyAttackPower = enemy.currentHp;

  // 2. Рассчитываем и наносим урон врагу от игрока.
  const bonusDamage = player.inventory.attackBonuses.reduce((sum, b) => sum + b.value, 0);
  const totalPlayerDamage = bonusDamage + playerAttackPower;
  dealDamageToEnemy(enemyCell, totalPlayerDamage, true); // true = потратить бонусы

  // 3. Наносим урон игроку, используя сохраненную силу атаки врага.
  const damageToPlayer = dealDamageToPlayer(enemyAttackPower, enemy);
  if (damageToPlayer > 0) {
    // Текст урона теперь создается внутри dealDamageToPlayer
  }

  // 4. Возвращаем результат боя: игрок должен выжить, а враг - нет.
  // Приоритет у выживания игрока. Если оба погибают, это поражение.
  const playerWon = player.hp > 0 && enemy.currentHp <= 0;
  return playerWon;
}

/**
 * Наносит урон врагу. Может опционально использовать бонусы атаки.
 * @param {object} enemyCell - Ячейка с врагом.
 * @param {number} baseDamage - Базовый урон от оружия/атаки.
 * @param {boolean} consumeBonuses - Если true, бонусы атаки будут потрачены.
 */
function dealDamageToEnemy(enemyCell, baseDamage, consumeBonuses = false) {
  const { runState } = getGameState();
  const { player } = runState;
  const enemy = enemyCell.data;

  // Определяем, сколько урона фактически будет нанесено (не больше, чем есть здоровья у врага)
  const actualDamageDealt = Math.min(baseDamage, enemy.currentHp);

  if (consumeBonuses) {
    let damageToConsumeFromBonuses = actualDamageDealt;

    // Расходуем бонусы атаки частично
    for (let i = player.inventory.attackBonuses.length - 1; i >= 0; i--) {
      const bonus = player.inventory.attackBonuses[i];
      const consumedAmount = Math.min(damageToConsumeFromBonuses, bonus.value);
      
      bonus.value -= consumedAmount;
      damageToConsumeFromBonuses -= consumedAmount;

      if (bonus.value <= 0) {
        player.inventory.attackBonuses.splice(i, 1);
      }
      if (damageToConsumeFromBonuses <= 0) break;
    }
  }

  enemy.currentHp -= baseDamage;
  createFloatingText(`-${actualDamageDealt}`, '#facc15', enemyCell.visual);
}







/**
 * Общая функция для продолжения хода после взаимодействия с клеткой.
 * @param {number} previousPlayerY - Y-координата ряда, который покинул игрок.
 * @param {number} targetY - Y-координата нового ряда игрока.
 */
function continuePlayerTurnAfterInteraction(previousPlayerY, targetY) {
  const { runState } = getGameState();
  const { rows } = runState;
  processEnemyTurns(previousPlayerY, () => {
    // Этот код выполнится ПОСЛЕ всех атак врагов
    // Возвращаем базовый скроллинг для основной части подземелья.
    if (runState.levelPhase === 'dungeon') {
      runState.targetScrollY = getRowY(targetY, runState.totalRows);
    }
    updateEnemyAI();
    // Очищаем данные мертвых врагов ПОСЛЕ скроллинга и обновления AI
    cleanupDeadEnemies(rows);

    // Проверка на поражение (если враги сзади нанесли урон)
    if (runState.player.hp <= 0) {
      console.log("Player has been defeated. Switching to summary screen.");
      setAppState(AppState.RUN_SUMMARY, _onStateChange);
    }
  });
}

/**
 * Проходит по всем рядам и удаляет данные у врагов с hp <= 0.
 * Это нужно делать после всех анимаций и обновлений логики за ход.
 * @param {Array<Array<object>>} rows 
 */
function cleanupDeadEnemies(rows) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell.type === OBJECT_TYPES.ENEMY && cell.data && cell.data.currentHp <= 0) {
        cell.type = OBJECT_TYPES.EMPTY;
        cell.data = null;
      }
    }
  }
}

/**
 * Обрабатывает атаки врагов, которые были в состоянии 'alert' на покинутом ряду.
 * @param {number} y - Координата Y покинутого ряда.
 * @param {function} onAllAttacksComplete - Колбэк, который вызовется после всех атак.
 */
function processEnemyTurns(y, onAllAttacksComplete) {
  const { player, rows } = getGameState().runState;
  if (y < 0) { // Нечего обрабатывать, если это был первый ход
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

  // Создаем рекурсивную функцию для последовательного запуска анимаций
  function playNextAttack(index) {
    if (index >= attackingEnemies.length) {
      // Все атаки завершены
      onAllAttacksComplete();
      return;
    }

    const enemyCell = attackingEnemies[index];
    const enemy = enemyCell.data;
    const originalY = enemyCell.visual.y;

    // Анимация "выпада" в сторону игрока
    play({
      target: enemyCell,
      props: { 'visual.y': originalY + DIMS.CELL_SIZE * 0.3 }, // Двигаемся немного "вверх" (вниз по экрану)
      duration: 150,
      onComplete: () => {
        // Наносим урон
        const damageDealt = dealDamageToPlayer(enemy.currentHp, enemy);
        if (damageDealt > 0) createFloatingText(`-${damageDealt}`, '#ef4444', player.visual);

        // Анимация возврата на место
        play({
          target: enemyCell,
          props: { 'visual.y': originalY },
          duration: 150,
          onComplete: () => playNextAttack(index + 1) // Запускаем атаку следующего врага
        });
      }
    });
  }

  // Запускаем первую атаку
  playNextAttack(0);
}

/**
 * Наносит урон игроку, используя сначала бонусы защиты.
 * @param {number} incomingDamage - Входящий урон.
 * @param {object} [source] - Объект-источник урона (для анимаций).
 * @returns {number} - Фактически полученный урон здоровьем.
 */
function dealDamageToPlayer(incomingDamage, source = null) {
  const { runState } = getGameState();
  const { player } = runState;
  let totalDamageTaken = 0;

  // Урон не может быть отрицательным. Если враг мертв, он не наносит урона.
  if (incomingDamage <= 0) return 0;

  // Используем бонусы защиты, чтобы поглотить урон
  for (let i = player.inventory.defenseBonuses.length - 1; i >= 0; i--) {
    const bonus = player.inventory.defenseBonuses[i];
    const absorbedAmount = Math.min(incomingDamage, bonus.value);
    
    bonus.value -= absorbedAmount;
    incomingDamage -= absorbedAmount;

    if (bonus.value <= 0) {
      player.inventory.defenseBonuses.splice(i, 1);
    }
    if (incomingDamage <= 0) break;
  }

  totalDamageTaken = Math.max(0, incomingDamage); // Урон, оставшийся после поглощения
  player.hp -= totalDamageTaken;

  if (totalDamageTaken > 0) {
    createFloatingText(`-${totalDamageTaken}`, '#ef4444', player.visual);
  }
   if (player.hp <= 0) {
        console.log("Player has been defeated. Switching to summary screen.");
        setTimeout(() => setAppState(AppState.RUN_SUMMARY, _onStateChange), 100);
     }

  return totalDamageTaken;
}

/**
 * Обновляет состояние AI всех врагов на поле.
 */
function updateEnemyAI() {
  const { player, rows } = getGameState().runState;
  rows.forEach((row, y) => {
    row.forEach(cell => {
      if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
        const enemy = cell.data;
        // Враг может "заметить" игрока только на своем ряду
        if (y === player.pos.y) {
          const distanceX = player.pos.x - enemy.originalPos.x;
          const visionRange = enemy.visionRange;

          if (Math.abs(distanceX) <= visionRange) {
            // Проверяем наличие стен между врагом и игроком
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

/**
 * Создает объект всплывающего текста.
 * @param {string} text - Текст для отображения.
 * @param {string} color - Цвет текста.
 * @param {object} position - Начальная позиция (обычно player.visual).
 */
function createFloatingText(text, color, position) {
  const { runState } = getGameState();
  const newText = {
    id: Date.now() + Math.random(), // Уникальный ID
    text,
    color,
    visual: { 
      x: position.x, 
      y: position.y + DIMS.CELL_SIZE * 0.5, // Смещаем начальную точку на половину высоты ячейки вверх
      alpha: 1.0 
    },
  };
  runState.floatingTexts.push(newText);
}