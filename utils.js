import { OBJECT_TYPES, CELL_DEFS } from './registry.js';

export function createPRNG(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

export function generateArenaObject(x, y, totalRows, random, hpPercent = 1.0) {
  const isPlayerRow = y === totalRows - 2;
  
  const baseChances = { 
    ATTACK_CELL: 0.20, 
    ATTACK_BONUS: 0.20, 
    DEFENSE_BONUS: 0.20, 
    HEAL: 0.25,
  };
  
  let chances = { ...baseChances };
  
  if (hpPercent < 0.5) {
    chances.HEAL = 0.35;
    chances.ATTACK_CELL = 0.10;
    chances.DEFENSE_BONUS = 0.25;
  } else if (hpPercent > 0.75) {
    chances.ATTACK_CELL = 0.30;
    chances.ATTACK_BONUS = 0.25;
    chances.HEAL = 0.15;
  }
  
  if (isPlayerRow) {
    chances.AMMO = 0.05;
    chances.ENERGY = 0.05;
  }

  const totalChance = Object.values(chances).reduce((sum, chance) => sum + chance, 0);
  const normalizedChances = {};
  for (const key in chances) {
    normalizedChances[key] = chances[key] / totalChance;
  }

  const rand = random();
  let cumulativeChance = 0;

  for (const key in normalizedChances) {
    if (rand < (cumulativeChance += normalizedChances[key])) {
      const type = OBJECT_TYPES[key];
      let data = null;
      if (type === OBJECT_TYPES.ATTACK_BONUS || type === OBJECT_TYPES.DEFENSE_BONUS) {
        data = { value: CELL_DEFS[type].value };
      } else if (type === OBJECT_TYPES.ATTACK_CELL) {
        // Случайный урон от 5 до 15
        const minDamage = 5;
        const maxDamage = 10;
        data = { value: Math.floor(random() * (maxDamage - minDamage + 1)) + minDamage };
      }
      return { type, data };
    }
  }

  const fallbackType = OBJECT_TYPES.ATTACK_CELL;
  const minDamage = 5;
  const maxDamage = 10;
  return { type: fallbackType, data: { value: Math.floor(random() * (maxDamage - minDamage + 1)) + minDamage } };
}

// Заполняет пустую клетку арены новым объектом
export function spawnArenaObject(cell, x, y, totalRows, hpPercent = 1.0) {
  const prevType = cell.type;
  const random = createPRNG(Date.now() + x * 1000 + y);
  const { type, data } = generateArenaObject(x, y, totalRows, random, hpPercent);
  cell.type = type;
  cell.data = data;
  cell.visual.alpha = 1.0;
  cell.isAnimating = false;
  console.log(`[SPAWN] (${x},${y}) ${prevType} → ${type}`, data);
}
