import { getGameState } from './state.js';
import { DIMS } from './config.js';
import { OBJECT_TYPES, CELL_DEFS, ENEMY_DEFS } from './registry.js';
import { getThreatMaps } from './enemyAI.js';
import { getCurrentStep, getTutorialAllowedCells } from './tutorial.js';

let ctx;

// --- Константы для отрисовки ---
const CARD_PADDING = 6;
const ENERGY_COLOR = CELL_DEFS[OBJECT_TYPES.ENERGY].color; // Цвет энергии из registry

function getRowY(y, totalRows) {
  const regularRows = totalRows - 2;
  if (y < regularRows) {
    return y * DIMS.CELL_SIZE;
  }
  return (regularRows * DIMS.CELL_SIZE) + ((y - regularRows) * DIMS.CELL_SIZE * 2);
}

function getCellHeight(y, totalRows) {
  const isArenaRow = y >= totalRows - 2;
  return isArenaRow ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE;
}

export function initRenderer(canvasContext) {
  ctx = canvasContext;
}

/**
 * Отрисовывает текущее состояние забега (игрок, сетка и т.д.)
 */
export function renderRun() {
  const state = getGameState();
  const { runState } = state;
  if (!runState) return;

  // Плавное движение камеры
  if (Math.abs(runState.targetScrollY - runState.scrollY) > 0.1) {
    runState.scrollY += (runState.targetScrollY - runState.scrollY) * 0.15;
  } else {
    runState.scrollY = runState.targetScrollY;
  }
  const { player, rows, scrollY } = runState;

  // --- Кэш для линии видимости (LoS) ---
  // Чтобы не пересчитывать для каждой клетки, мы запоминаем, заблокирован ли столбец.
  const losBlockedCols = new Array(DIMS.COLS).fill(false);

  // --- Оконный рендер ---
  // Определяем, какие ряды видимы в данный момент
  const firstVisibleRow = Math.max(0, Math.floor(scrollY / DIMS.CELL_SIZE) - 1);
  const lastVisibleRow = Math.min(rows.length - 1, firstVisibleRow + DIMS.VISIBLE_ROWS + 3);
  const playerRow = player.pos.y;

  // --- Карта угроз (кэшированная) ---
  const { idleThreatMap, alertThreatMap } = getThreatMaps(rows, player.pos);

  // --- Новый двухпроходный рендер ---
  // Pass 1: Собираем информацию обо всех видимых клетках
  const cellsToDraw = [];
  for (let y = firstVisibleRow; y <= lastVisibleRow; y++) {
    for (let x = 0; x < DIMS.COLS; x++) {
      const cell = rows[y][x];
      const cellHeight = getCellHeight(y, runState.totalRows);
      
      // Координаты для фона клетки (статичные, по сетке)
      const cellY = ctx.canvas.height - (getRowY(y, runState.totalRows) - scrollY) - cellHeight;
      
      // Координаты для содержимого - используем те же координаты что и фон + анимационное смещение
      const animOffsetY = (cell.visual.y - getRowY(y, runState.totalRows)) || 0;
      const drawY = cellY - animOffsetY;
      
      const isPassed = y < playerRow;
      const isInRange = y < playerRow + DIMS.VISIBLE_ROWS;
      const isVisible = isInRange && !losBlockedCols[x];
      
      // Пропускаем отрисовку только тех клеток, которые невидимы И не анимируются.
      // Это позволяет дорисовывать анимации, даже если объект ушел за пределы экрана.
      if (!isInRange && !cell.isAnimating) continue;

      cellsToDraw.push({
        x: x * DIMS.CELL_SIZE,
        cellX: cell.visual.x || (x * DIMS.CELL_SIZE),
        cellY: cellY,  // для фона
        drawY: drawY,  // для содержимого
        cell,
        gx: x,
        gy: y,
        isVisible,
        isPassed,
        isInRange,
        idleThreatMap, 
        alertThreatMap 
      });

      if (isVisible && y > playerRow && cell.type === OBJECT_TYPES.WALL) {
        losBlockedCols[x] = true;
      }
    }
  }

  // Pass 2: Отрисовываем фоны ВСЕХ клеток (статичный слой)
  cellsToDraw.forEach(c => drawCellBackground(c.x, c.cellY, c.gx, c.gy));

  // Pass 3: Отрисовываем слой подсветки угроз ПОВЕРХ фонов
  cellsToDraw.forEach(c => drawThreatHighlight(c.x, c.cellY, c.gx, c.gy, c.idleThreatMap, c.alertThreatMap));

  // Pass 4: Отрисовываем содержимое всех клеток (рамки, предметы, враги)
  cellsToDraw.forEach(c => drawCellContent(c.cellX, c.drawY, c.cell, c.gx, c.gy, c.isVisible, c.isPassed, c.isInRange));

  // Отрисовка тактических элементов (линия выстрела)
  renderTacticalElements(scrollY);

  // Отрисовка игрока (всегда, даже если HP <= 0)
  const playerCellHeight = getCellHeight(player.pos.y, runState.totalRows);
  const playerCellY = ctx.canvas.height - (getRowY(player.pos.y, runState.totalRows) - scrollY) - playerCellHeight;
  const playerAnimOffsetY = (player.visual.y - getRowY(player.pos.y, runState.totalRows)) || 0;
  const playerDrawY = playerCellY - playerAnimOffsetY;
  const playerAnimOffsetX = (player.visual.x - player.pos.x * DIMS.CELL_SIZE) || 0;
  const playerDrawX = player.pos.x * DIMS.CELL_SIZE + playerAnimOffsetX;
  drawPlayerCard(playerDrawX, playerDrawY);

  // Pass 3: Отрисовываем всплывающий текст поверх всего
  renderFloatingTexts(scrollY);

  // Pass 4: Отрисовываем подсказки tutorial
  renderTutorialHint();
}

function drawCellBackground(x, y, gx, gy) {
  const { totalRows } = getGameState().runState;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const h = getCellHeight(gy, totalRows) - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Единый фон для всех клеток
  ctx.fillStyle = "#1a1d28"; // Чуть светлее базового фона
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();

  // Единая обводка для всех клеток
  ctx.strokeStyle = "#2d313d";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawCellContent(x, y, cell, gx, gy, isVisible, isPassed, isInRange) {
  const { player, levelPhase, totalRows } = getGameState().runState;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const h = getCellHeight(gy, totalRows) - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Применяем прозрачность для анимации исчезновения
  ctx.globalAlpha = cell.visual.alpha;

  // Применяем "туман войны"
  if (isPassed) {
    ctx.globalAlpha *= 0.3;
  } else if (!isVisible && !cell.isAnimating) {
    ctx.globalAlpha *= 0.5;
  }

  // Объекты НЕ имеют фона, только обводку (если нужно)
  let strokeStyle = null; // По умолчанию нет обводки
  let lineWidth = 1;
  ctx.setLineDash([]);

  const isDungeonMoveTarget = levelPhase === 'dungeon' && gy === player.pos.y + 1;
  const isArenaMoveTarget = levelPhase === 'boss_arena' && gy === player.pos.y && gx !== player.pos.x;
  const tutorialCells = getTutorialAllowedCells();
  const isTutorialCell = tutorialCells && tutorialCells.some(c => c.x === gx && c.y === gy);
  
  if (tutorialCells && isTutorialCell) {
    const isMoveCell = (isDungeonMoveTarget || isArenaMoveTarget) && cell.type !== OBJECT_TYPES.WALL;
    const isAttackCell = cell.type === OBJECT_TYPES.ATTACK_CELL;
    
    if (isMoveCell || isAttackCell) {
      const moveDistance = Math.abs(gx - player.pos.x);
      const energyCost = Math.max(0, moveDistance - 1);

      if (player.energy >= energyCost) {
        strokeStyle = energyCost > 0 ? ENERGY_COLOR : "#22c55e";
        lineWidth = 3;
      } else {
        strokeStyle = ENERGY_COLOR;
        lineWidth = 2;
        ctx.setLineDash([4, 4]);
      }
    }
  }
  else if (!tutorialCells && isVisible && (isDungeonMoveTarget || isArenaMoveTarget) && cell.type !== OBJECT_TYPES.WALL) {
    const moveDistance = Math.abs(gx - player.pos.x);
    const energyCost = Math.max(0, moveDistance - 1);

    if (energyCost === 0) {
      strokeStyle = "#4ade80";
      lineWidth = 2;
    } else if (player.energy >= energyCost) {
      strokeStyle = ENERGY_COLOR;
      lineWidth = 2;
    } else {
      strokeStyle = ENERGY_COLOR;
      ctx.setLineDash([4, 4]);
    }
  }
  else if (cell.type === OBJECT_TYPES.BOSS) {
    const canUseCrossbow = player.inventory.ammo > 0;
    const canUseMelee = player.inventory.attackBonuses.length > 0 && player.pos.x === gx;

    if (canUseMelee) {
      strokeStyle = CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color;
      lineWidth = 2;
    } else if (canUseCrossbow) {
      strokeStyle = CELL_DEFS[OBJECT_TYPES.AMMO].color;
      lineWidth = 2;
    } else {
      strokeStyle = cell.data.color;
      lineWidth = 2;
    }
  } else if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
    strokeStyle = isTutorialCell ? "#22c55e" : cell.data.color;
    lineWidth = isTutorialCell ? 3 : 1;
  } else if (cell.type === OBJECT_TYPES.WALL) {
    // Стены имеют обводку
    strokeStyle = CELL_DEFS[OBJECT_TYPES.WALL].color;
    lineWidth = 1;
  }

  // Рисуем обводку только если она нужна
  if (strokeStyle) {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // Отрисовка содержимого
  const isBossCell = cell.type === OBJECT_TYPES.BOSS;
  if (cell.type !== OBJECT_TYPES.EMPTY && (isVisible || isBossCell) && (isInRange || isBossCell)) {
    renderContent(cell, w, h);
  } else if (!isPassed && (!isVisible || !isInRange) && !cell.isAnimating && !isBossCell) {
    // Тень для скрытых клеток (сильнее затемнение)
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();
  }

  ctx.restore();
}

function drawThreatHighlight(x, y, gx, gy, idleThreatMap, alertThreatMap) {
  const { totalRows } = getGameState().runState;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const h = getCellHeight(gy, totalRows) - pad * 2;

  // Проверяем, есть ли подсветка для этой клетки
  const hasAlert = alertThreatMap.has(`${gx},${gy}`);
  const hasIdle = idleThreatMap.has(`${gx},${gy}`);
  
  if (!hasAlert && !hasIdle) return;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);

  // Подсветка с 15% прозрачностью, может наслаиваться
  // Приоритет: оранжевая (alert) > красная (idle)
  if (hasAlert) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)'; // Orange-400 с 15% прозрачностью
  } else {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'; // Red-500 с 15% прозрачностью
  }
  
  ctx.fill();
  ctx.restore();
}

function renderFloatingTexts(scrollY) {
  const { floatingTexts } = getGameState().runState;
  if (!floatingTexts || floatingTexts.length === 0) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const ft of floatingTexts) {
    const drawX = ft.visual.x + DIMS.CELL_SIZE / 2;
    const drawY = ctx.canvas.height - (ft.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

    ctx.globalAlpha = ft.visual.alpha;
    ctx.fillStyle = ft.color;
    ctx.font = `900 ${Math.round(14 * (DIMS.CELL_SIZE / 64))}px Inter, sans-serif`;
    ctx.fillText(ft.text, drawX, drawY);
  }

  ctx.restore();
}

function renderTacticalElements(scrollY) {
  const { player, rows, levelPhase, boss } = getGameState().runState;

  // 1. Проверяем, есть ли у игрока оружие и заряды
  if (player.inventory.weapon?.type !== 'crossbow' || player.inventory.ammo <= 0) return;

  // 2. Ищем цели на текущем ряду в пределах дальности
  if (levelPhase === 'dungeon' && !player.hasShotOnCurrentRow) {
  const playerY = player.pos.y;
  const playerX = player.pos.x;

  for (let x = 0; x < DIMS.COLS; x++) {
    const distance = Math.abs(x - playerX);
    if (distance === 0 || distance > player.inventory.weapon.range) continue;

    const targetCell = rows[playerY][x];
    if (targetCell.type === OBJECT_TYPES.ENEMY) {
      // Проверяем, нет ли стены на пути
      let isBlocked = false;
      const direction = Math.sign(x - playerX);
      for (let i = 1; i < distance; i++) {
        if (rows[playerY][playerX + i * direction].type === OBJECT_TYPES.WALL) {
          isBlocked = true;
          break;
        }
      }
      if (isBlocked) continue; // Не рисуем линию через стену

      // 3. Если цель найдена - рисуем пунктирную линию
      ctx.save();

      const startX = player.visual.x + DIMS.CELL_SIZE / 2;
      const startY = ctx.canvas.height - (player.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

      const endX = targetCell.visual.x + DIMS.CELL_SIZE / 2;
      const endY = ctx.canvas.height - (targetCell.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

      ctx.beginPath();
      ctx.setLineDash([5, 10]);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff'; // Белый цвет
      ctx.stroke();
      ctx.restore();
    }
  }
  } else if (levelPhase === 'boss_arena') {
    // Логика для арены босса - показываем пунктир всегда, когда есть заряды
    const playerX = player.pos.x;
    const bossX = boss.pos.x;
    const distance = Math.abs(bossX - playerX);

    if (distance > 0 && distance <= player.inventory.weapon.range) {
      const bossCell = rows[boss.pos.y][boss.pos.x];

      ctx.save();

      const startX = player.visual.x + DIMS.CELL_SIZE / 2;
      const startY = ctx.canvas.height - (player.visual.y - scrollY) - player.visual.h / 2;

      const endX = bossCell.visual.x + DIMS.CELL_SIZE / 2;
      const endY = ctx.canvas.height - (bossCell.visual.y - scrollY) - (DIMS.CELL_SIZE * 2) / 2;

      ctx.beginPath();
      ctx.setLineDash([5, 10]);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);

      ctx.lineWidth = 2;
      ctx.strokeStyle = player.hasShotOnCurrentRow ? '#6b7280' : '#ffffff'; // Серый если уже стрелял
      ctx.stroke();
      ctx.restore();
    }
  }
}

function renderContent(cell, w, h) {
  ctx.textAlign = "center";
  const fontScale = DIMS.CELL_SIZE / 64; // Масштабируем шрифты относительно базового размера 64
  
  switch (cell.type) {
    case OBJECT_TYPES.WALL: {
      const def = CELL_DEFS[OBJECT_TYPES.WALL];
      ctx.fillStyle = def.color;
      ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, h / 2 + (4 * fontScale));
      break;
    }
    case OBJECT_TYPES.HEAL: {
      const def = CELL_DEFS[OBJECT_TYPES.HEAL];
      const healValue = cell.data?.amount || def.amount;
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(`+${healValue}`, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.AMMO: {
      const def = CELL_DEFS[OBJECT_TYPES.AMMO];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.value, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.ENERGY: {
      const def = CELL_DEFS[OBJECT_TYPES.ENERGY];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.value, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.GOLD: {
      const def = CELL_DEFS[OBJECT_TYPES.GOLD];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.value, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.ATTACK_BONUS: {
      const def = CELL_DEFS[cell.type];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(`+${cell.data?.value || def.value}`, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.DEFENSE_BONUS: {
      const def = CELL_DEFS[cell.type];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(`+${cell.data?.value || def.value}`, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.ATTACK_CELL: {
      const def = CELL_DEFS[cell.type];
      ctx.fillStyle = def.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(def.label, w / 2, 18 * fontScale);
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(`${cell.data?.value || def.value}`, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.ENEMY: {
      const d = cell.data;
      // Заголовок
      ctx.fillStyle = d.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.label, w / 2, 18 * fontScale);

      // HP Врага - тем же цветом
      ctx.fillStyle = d.color;
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.currentHp, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.BOSS: {
      const d = cell.data;
      if (!d) break; // Босс уже мёртв, данные очищены
      // Заголовок
      ctx.fillStyle = d.color;
      ctx.font = `bold ${Math.round(10 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.label, w / 2, 20 * fontScale);

      // HP Босса - тем же цветом
      ctx.fillStyle = d.color;
      ctx.font = `900 ${Math.round(16 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.currentHp, w / 2, h / 2 + (10 * fontScale));
      break;
    }
  }
}

function drawPlayerCard(x, y) {
  const { player, totalRows, rows } = getGameState().runState;
  const fontScale = DIMS.CELL_SIZE / 64;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2; // Ширина всегда постоянна
  const h = player.visual.h - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Постоянный белый цвет для обводки и заголовка
  const borderColor = '#ffffff'; 

  ctx.fillStyle = "#272b38"; // Более светлый фон для карточки игрока
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 12);
  ctx.fill();
  ctx.stroke();

  // Текст
  ctx.textAlign = "center";
  ctx.fillStyle = borderColor;
  ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
  ctx.fillText("ИГРОК", w / 2, 18 * fontScale);

  // Здоровье (красное если HP <= 0)
  const hpColor = player.hp <= 0 ? "#ef4444" : "#fff";
  ctx.fillStyle = hpColor;
  ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
  ctx.fillText(Math.max(0, player.hp), w / 2, h / 2 + (8 * fontScale));

  // Энергия с подсветкой при критических значениях
  const energyPercent = player.energy / player.maxEnergy;
  let energyColor = ENERGY_COLOR; // Цвет энергии из registry
  
  if (energyPercent <= 0) {
    energyColor = "#ef4444"; // Красный при 0
  } else if (energyPercent <= 0.3) {
    energyColor = "#f59e0b"; // Оранжевый при <= 30%
  }
  
  ctx.fillStyle = energyColor;
  ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
  ctx.fillText(`Э: ${player.energy}/${player.maxEnergy}`, w / 2, h - (6 * fontScale));

  ctx.restore();
}

function renderTutorialHint() {
  const step = getCurrentStep();
  if (!step) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, ctx.canvas.width, 60);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(step.text, ctx.canvas.width / 2, 30);
  ctx.restore();
}