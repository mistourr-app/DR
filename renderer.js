import { getGameState } from './state.js';
import { DIMS } from './config.js';
import { OBJECT_TYPES, CELL_DEFS } from './registry.js';
import { getThreatMaps } from './enemyAI.js';
import { getCurrentStep, getTutorialAllowedCells } from './tutorial.js';

let ctx;

// --- Константы для отрисовки ---
const CARD_PADDING = 6;

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
      const isArenaRow = y >= runState.totalRows - 2;
      const cellHeight = isArenaRow ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE;
      const drawY = ctx.canvas.height - (cell.visual.y - scrollY) - cellHeight;
      const isPassed = y < playerRow;
      const isInRange = y < playerRow + DIMS.VISIBLE_ROWS;
      const isVisible = isInRange && !losBlockedCols[x];
      
      // Пропускаем отрисовку только тех клеток, которые невидимы И не анимируются.
      // Это позволяет дорисовывать анимации, даже если объект ушел за пределы экрана.
      if (!isInRange && !cell.isAnimating) continue;

      cellsToDraw.push({ x: x * DIMS.CELL_SIZE, y: drawY, cell, gx: x, gy: y, isVisible, isPassed, isInRange, idleThreatMap, alertThreatMap });

      if (isVisible && y > playerRow && cell.type === OBJECT_TYPES.WALL) {
        losBlockedCols[x] = true;
      }
    }
  }

  // Pass 2: Отрисовываем сначала статические, потом анимируемые клетки
  // Статические
  cellsToDraw
    .filter(c => !c.cell.isAnimating)
    .forEach(c => drawCard(c.x, c.y, c.cell, c.gx, c.gy, c.isVisible, c.isPassed, c.isInRange, c.idleThreatMap, c.alertThreatMap));

  // Отрисовка тактических элементов (линия выстрела)
  renderTacticalElements(scrollY);

  // Отрисовка игрока
  if (player.hp > 0) {
    const playerDrawY = ctx.canvas.height - (player.visual.y - scrollY) - player.visual.h;
    drawPlayerCard(player.visual.x, playerDrawY);
  }

  // Pass 3: Отрисовываем всплывающий текст поверх всего
  renderFloatingTexts(scrollY);

  // Pass 4: Отрисовываем подсказки tutorial
  renderTutorialHint();

  // Анимируемые (поверх всего)
  cellsToDraw
    .filter(c => c.cell.isAnimating)
    .forEach(c => drawCard(c.x, c.y, c.cell, c.gx, c.gy, c.isVisible, c.isPassed, c.isInRange, c.idleThreatMap, c.alertThreatMap));
}

function drawCard(x, y, cell, gx, gy, isVisible, isPassed, isInRange, idleThreatMap, alertThreatMap) {
  const { player, levelPhase, totalRows } = getGameState().runState;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const isArenaRow = gy >= totalRows - 2;
  const h = (isArenaRow ? DIMS.CELL_SIZE * 2 : DIMS.CELL_SIZE) - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Применяем прозрачность для анимации исчезновения
  ctx.globalAlpha = cell.visual.alpha;

  // Фон клетки
  ctx.fillStyle = (gy % 2 === 0) ? "#15171e" : "#12151c"; // --card-bg
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();

  // Подсветка угрозы (поверх фона и тумана, но под рамкой и контентом)
  if (alertThreatMap.has(`${gx},${gy}`)) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.2)'; // Orange-400 с 20% прозрачностью
    ctx.fill();
  } else if (idleThreatMap.has(`${gx},${gy}`)) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'; // Red-500 с 20% прозрачностью
    ctx.fill();
  }

  // Применяем "туман войны"
  if (isPassed) {
    ctx.globalAlpha *= 0.3;
  } else if (!isVisible && !cell.isAnimating) {
    ctx.globalAlpha *= 0.5;
  }

  // Рамка. Подсвечиваем опасные клетки.
  let strokeStyle = "#2d313d"; // --card-border (серый по умолчанию)
  let lineWidth = 1;
  ctx.setLineDash([]); // Сплошная линия по умолчанию

  // Подсветка разрешенных клеток в tutorial
  const tutorialCells = getTutorialAllowedCells();
  if (tutorialCells && tutorialCells.some(c => c.x === gx && c.y === gy)) {
    strokeStyle = "#22c55e"; // Ярко-зеленый
    lineWidth = 3;
  }

  const isDungeonMoveTarget = levelPhase === 'dungeon' && gy === player.pos.y + 1;
  // На арене подсвечиваем только горизонтальные ходы
  const isArenaMoveTarget = levelPhase === 'boss_arena' && 
                            gy === player.pos.y && 
                            gx !== player.pos.x;

  if (isVisible && (isDungeonMoveTarget || isArenaMoveTarget) && cell.type !== OBJECT_TYPES.WALL) {
    // Логика для подсветки возможных ходов
    const moveDistance = Math.abs(gx - player.pos.x);
    const energyCost = Math.max(0, moveDistance - 1);

    if (energyCost === 0) {
      strokeStyle = "#4ade80"; // Зеленый для примыкающих клеток
      lineWidth = 2;
    } else if (player.energy >= energyCost) {
      strokeStyle = "#3b82f6"; // Голубой, если энергии хватает
      lineWidth = 2;
    } else {
      strokeStyle = "#3b82f6"; // Голубой, но пунктирный, если энергии не хватает
      ctx.setLineDash([4, 4]);
    }
  } else if (cell.type === OBJECT_TYPES.BOSS) {
    // Логика для подсветки босса как цели
    const canUseCrossbow = player.inventory.ammo > 0;
    // Атака в ближнем бою возможна, если есть бонус и игрок на соседней клетке
    const canUseMelee = player.inventory.attackBonuses.length > 0 && player.pos.x === gx;

    if (canUseMelee) {
      strokeStyle = "#fde047"; // Желтый, как бонус атаки
      lineWidth = 2;
    } else if (canUseCrossbow) {
      strokeStyle = "#f59e0b"; // Оранжевый, как патроны
      lineWidth = 2;
    }
    else {
      strokeStyle = "#a855f7"; // Фиолетовый, базовый цвет босса
      lineWidth = 2;
    }
  }

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Отрисовка содержимого, если клетка не пустая
  if (cell.type !== OBJECT_TYPES.EMPTY && isVisible && isInRange) {
    renderContent(cell, w, h);
  } else if (!isPassed && (!isVisible || !isInRange) && !cell.isAnimating) {
    // Вместо "?" рисуем простую тень для скрытых клеток
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();
  }

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

      // HP Врага
      ctx.fillStyle = "#fff";
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

      // HP Босса
      ctx.fillStyle = "#fff";
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

  // Здоровье
  ctx.fillStyle = "#fff";
  ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
  ctx.fillText(Math.max(0, player.hp), w / 2, h / 2 + (8 * fontScale));

  // Энергия
  ctx.fillStyle = "#3b82f6"; // Синий цвет для энергии
  ctx.font = `bold ${Math.round(6 * fontScale)}px Inter, sans-serif`;
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