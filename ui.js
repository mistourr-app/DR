import { LEVELS } from './registry.js';

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

/**
 * Показывает экран выбора уровня и создает кнопки.
 * @param {function(string): void} onLevelSelect - Колбэк, вызываемый при выборе уровня.
 */
export function showLevelSelectScreen(onLevelSelect) {
  hideAllScreens();
  if (levelSelectScreen) {
    levelSelectScreen.style.display = 'flex';

    const container = document.getElementById('level-buttons-container');
    if (!container) return;

    // Загружаем порядок уровней из localStorage
    let orderedLevels = [...LEVELS];
    const order = localStorage.getItem('levelOrder');
    if (order) {
      const ids = JSON.parse(order);
      const ordered = [];
      ids.forEach(id => {
        const level = LEVELS.find(l => l.id === id);
        if (level) ordered.push(level);
      });
      LEVELS.forEach(l => {
        if (!ordered.find(ol => ol.id === l.id)) ordered.push(l);
      });
      orderedLevels = ordered;
    }

    // Если кнопки еще не созданы, создаем их
    if (!container.children.length) {
        // Фильтруем скрытые уровни и отображаем снизу вверх
        orderedLevels.filter(level => !level.hidden).reverse().forEach(level => {
            const button = document.createElement('button');
            button.id = `level-btn-${level.id}`;
            button.innerText = `${level.name} (${level.rows} рядов)`;
            button.className = 'button';
            container.appendChild(button);
        });
    }

    // Всегда обновляем обработчики событий, чтобы избежать "мертвых" колбэков
    // Фильтруем скрытые уровни
    orderedLevels.filter(level => !level.hidden).forEach(level => {
        const button = document.getElementById(`level-btn-${level.id}`);
        if (!button) return;

        // Заменяем кнопку на ее клон, чтобы удалить ВСЕ предыдущие обработчики событий.
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        // Добавляем единственный актуальный обработчик на новую кнопку.
        newButton.addEventListener('click', () => onLevelSelect(level.id));
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
  if (bossInventoryDisplay && runState?.levelPhase === 'boss_arena' && runState.boss) {
    const { inventory } = runState.boss;
    let bossInventoryHtml = '';
    // Слоты для бонусов атаки босса
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.attackBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Атака', 'text-yellow-300', false, null, true) : createSlot('-', 'Атака', 'text-gray-500', true, null, true);
    }
    // Слоты для бонусов защиты босса
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.defenseBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Защита', 'text-blue-400', false, null, true) : createSlot('-', 'Защита', 'text-gray-500', true, null, true);
    }
    bossInventoryDisplay.innerHTML = bossInventoryHtml;
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
function createSlot(value, label, valueColorClass = 'text-white', isEmpty = false, secondaryValue = null, isSmall = false) {
  const emptyClass = isEmpty ? 'opacity-40' : '';
  const sizeClasses = isSmall ? 'w-12 h-12' : 'w-16 h-16';
  // Обертка для слота и его подписи
  return `
    <div class="flex flex-col items-center">
      <div class="flex flex-col items-center justify-center ${sizeClasses} bg-gray-800 border border-gray-600 rounded-md p-1 ${emptyClass}">
        <span class="text-2xl font-black leading-tight ${valueColorClass}">${value}</span>
        <!-- Вторичный текст, используется для зарядов арбалета -->
        ${secondaryValue ? `<span class="text-xs font-bold text-gray-300">${secondaryValue}</span>` : ''}
      </div>
      <span class="text-xs uppercase text-gray-400 font-semibold mt-1">${label}</span>
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
    inventoryHtml += createSlot(`${weapon.damage}`, 'Арбалет', 'text-amber-400', false, `${inventory.ammo}/${inventory.maxAmmo}`);
  }

  // Слоты для бонусов атаки (всегда 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.attackBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Атака', 'text-yellow-300') : createSlot('-', 'Атака', 'text-gray-500', true);
  }

  // Слоты для бонусов защиты (всегда 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.defenseBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'Защита', 'text-blue-400') : createSlot('-', 'Защита', 'text-gray-500', true);
  }

  // Используем innerHTML, так как это простой и быстрый способ для такого UI
  inventoryDisplay.innerHTML = inventoryHtml;
}

/**
 * Показывает экран поражения.
 * @param {function(): void} onRestart - Колбэк для кнопки "Попробовать снова".
 * @param {function(): void} onGoToMenu - Колбэк для кнопки "Меню уровней".
 */
export function showGameOverScreen(onRestart, onGoToMenu) {
  if (gameOverScreen) {
    gameOverScreen.style.display = 'flex';

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
    victoryScreen.style.display = 'flex';

    const toMenuBtn = document.getElementById('victory-to-menu-btn');
    if (toMenuBtn) {
      const newToMenuBtn = toMenuBtn.cloneNode(true);

      toMenuBtn.parentNode.replaceChild(newToMenuBtn, toMenuBtn);
      newToMenuBtn.addEventListener('click', onGoToMenu);
    }
  }
}