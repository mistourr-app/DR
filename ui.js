import { LEVELS, CELL_DEFS, OBJECT_TYPES } from './registry.js';
import { getGameState } from './state.js';
import { scheduleRunCallback } from './animation.js';
import { getAssetDefinition, getAssetUrl } from './assets/loader.js';

function readStorageJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function applyAssetBackgrounds(container) {
  if (!container) return;
  container.querySelectorAll('[data-asset-id]').forEach((element) => {
    applyAssetBackground(element, element.dataset.assetId);
  });
}

function applyAssetBackground(element, assetId) {
  const asset = getAssetDefinition(assetId);
  const url = getAssetUrl(assetId);
  if (!element || !asset || !url) return;
  // Контент перерисовывается каждый кадр, поэтому не пересоздаём стили без изменения URL.
  if (element.dataset.assetApplied === url) return;
  element.dataset.assetApplied = url;

  if (asset.mode === 'nine-slice') {
    const insets = Array.isArray(asset.insets) ? asset.insets : [0, 0, 0, 0];
    const sourceSize = Array.isArray(asset.sourceSize) ? asset.sourceSize : [1, 1];
    const borderWidths = [
      `${(insets[0] / sourceSize[1]) * 100}%`,
      `${(insets[1] / sourceSize[0]) * 100}%`,
      `${(insets[2] / sourceSize[1]) * 100}%`,
      `${(insets[3] / sourceSize[0]) * 100}%`,
    ];
    element.style.borderStyle = 'solid';
    element.style.borderWidth = borderWidths.join(' ');
    element.style.borderImageSource = `url("${url}")`;
    element.style.borderImageSlice = `${insets.join(' ')} fill`;
    element.style.borderImageRepeat = 'stretch';
    element.style.borderImageWidth = borderWidths.join(' ');
    return;
  }

  element.style.backgroundImage = `url("${url}")`;
  element.style.backgroundRepeat = asset.mode === 'tile' ? 'repeat' : 'no-repeat';
  element.style.backgroundPosition = 'center';
  element.style.backgroundSize = asset.mode === 'cover' ? 'cover' : 'contain';
}

// Получаем ссылки на все оверлеи один раз
const levelSelectScreen = document.getElementById('level-select-screen');
const victoryScreen = document.getElementById('victory-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const levelEditorScreen = document.getElementById('level-editor-screen');
const createLevelScreen = document.getElementById('create-level-screen');

const topUiBar = document.getElementById('top-ui-bar');
const inventoryDisplay = document.getElementById('inventory-display');
const allScreens = [
  levelSelectScreen,
  victoryScreen,
  gameOverScreen,
  levelEditorScreen,
  createLevelScreen
];

export function hideAllScreens() {
  allScreens.forEach(screen => {
    if (screen) screen.style.display = 'none';
  });
}

export function updateGoldCounter() {
  const goldAmount = document.getElementById('gold-amount');
  if (goldAmount) {
    const { metaState, runState } = getGameState();
    const pendingGold = runState && !runState.goldCommitted ? (runState.goldCollected || 0) : 0;
    const totalGold = metaState.gold + pendingGold;
    goldAmount.textContent = totalGold;
  }
}

/**
 * Показывает экран выбора уровня и создает кнопки.
 * @param {function(string): void} onLevelSelect - Колбэк, вызываемый при выборе уровня.
 */
export function showLevelSelectScreen(onLevelSelect) {
  hideAllScreens();
  if (levelSelectScreen) {
    levelSelectScreen.style.display = 'flex';
    applyAssetBackground(levelSelectScreen, 'ui.screen.level-select');

    const container = document.getElementById('level-buttons-container');
    if (!container) return;

    let orderedLevels = [...LEVELS];
    const order = readStorageJson('levelOrder', []);
    if (Array.isArray(order)) {
      const ordered = [];
      order.forEach(id => {
        const level = LEVELS.find(candidate => candidate.id === id);
        if (level) ordered.push(level);
      });
      LEVELS.forEach(level => {
        if (!ordered.some(item => item.id === level.id)) ordered.push(level);
      });
      orderedLevels = ordered;
    }

    const visibility = readStorageJson('levelVisibility', {});
    if (visibility && typeof visibility === 'object' && !Array.isArray(visibility)) {
      orderedLevels = orderedLevels.map(level => ({
        ...level,
        hidden: level.hidden === true || visibility[level.id] === true,
      }));
    }

    // Пересоздаем кнопки каждый раз для обновления порядка
    container.innerHTML = '';
    // Фильтруем скрытые уровни, переворачиваем массив и снова переворачиваем при добавлении
    const visibleLevels = orderedLevels.filter(level => !level.hidden).reverse();
    visibleLevels.forEach(level => {
      const button = document.createElement('button');
      button.id = `level-btn-${level.id}`;
      button.innerText = `${level.name} (${level.rows} рядов)`;
      button.className = 'button';
      button.addEventListener('click', () => onLevelSelect(level.id));
      container.insertBefore(button, container.firstChild);
    });
  }
}

/**
 * Отрисовывает верхнюю панель UI (счетчик рядов, кнопка выхода).
 * @param {object} runState - Текущее состояние забега.
 * @param {function(): void} onExit - Колбэк для кнопки "Выход".
 */
export function renderTopBar(runState, onExit) {
  if (!topUiBar) return;
  applyAssetBackground(topUiBar, 'ui.hud.top');
  applyAssetBackground(inventoryDisplay, 'ui.hud.bottom');

  // Инициализируем содержимое только один раз, чтобы не терять обработчик событий
  if (!topUiBar.dataset.initialized) {
    topUiBar.dataset.initialized = 'true';
    topUiBar.innerHTML = `
      <div class="flex items-center justify-between w-full h-full px-2">
        <button id="exit-run-btn" class="button-secondary">Выход</button>
        <div id="boss-inventory-display" class="flex items-center justify-center gap-2"></div>
        <div id="row-counter" class="text-lg font-bold text-gray-300"></div>
      </div>
    `;
    document.getElementById('exit-run-btn').addEventListener('click', onExit);
  }

  // Отрисовка инвентаря босса, если мы на арене
  const bossInventoryDisplay = document.getElementById('boss-inventory-display');
  applyAssetBackground(bossInventoryDisplay, 'ui.hud.boss-inventory');
  if (bossInventoryDisplay && runState?.levelPhase === 'boss_arena' && runState.boss) {
    const { inventory } = runState.boss;
    let bossInventoryHtml = '';
    // Слоты для бонусов атаки босса
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.attackBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Атака', CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color, false, null, null, true, 'ui.icon.attack') : createSlot('-', 'Атака', '#6b7280', true, null, null, true, 'ui.slot.boss');
    }
    // Слоты для бонусов защиты босса
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.defenseBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Защита', CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].color, false, null, null, true, 'ui.icon.defense') : createSlot('-', 'Защита', '#6b7280', true, null, null, true, 'ui.slot.boss');
    }
    bossInventoryDisplay.innerHTML = bossInventoryHtml;
    applyAssetBackgrounds(bossInventoryDisplay);
  } else if (bossInventoryDisplay) {
    bossInventoryDisplay.innerHTML = '';
  }

  // Обновляем динамические данные (счетчик рядов)
  const rowCounterEl = document.getElementById('row-counter');
  if (rowCounterEl && runState) {
    // +1, так как ряды 0-индексированы
    rowCounterEl.innerText = `Ряд: ${runState.player.pos.y + 1} / ${runState.totalRows}`;
  }
}

/** Сбрасывает инициализацию верхней панели, чтобы ее можно было создать заново. */
export function resetTopBar() {
  if (topUiBar) {
    topUiBar.dataset.initialized = '';
    topUiBar.innerHTML = '';
  }
}

/**
 * Создает HTML-разметку для одного слота инвентаря.
 * @param {string} value - Значение для отображения в слоте.
 * @param {string} label - Подпись под слотом.
 * @param {string} valueColorClass - Tailwind CSS класс для цвета значения.
 * @param {boolean} isEmpty - Если true, слот будет полупрозрачным.
 * @param {string|null} [secondaryValue] - Необязательное второе значение, отображаемое под основным.
 * @param {boolean} [isSmall=false] - Если true, используется уменьшенный размер для инвентаря босса.
 * @returns {string} - HTML-строка.
 */
function createSlot(value, label, valueColor = '#ffffff', isEmpty = false, secondaryValue = null, secondaryColor = null, isSmall = false, assetId = null) {
  const emptyClass = isEmpty ? 'opacity-40' : '';
  const sizeClasses = isSmall ? 'w-12 h-12' : 'w-16 h-16';
  const safeValue = escapeHtml(value);
  const safeLabel = escapeHtml(label);
  const safeSecondaryValue = secondaryValue === null || secondaryValue === undefined ? '' : escapeHtml(secondaryValue);
  const safeValueColor = /^#[0-9a-f]{3,8}$/i.test(valueColor) ? valueColor : '#ffffff';
  const safeSecondaryColor = /^#[0-9a-f]{3,8}$/i.test(secondaryColor || '') ? secondaryColor : '#d1d5db';
  // Обертка для слота и его подписи
  return `
    <div class="flex flex-col items-center">
      <div class="flex flex-col items-center justify-center ${sizeClasses} bg-gray-800 border border-gray-600 rounded-md p-1 ${emptyClass}"${assetId ? ` data-asset-id="${escapeHtml(assetId)}"` : ''}>
        <span class="text-2xl font-black leading-tight" style="color: ${safeValueColor};">${safeValue}</span>
        <!-- Вторичный текст, используется для зарядов арбалета -->
        ${safeSecondaryValue ? `<span class="text-xs font-bold" style="color: ${safeSecondaryColor};">${safeSecondaryValue}</span>` : ''}
      </div>
      <span class="text-xs uppercase text-gray-400 font-semibold mt-1">${safeLabel}</span>
    </div>
  `;
}

/**
 * Отрисовывает UI во время забега (здоровье, заряды и т.д.)
 * @param {object} runState - Текущее состояние забега.
 */
export function renderUi(runState) {
  if (!runState || !inventoryDisplay) return;

  const { inventory } = runState.player;
  let inventoryHtml = '';

  // Слот для арбалета
  const weapon = inventory.weapon;
  if (weapon?.type === 'crossbow') {
    inventoryHtml += createSlot(
      `${weapon.damage}`, 
      'Арбалет', 
      '#ffffff', // Урон белым
      false, 
      `${inventory.ammo}/${inventory.maxAmmo}`,
      CELL_DEFS[OBJECT_TYPES.AMMO].color, // Заряды цветом клеток
      false,
      'ui.icon.crossbow'
    );
  }

  // Слоты для бонусов атаки (всегда 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.attackBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Атака', CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color, false, null, null, false, 'ui.icon.attack') : createSlot('-', 'Атака', '#6b7280', true, null, null, false, 'ui.slot.player');
  }

  // Слоты для бонусов защиты (всегда 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.defenseBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Защита', CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].color, false, null, null, false, 'ui.icon.defense') : createSlot('-', 'Защита', '#6b7280', true, null, null, false, 'ui.slot.player');
  }

  // Используем innerHTML, так как это простой и быстрый способ для такого UI
  inventoryDisplay.innerHTML = inventoryHtml;
  applyAssetBackgrounds(inventoryDisplay);
}

/**
 * Показывает экран поражения.
 * @param {function(): void} onRestart - Колбэк для кнопки "Попробовать снова".
 * @param {function(): void} onGoToMenu - Колбэк для кнопки "Меню уровней".
 * @param {string} deathType - Тип смерти: 'damage' или 'exhaustion'
 */
export function showGameOverScreen(onRestart, onGoToMenu, deathType = 'damage') {
  if (gameOverScreen) {
    applyAssetBackground(gameOverScreen, 'ui.screen.defeat');
    // Устанавливаем текст в зависимости от типа смерти
    const titleEl = document.getElementById('game-over-title');
    const messageEl = document.getElementById('game-over-message');
    
    if (deathType === 'exhaustion') {
      titleEl.textContent = 'ИСТОЩЕНИЕ';
      messageEl.innerHTML = 'Ты застрял без энергии из-за своей опрометчивости.<br>Всегда следи за запасом энергии!';
    } else {
      titleEl.textContent = 'СИСТЕМА ПОВРЕЖДЕНА';
      messageEl.textContent = 'Ваше здоровье упало до нуля';
    }
    
    // Показываем с задержкой
    gameOverScreen.style.display = 'flex';
    gameOverScreen.style.opacity = '0';
    
    scheduleRunCallback(800, () => {
      gameOverScreen.style.opacity = '1';
    });

    // Используем тот же подход с cloneNode, чтобы всегда иметь свежие колбэки
    const restartBtn = document.getElementById('restart-level-btn');
    const toMenuBtn = document.getElementById('game-over-to-menu-btn');

    const newRestartBtn = restartBtn.cloneNode(true);
    newRestartBtn.addEventListener('click', onRestart);
    restartBtn.parentNode.replaceChild(newRestartBtn, restartBtn);

    const newToMenuBtn = toMenuBtn.cloneNode(true);
    newToMenuBtn.addEventListener('click', onGoToMenu);
    toMenuBtn.parentNode.replaceChild(newToMenuBtn, toMenuBtn);
  }
}

/**
 * Показывает экран победы.
 * @param {function(): void} onGoToMenu - Колбэк для кнопки "Меню уровней".
 */
export function showVictoryScreen(onGoToMenu) {
  if (victoryScreen) {
    applyAssetBackground(victoryScreen, 'ui.screen.victory');
    victoryScreen.style.display = 'flex';

    const toMenuBtn = document.getElementById('victory-to-menu-btn');
    if (toMenuBtn) {
      const newToMenuBtn = toMenuBtn.cloneNode(true);

      toMenuBtn.parentNode.replaceChild(newToMenuBtn, toMenuBtn);
      newToMenuBtn.addEventListener('click', onGoToMenu);
    }
  }
}