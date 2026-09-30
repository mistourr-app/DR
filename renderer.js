import { getGameState } from './state.js';
import { DIMS } from './config.js';
import { OBJECT_TYPES, CELL_DEFS, ENEMY_DEFS } from './registry.js';
import { getThreatMaps } from './enemyAI.js';
import { getCurrentStep, getTutorialAllowedCells } from './tutorial.js';
import { drawAsset } from './assets/loader.js';

let ctx;

// --- Rendering constants ---
const CARD_PADDING = 6;
const ENERGY_COLOR = CELL_DEFS[OBJECT_TYPES.ENERGY].color; // Energy colour from registry

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

function getCellArtId(cell) {
  if (!cell) return null;
  if (cell.type === OBJECT_TYPES.ENEMY) {
    // Registry keys are TYPE_1..TYPE_N, art ids are type-1..type-N.
    // Deriving from artId keeps the lookup stable when labels are renamed.
    const enemyType = String(cell.data?.artId || 'TYPE_1').toLowerCase().replace('_', '-');
    const enemyState = cell.visual?.state || 'idle';
    return `enemy.${enemyType}.${enemyState}`;
  }
  if (cell.type === OBJECT_TYPES.WALL) return 'item.wall';
  if (cell.type === OBJECT_TYPES.HEAL) return 'item.heal';
  if (cell.type === OBJECT_TYPES.AMMO) return 'item.ammo';
  if (cell.type === OBJECT_TYPES.ENERGY) return 'item.energy';
  if (cell.type === OBJECT_TYPES.ATTACK_BONUS) return 'item.attack_bonus';
  if (cell.type === OBJECT_TYPES.DEFENSE_BONUS) return 'item.defense_bonus';
  if (cell.type === OBJECT_TYPES.ATTACK_CELL) return 'item.attack_cell';
  if (cell.type === OBJECT_TYPES.GOLD) return 'item.gold';
  return null;
}

function getCellArtPlacement(cell, width, height) {
  const id = getCellArtId(cell);
  if (!id) return null;
  const isItem = cell.type !== OBJECT_TYPES.ENEMY && cell.type !== OBJECT_TYPES.WALL;
// Tall arena cells (attack_cell) use the sprite at full size,
// other items are fitted into a square using their shorter side.
  const isTallCell = height > width * 1.2;
  const size = isItem ? Math.min(width, height) * 0.78 : Math.min(width, height);
  const drawWidth = isTallCell ? width : size;
  const drawHeight = isTallCell ? height : size;
  return {
    id,
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

export function initRenderer(canvasContext) {
  ctx = canvasContext;
}

/**
 * Renders the current run state (player, grid, etc.)
 */
export function renderRun(deltaTime = 1000 / 60) {
  const state = getGameState();
  const { runState } = state;
  if (!runState) return;

  const frameScale = Math.max(0.1, Math.min(4, Number(deltaTime) || (1000 / 60)) / (1000 / 60));
  const cameraLerp = 1 - Math.pow(0.85, frameScale);
  if (Math.abs(runState.targetScrollY - runState.scrollY) > 0.1) {
    runState.scrollY += (runState.targetScrollY - runState.scrollY) * cameraLerp;
  } else {
    runState.scrollY = runState.targetScrollY;
  }
  const { player, rows, scrollY } = runState;

  // --- Line-of-sight (LoS) cache ---
  // Instead of recomputing it for every cell we remember whether a column is blocked.
  const losBlockedCols = new Array(DIMS.COLS).fill(false);

  // --- Windowed rendering ---
  // Work out which rows are visible right now
  const arenaStartRow = runState.totalRows - 2;
  const firstVisibleRow = Math.max(0, Math.min(Math.floor(scrollY / DIMS.CELL_SIZE) - 1, arenaStartRow));
  const lastVisibleRow = Math.min(rows.length - 1, firstVisibleRow + DIMS.VISIBLE_ROWS + 3);
  const playerRow = player.pos.y;

  // Always include the boss arena rows, even when the camera is far away
  const effectiveLastRow = Math.max(lastVisibleRow, arenaStartRow);

  // --- Threat maps (cached) ---
  const { idleThreatMap, alertThreatMap } = getThreatMaps(rows, player.pos);

  drawAsset(ctx, 'field.background', 0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);
  drawAsset(ctx, runState.levelPhase === 'boss_arena' ? 'field.arena' : 'field.dungeon', 0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);
  drawAsset(ctx, 'field.grid', 0, 0, DIMS.CANVAS_WIDTH, DIMS.CANVAS_HEIGHT);

  // --- New two-pass rendering ---
  // Pass 1: gather information about all visible cells
  const cellsToDraw = [];
  for (let y = firstVisibleRow; y <= effectiveLastRow; y++) {
    for (let x = 0; x < DIMS.COLS; x++) {
      const cell = rows[y][x];
      const cellHeight = getCellHeight(y, runState.totalRows);
      
      // Background coordinates (static, grid aligned)
      const cellY = DIMS.CANVAS_HEIGHT - (getRowY(y, runState.totalRows) - scrollY) - cellHeight;
      
      // Content coordinates - reuse the background coordinates plus the animation offset
      const animOffsetY = (cell.visual.y - getRowY(y, runState.totalRows)) || 0;
      const drawY = cellY - animOffsetY;
      
      const isPassed = y < playerRow;
      const isInRange = y < playerRow + DIMS.VISIBLE_ROWS;
      const isVisible = isInRange && !losBlockedCols[x];

      // We only skip cells that are invisible AND not animating.
      // This lets us keep drawing animations even after an object left the screen.
      // The Elder and the arena cells are always drawn, no matter the distance.
      const isArenaCell = y >= arenaStartRow;
      if (!isInRange && !cell.isAnimating && !isArenaCell) continue;

      // Force isInRange for the Elder and the arena cells
      const cellIsInRange = isArenaCell ? true : isInRange;
      const cellIsVisible = isArenaCell ? true : isVisible;
      const cellIsPassed = isArenaCell ? false : isPassed;

      cellsToDraw.push({
        x: x * DIMS.CELL_SIZE,
        cellX: cell.visual.x || (x * DIMS.CELL_SIZE),
        cellY: cellY,  // background
        drawY: drawY,  // content
        cell,
        gx: x,
        gy: y,
        isVisible: cellIsVisible,
        isPassed: cellIsPassed,
        isInRange: cellIsInRange,
        idleThreatMap, 
        alertThreatMap 
      });

      if (isVisible && y > playerRow && cell.type === OBJECT_TYPES.WALL) {
        losBlockedCols[x] = true;
      }
    }
  }

  // Pass 2: draw the backgrounds of ALL cells (static layer)
  cellsToDraw.forEach(c => drawCellBackground(c.x, c.cellY, c.gx, c.gy));

  // Pass 3: draw the threat highlight layer ON TOP of the backgrounds
  cellsToDraw.forEach(c => drawThreatHighlight(c.x, c.cellY, c.gx, c.gy, c.idleThreatMap, c.alertThreatMap));

  // Pass 4: draw the content of all cells (frames, items, enemies)
  // The Elder and the cell under it are drawn separately via drawBossCard
  cellsToDraw.forEach(c => {
    const isBossPos = runState.levelPhase === 'boss_arena' && runState.boss &&
      c.gx === runState.boss.pos.x && c.gy === runState.boss.pos.y;
    if (!isBossPos) {
      drawCellContent(c.cellX, c.drawY, c.cell, c.gx, c.gy, c.isVisible, c.isPassed, c.isInRange);
    }
  });

  // Player rendering (always, even when HP <= 0)
  const playerCellHeight = getCellHeight(player.pos.y, runState.totalRows);
  const playerCellY = DIMS.CANVAS_HEIGHT - (getRowY(player.pos.y, runState.totalRows) - scrollY) - playerCellHeight;
  const playerAnimOffsetY = (player.visual.y - getRowY(player.pos.y, runState.totalRows)) || 0;
  const playerDrawY = playerCellY - playerAnimOffsetY;
  const playerAnimOffsetX = (player.visual.x - player.pos.x * DIMS.CELL_SIZE) || 0;
  const playerDrawX = player.pos.x * DIMS.CELL_SIZE + playerAnimOffsetX;
  drawPlayerCard(playerDrawX, playerDrawY);

  // Elder rendering (always, when alive and in the arena phase)
  if (runState.levelPhase === 'boss_arena' && runState.boss && runState.boss.currentHp > 0) {
    const boss = runState.boss;
    const bossPos = boss.pos;
    const bossCellHeight = getCellHeight(bossPos.y, runState.totalRows);
    const bossGridY = getRowY(bossPos.y, runState.totalRows);
    const bossCellY = DIMS.CANVAS_HEIGHT - (bossGridY - scrollY) - bossCellHeight;
    const bossDrawX = boss.visual ? boss.visual.x : bossPos.x * DIMS.CELL_SIZE;
    const bossDrawY = bossCellY;
    drawBossCard(bossDrawX, bossDrawY);
  }

  renderTacticalElements(scrollY);

  // Pass 3: draw floating text on top of everything
  renderFloatingTexts(scrollY);

  // Pass 4: draw tutorial hints
  renderTutorialHint();
}

function drawCellBackground(x, y, gx, gy) {
  const { totalRows } = getGameState().runState;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const h = getCellHeight(gy, totalRows) - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Shared background for every cell
  ctx.fillStyle = "#1a1d28"; // Slightly lighter than the base background
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();
  drawAsset(ctx, gy >= totalRows - 2 ? 'cell.arena' : 'cell.regular', 0, 0, w, h, { anchor: [0, 0] });

  // Shared outline for every cell
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

  // Apply transparency for the fade-out animation
  ctx.globalAlpha = cell.visual.alpha;

  // Apply the "fog of war"
  if (isPassed) {
    ctx.globalAlpha *= 0.3;
  } else if (!isVisible && !cell.isAnimating) {
    ctx.globalAlpha *= 0.5;
  }

  const artPlacement = getCellArtPlacement(cell, w, h);
  if (artPlacement) {
    drawAsset(ctx, artPlacement.id, artPlacement.x, artPlacement.y, artPlacement.width, artPlacement.height);
  }

  // Objects have NO background, only an outline (when needed)
  let strokeStyle = null; // No outline by default
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
  else if (cell.type === OBJECT_TYPES.BOSS || (levelPhase === 'boss_arena' && getGameState().runState.boss && gx === getGameState().runState.boss.pos.x && gy === getGameState().runState.boss.pos.y)) {
    const boss = getGameState().runState.boss;
    const canUseCrossbow = player.inventory.ammo > 0;
    const canUseMelee = player.inventory.attackBonuses.length > 0 && player.pos.x === gx;

    if (canUseMelee) {
      strokeStyle = CELL_DEFS[OBJECT_TYPES.ATTACK_BONUS].color;
      lineWidth = 2;
    } else if (canUseCrossbow) {
      strokeStyle = CELL_DEFS[OBJECT_TYPES.AMMO].color;
      lineWidth = 2;
    } else {
      strokeStyle = boss.color || '#FF58F4';
      lineWidth = 2;
    }
  } else if (cell.type === OBJECT_TYPES.ENEMY && cell.data) {
    strokeStyle = isTutorialCell ? "#22c55e" : cell.data.color;
    lineWidth = isTutorialCell ? 3 : 1;
  } else if (cell.type === OBJECT_TYPES.WALL) {
    // Walls get an outline
    strokeStyle = CELL_DEFS[OBJECT_TYPES.WALL].color;
    lineWidth = 1;
  }

  // Only draw the outline when it is needed
  if (strokeStyle) {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // Content rendering
  const isBossCell = cell.type === OBJECT_TYPES.BOSS;
  if (cell.type !== OBJECT_TYPES.EMPTY && (isVisible || isBossCell) && (isInRange || isBossCell)) {
    renderContent(cell, w, h);
  } else if (!isPassed && (!isVisible || !isInRange) && !cell.isAnimating && !isBossCell) {
    // Shadow for hidden cells (stronger dimming)
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

  const cellKey = `${gx},${gy}`;
  const idleCount = idleThreatMap.get(cellKey)?.size || 0;
  const alertCount = alertThreatMap.get(cellKey)?.size || 0;
  const totalCount = idleCount + alertCount;
  
  if (totalCount === 0) return;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);

  const alpha = Math.min(1, 0.25 * totalCount);
  ctx.fillStyle = alertCount > 0
    ? `rgba(245, 158, 11, ${alpha})`
    : `rgba(239, 68, 68, ${alpha})`;
  
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
    const drawY = DIMS.CANVAS_HEIGHT - (ft.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

    ctx.globalAlpha = ft.visual.alpha;
    ctx.fillStyle = ft.color;
    ctx.font = `900 ${Math.round(14 * (DIMS.CELL_SIZE / 64))}px Inter, sans-serif`;
    ctx.fillText(ft.text, drawX, drawY);
  }

  ctx.restore();
}

function renderTacticalElements(scrollY) {
  const { player, rows, levelPhase, boss } = getGameState().runState;

  // 1. Check whether the player has a weapon and any bolts
  if (player.inventory.weapon?.type !== 'crossbow' || player.inventory.ammo <= 0) return;

  // 2. Find targets on the current row within weapon range
  if (levelPhase === 'dungeon' && !player.hasShotOnCurrentRow) {
  const playerY = player.pos.y;
  const playerX = player.pos.x;

  for (let x = 0; x < DIMS.COLS; x++) {
    const distance = Math.abs(x - playerX);
    if (distance === 0 || distance > player.inventory.weapon.range) continue;

    const targetCell = rows[playerY][x];
    if (targetCell.type === OBJECT_TYPES.ENEMY) {
      // Make sure there is no wall in the way
      let isBlocked = false;
      const direction = Math.sign(x - playerX);
      for (let i = 1; i < distance; i++) {
        if (rows[playerY][playerX + i * direction].type === OBJECT_TYPES.WALL) {
          isBlocked = true;
          break;
        }
      }
      if (isBlocked) continue; // Do not draw a line through a wall

      // 3. If a target was found - draw the dashed line
      ctx.save();

      const startX = player.visual.x + DIMS.CELL_SIZE / 2;
      const startY = DIMS.CANVAS_HEIGHT - (player.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

      const endX = targetCell.visual.x + DIMS.CELL_SIZE / 2;
      const endY = DIMS.CANVAS_HEIGHT - (targetCell.visual.y - scrollY) - DIMS.CELL_SIZE / 2;

      ctx.beginPath();
      ctx.setLineDash([5, 10]);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff'; // White
      ctx.stroke();
      ctx.restore();
    }
  }
  } else if (levelPhase === 'boss_arena') {
    // Boss arena logic - always show the dashes when there are bolts left
    const playerX = player.pos.x;
    const bossX = boss.pos.x;
    const distance = Math.abs(bossX - playerX);

    if (distance <= player.inventory.weapon.range) {
      const bossCell = rows[boss.pos.y][boss.pos.x];

      ctx.save();

      const startX = player.visual.x + DIMS.CELL_SIZE / 2;
      const startY = DIMS.CANVAS_HEIGHT - (player.visual.y - scrollY) - player.visual.h / 2;

      const endX = bossCell.visual.x + DIMS.CELL_SIZE / 2;
      const endY = DIMS.CANVAS_HEIGHT - (bossCell.visual.y - scrollY) - (DIMS.CELL_SIZE * 2) / 2;

      ctx.beginPath();
      ctx.setLineDash([5, 10]);
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);

      ctx.lineWidth = 2;
      ctx.strokeStyle = player.hasShotOnCurrentRow ? '#6b7280' : '#ffffff'; // Grey once the player has already shot
      ctx.stroke();
      ctx.restore();
    }
  }
}

function renderContent(cell, w, h) {
  ctx.textAlign = "center";
  const fontScale = DIMS.CELL_SIZE / 64; // Scale fonts relative to the base size of 64
  
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
      // Title
      ctx.fillStyle = d.color;
      ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.label, w / 2, 18 * fontScale);

      // Enemy HP - same colour
      ctx.fillStyle = d.color;
      ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.currentHp, w / 2, h / 2 + (8 * fontScale));
      break;
    }
    case OBJECT_TYPES.BOSS: {
      const d = cell.data;
      if (!d) break; // The Elder is already dead, the data was cleared
      // Title
      ctx.fillStyle = d.color;
      ctx.font = `bold ${Math.round(10 * fontScale)}px Inter, sans-serif`;
      ctx.fillText(d.label, w / 2, 20 * fontScale);

      // Elder HP - same colour
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
  const w = DIMS.CELL_SIZE - pad * 2; // The width is always constant
  const h = player.visual.h - pad * 2;

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Constant white colour for the outline and the title
  const borderColor = '#ffffff'; 

  ctx.fillStyle = "#272b38"; // Lighter background for the player card
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 12);
  ctx.fill();
  const playerAssetId = player.visual.h > DIMS.CELL_SIZE * 1.5
    ? 'player.arena'
    : (player.visual.state ? `player.${player.visual.state}` : 'player.regular');
  drawAsset(ctx, playerAssetId, 0, 0, w, h, { anchor: [0, 0] });
  ctx.stroke();

    // Text
  ctx.textAlign = "center";
  ctx.fillStyle = borderColor;
  ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
      ctx.fillText("PLAYER", w / 2, 18 * fontScale);

    // Health (red when HP <= 0)
  const hpColor = player.hp <= 0 ? "#ef4444" : "#fff";
  ctx.fillStyle = hpColor;
  ctx.font = `900 ${Math.round(14 * fontScale)}px Inter, sans-serif`;
  ctx.fillText(Math.max(0, player.hp), w / 2, h / 2 + (8 * fontScale));

    // Energy, highlighted at critical values
  const energyPercent = player.energy / player.maxEnergy;
    let energyColor = ENERGY_COLOR; // Energy colour from registry
  
  if (energyPercent <= 0) {
    energyColor = "#ef4444"; // Red at 0
  } else if (energyPercent <= 0.3) {
    energyColor = "#f59e0b"; // Orange at <= 30%
  }
  
  ctx.fillStyle = energyColor;
  ctx.font = `bold ${Math.round(8 * fontScale)}px Inter, sans-serif`;
    ctx.fillText(`EN: ${player.energy}/${player.maxEnergy}`, w / 2, h - (6 * fontScale));

  ctx.restore();
}

function drawBossCard(x, y) {
  const { boss } = getGameState().runState;
  if (!boss || boss.currentHp <= 0) return;

  const fontScale = DIMS.CELL_SIZE / 64;
  const pad = CARD_PADDING;
  const w = DIMS.CELL_SIZE - pad * 2;
  const h = DIMS.CELL_SIZE * 2 - pad * 2; // The Elder takes double height

  ctx.save();
  ctx.translate(x + pad, y + pad);

  // Opaque Elder card - always visible
  ctx.globalAlpha = 1.0;

    // Background
  ctx.fillStyle = "#272b38";
  ctx.strokeStyle = boss.color || '#FF58F4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 12);
  ctx.fill();
  const bossAssetId = `boss.${boss.artId || 'boss-01'}.${boss.visual?.state || 'idle'}`;
  drawAsset(ctx, bossAssetId, 0, 0, w, h, { anchor: [0, 0] });
  ctx.stroke();

    // Text
  ctx.textAlign = "center";
  ctx.fillStyle = boss.color || '#FF58F4';
  ctx.font = `bold ${Math.round(10 * fontScale)}px Inter, sans-serif`;
    ctx.fillText(boss.label || 'ELDER', w / 2, 20 * fontScale);

    // Elder HP
  ctx.font = `900 ${Math.round(18 * fontScale)}px Inter, sans-serif`;
  ctx.fillText(boss.currentHp, w / 2, h / 2 + (10 * fontScale));

  ctx.restore();
}

function renderTutorialHint() {
  const step = getCurrentStep();
  if (!step) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, DIMS.CANVAS_WIDTH, 60);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(step.text, DIMS.CANVAS_WIDTH / 2, 30);
  ctx.restore();
}