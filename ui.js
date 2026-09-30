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
  // The content is redrawn every frame, so do not recreate styles while the URL is unchanged.
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

// Grab references to every overlay once
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
 * Shows the level select screen and builds the buttons.
 * @param {function(string): void} onLevelSelect - Callback invoked when a level is picked.
 */
export function showLevelSelectScreen(onLevelSelect) {
  hideAllScreens();
  if (levelSelectScreen) {
    levelSelectScreen.style.display = 'flex';
    // The title must not overlap the gold counter: the top padding equals the top bar height.
    const topBarOffset = topUiBar ? topUiBar.offsetHeight : 0;
    levelSelectScreen.style.paddingTop = `${topBarOffset + 20}px`;
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

    // Rebuild the buttons every time so the order stays in sync
    container.innerHTML = '';
    // Hidden levels are skipped. The list is reversed: the last level on top, the first at the bottom.
    const visibleLevels = orderedLevels.filter(level => !level.hidden).reverse();
    visibleLevels.forEach(level => {
      const button = document.createElement('button');
      button.id = `level-btn-${level.id}`;
      button.innerText = `${level.name} (${level.rows} ROWS)`;
      button.className = 'button';
      button.addEventListener('click', () => onLevelSelect(level.id));
      container.appendChild(button);
    });
    // The tutorial sits at the bottom of the list, so open the menu right on it.
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Renders the top UI bar (row counter, exit button).
 * @param {object} runState - The current run state.
 * @param {function(): void} onExit - Callback for the "EXIT" button.
 */
export function renderTopBar(runState, onExit) {
  if (!topUiBar) return;
  applyAssetBackground(topUiBar, 'ui.hud.top');
  applyAssetBackground(inventoryDisplay, 'ui.hud.bottom');

  // Initialise the content only once so the event handler is not lost
  if (!topUiBar.dataset.initialized) {
    topUiBar.dataset.initialized = 'true';
    topUiBar.innerHTML = `
      <div class="flex items-center justify-between w-full h-full px-2">
        <button id="exit-run-btn" class="button-secondary">EXIT</button>
        <div id="boss-inventory-display" class="flex items-center justify-center gap-2"></div>
        <div id="row-counter" class="text-lg font-bold text-gray-300"></div>
      </div>
    `;
    document.getElementById('exit-run-btn').addEventListener('click', onExit);
  }

  // Render the Elder's inventory when we are on the arena
  const bossInventoryDisplay = document.getElementById('boss-inventory-display');
  applyAssetBackground(bossInventoryDisplay, 'ui.hud.boss-inventory');
  if (bossInventoryDisplay && runState?.levelPhase === 'boss_arena' && runState.boss) {
    const { inventory } = runState.boss;
    let bossInventoryHtml = '';
    // Slots for the Elder's attack bonuses
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.attackBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'ATTACK', CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color, false, null, null, true, 'ui.icon.attack') : createSlot('-', 'ATTACK', '#6b7280', true, null, null, true, 'ui.slot.boss');
    }
    // Slots for the Elder's defense bonuses
    for (let i = 0; i < 2; i++) {
      const bonus = inventory.defenseBonuses[i];
      bossInventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'SHIELD', CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].color, false, null, null, true, 'ui.icon.defense') : createSlot('-', 'SHIELD', '#6b7280', true, null, null, true, 'ui.slot.boss');
    }
    bossInventoryDisplay.innerHTML = bossInventoryHtml;
    applyAssetBackgrounds(bossInventoryDisplay);
  } else if (bossInventoryDisplay) {
    bossInventoryDisplay.innerHTML = '';
  }

  // Update the dynamic parts (row counter)
  const rowCounterEl = document.getElementById('row-counter');
  if (rowCounterEl && runState) {
    // +1 because rows are 0-indexed
    rowCounterEl.innerText = `ROW: ${runState.player.pos.y + 1} / ${runState.totalRows}`;
  }
}

/** Resets the top bar initialisation so it can be built again from scratch. */
export function resetTopBar() {
  if (topUiBar) {
    topUiBar.dataset.initialized = '';
    topUiBar.innerHTML = '';
  }
}

/**
 * Builds the HTML for a single inventory slot.
 * @param {string} value - Value shown inside the slot.
 * @param {string} label - Caption under the slot.
 * @param {string} valueColorClass - Tailwind CSS class for the value colour.
 * @param {boolean} isEmpty - When true the slot is rendered semi-transparent.
 * @param {string|null} [secondaryValue] - Optional second value rendered under the main one.
 * @param {boolean} [isSmall=false] - When true a reduced size is used for the Elder inventory.
 * @returns {string} - An HTML string.
 */
function createSlot(value, label, valueColor = '#ffffff', isEmpty = false, secondaryValue = null, secondaryColor = null, isSmall = false, assetId = null) {
  const emptyClass = isEmpty ? 'opacity-40' : '';
  const sizeClasses = isSmall ? 'w-12 h-12' : 'w-16 h-16';
  const safeValue = escapeHtml(value);
  const safeLabel = escapeHtml(label);
  const safeSecondaryValue = secondaryValue === null || secondaryValue === undefined ? '' : escapeHtml(secondaryValue);
  const safeValueColor = /^#[0-9a-f]{3,8}$/i.test(valueColor) ? valueColor : '#ffffff';
  const safeSecondaryColor = /^#[0-9a-f]{3,8}$/i.test(secondaryColor || '') ? secondaryColor : '#d1d5db';
  // Wrapper for the slot and its caption
  return `
    <div class="flex flex-col items-center">
      <div class="flex flex-col items-center justify-center ${sizeClasses} bg-gray-800 border border-gray-600 rounded-md p-1 ${emptyClass}"${assetId ? ` data-asset-id="${escapeHtml(assetId)}"` : ''}>
        <span class="text-2xl font-black leading-tight" style="color: ${safeValueColor};">${safeValue}</span>
        <!-- Secondary text, used for the crossbow bolts -->
        ${safeSecondaryValue ? `<span class="text-xs font-bold" style="color: ${safeSecondaryColor};">${safeSecondaryValue}</span>` : ''}
      </div>
      <span class="text-xs uppercase text-gray-400 font-semibold mt-1">${safeLabel}</span>
    </div>
  `;
}

/**
 * Renders the in-run UI (health, bolts, etc.)
 * @param {object} runState - The current run state.
 */
export function renderUi(runState) {
  if (!runState || !inventoryDisplay) return;

  const { inventory } = runState.player;
  let inventoryHtml = '';

  // Crossbow slot
  const weapon = inventory.weapon;
  if (weapon?.type === 'crossbow') {
    inventoryHtml += createSlot(
      `${weapon.damage}`, 
      'CROSSBOW', 
      '#ffffff', // Damage in white
      false, 
      `${inventory.ammo}/${inventory.maxAmmo}`,
      CELL_DEFS[OBJECT_TYPES.AMMO].color, // Bolts in the cell colour
      false,
      'ui.icon.crossbow'
    );
  }

  // Slots for attack bonuses (always 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.attackBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'ATTACK', CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color, false, null, null, false, 'ui.icon.attack') : createSlot('-', 'ATTACK', '#6b7280', true, null, null, false, 'ui.slot.player');
  }

  // Slots for defense bonuses (always 2)
  for (let i = 0; i < 2; i++) {
    const bonus = inventory.defenseBonuses[i];
    inventoryHtml += bonus ? createSlot(`+${bonus.value}`, 'SHIELD', CELL_DEFS[OBJECT_TYPES.DEFENSE_BONUS].color, false, null, null, false, 'ui.icon.defense') : createSlot('-', 'SHIELD', '#6b7280', true, null, null, false, 'ui.slot.player');
  }

  // We use innerHTML because it is a simple and fast way to build this UI
  inventoryDisplay.innerHTML = inventoryHtml;
  applyAssetBackgrounds(inventoryDisplay);
}

/**
 * Shows the defeat screen.
 * @param {function(): void} onRestart - Callback for the "TRY AGAIN" button.
 * @param {function(): void} onGoToMenu - Callback for the "DUNGEON SELECT" button.
 * @param {string} deathType - Cause of death: 'damage' or 'exhaustion'
 */
export function showGameOverScreen(onRestart, onGoToMenu, deathType = 'damage') {
  if (gameOverScreen) {
    applyAssetBackground(gameOverScreen, 'ui.screen.defeat');
    // Set the text depending on the cause of death
    const titleEl = document.getElementById('game-over-title');
    const messageEl = document.getElementById('game-over-message');
    
    if (deathType === 'exhaustion') {
      titleEl.textContent = 'EXHAUSTED';
      messageEl.innerHTML = 'You pushed on with nothing left to spend.<br>Watch your energy reserves!';
    } else {
      titleEl.textContent = 'YOUR LIGHT FADES';
      messageEl.textContent = 'Your vitality drained to nothing';
    }
    
    // Reveal it after a delay
    gameOverScreen.style.display = 'flex';
    gameOverScreen.style.opacity = '0';
    
    scheduleRunCallback(800, () => {
      gameOverScreen.style.opacity = '1';
    });

    // Reuse the cloneNode approach so the callbacks are always fresh
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
 * Shows the victory screen.
 * @param {function(): void} onGoToMenu - Callback for the "DUNGEON SELECT" button.
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