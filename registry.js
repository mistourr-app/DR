// Data version - bump when levels, enemies or balance change
export const DATA_VERSION = 4;

// Hand-authored levels: the tutorial and the debug arenas.
// The Dungeon 1..30 campaign is generated from CAMPAIGN_CURVE.
const STATIC_LEVELS = [
  {
    "id": "tutorial",
    "rows": 13,
    "name": "TUTORIAL",
    "bossHpMultiplier": 1,
    "isTutorial": true,
    "layout": [
      [
        {},
        {},
        {},
        {},
        {}
      ],
      [
        {},
        {},
        {},
        {},
        {}
      ],
      [
        {},
        {},
        {},
        {},
        {}
      ],
      [
        {},
        {},
        {
          "type": "heal"
        },
        {},
        {}
      ],
      [
        {},
        {},
        {
          "type": "ammo"
        },
        {},
        {}
      ],
      [
        {},
        {},
        {
          "type": "enemy",
          "enemyType": "TYPE_2"
        },
        {},
        {}
      ],
      [
        {},
        {},
        {},
        {},
        {}
      ],
      [
        {
          "type": "enemy",
          "enemyType": "TYPE_1"
        },
        {},
        {},
        {},
        {}
      ],
      [
        {},
        {},
        {},
        {},
        {}
      ],
      [
        {},
        {},
        {
          "type": "attack_bonus"
        },
        {},
        {}
      ],
      [
        {},
        {},
        {
          "type": "enemy",
          "enemyType": "TYPE_2"
        },
        {},
        {}
      ],
      [
        {
          "type": "attack_bonus",
          "data": {
            "value": 5
          }
        },
        {
          "type": "attack_cell",
          "data": {
            "value": 10
          }
        },
        {
          "type": "heal",
          "data": {
            "amount": 17
          }
        },
        {
          "type": "attack_cell",
          "data": {
            "value": 10
          }
        },
        {
          "type": "attack_bonus",
          "data": {
            "value": 5
          }
        }
      ],
      [
        {
          "type": "attack_cell",
          "data": {
            "value": 5
          }
        },
        {
          "type": "heal"
        },
        {},
        {
          "type": "heal"
        },
        {
          "type": "attack_cell",
          "data": {
            "value": 5
          }
        }
      ]
    ]
  },
  {
    "id": "test_arena",
    "rows": 6,
    "name": "TEST ARENA",
    "bossHpMultiplier": 1.5,
    "hidden": true,
    "chances": {
      "ENEMY": 0.1,
      "WALL": 0.1,
      "HEAL": 0.05,
      "AMMO": 0.04,
      "ENERGY": 0.04,
      "ATTACK_BONUS": 0.03,
      "DEFENSE_BONUS": 0.03,
      "GOLD": 0.03
    }
  },
  {
    "id": "debug_boss",
    "rows": 3,
    "name": "[DEBUG] ARENA",
    "bossHpMultiplier": 1,
    "isTutorial": false,
    "hidden": true,
    "chances": {
      "ENEMY": 0,
      "WALL": 0,
      "HEAL": 0,
      "AMMO": 0,
      "ENERGY": 0,
      "ATTACK_BONUS": 0,
      "DEFENSE_BONUS": 0,
      "GOLD": 0
    }
  }
];

// Enemy definitions. Declared before CAMPAIGN_LEVELS is built because the
// strength ladder resolves its tiers against the base hp of each type.
export const ENEMY_DEFS = {
  TYPE_1: {
    label: 'ARCANIST',
    hp: 4,
    visionRange: 4, // Sees 4 cells ahead
    actionRange: 4, // Can attack from 4 cells away
    color: '#FF1F1F'
  },
  TYPE_2: {
    label: 'SPEARMAN',
    hp: 7,
    visionRange: 2, // Sees 2 cells ahead
    actionRange: 2, // Can attack from 2 cells away
    color: '#FF1F1F'
  },
  TYPE_3: {
    label: 'WARDEN',
    hp: 10,
    visionRange: 1, // Sees only the cells directly to its sides
    actionRange: 1, // Can attack only the cells directly to its sides
    color: '#FF1F1F'
  }
};

// Campaign difficulty curve: linear interpolation between the first and last level.
// from - value on Dungeon 1, to - value on Dungeon 30.
export const CAMPAIGN_CURVE = {
  total: 30,
  idPrefix: 'dungeon_',
  rows: { from: 30, to: 75 },
  bossHpMultiplier: { from: 1.2, to: 5 },
  chances: {
    ENEMY: { from: 0.1, to: 0.2 },
    WALL: { from: 0.15, to: 0.3 },
    HEAL: { from: 0.06, to: 0.05 },
    AMMO: { from: 0.05, to: 0.04 },
    ENERGY: { from: 0.06, to: 0.04 },
    ATTACK_BONUS: { from: 0.05, to: 0.03 },
    DEFENSE_BONUS: { from: 0.06, to: 0.03 },
    GOLD: { from: 0.03, to: 0.03 },
  },
};

function roundChance(value) {
  return Math.round(value * 10000) / 10000;
}

// Enemy strength ladder, shared by every enemy type.
//
// offset is relative to the type's base hp from ENEMY_DEFS, so a tier means
// "base hp + offset". weight.from is the share of that tier on Dungeon 1,
// weight.to the share on the last dungeon; the two are interpolated linearly
// per level. Both ends sum to 1, so the interpolated weights stay normalised.
//
// Early on the low tiers dominate and the strong ones are nearly absent; later
// the low tiers fade out while new high tiers take over the mass. There is no
// hard ceiling: append a row to raise the top of the ladder.
export const ENEMY_STRENGTH_TIERS = [
  { offset: -1, weight: { from: 0.70, to: 0.00 } },
  { offset: 0, weight: { from: 0.20, to: 0.00 } },
  { offset: 1, weight: { from: 0.10, to: 0.05 } },
  { offset: 2, weight: { from: 0.00, to: 0.35 } },
  { offset: 3, weight: { from: 0.00, to: 0.25 } },
  { offset: 4, weight: { from: 0.00, to: 0.20 } },
  { offset: 5, weight: { from: 0.00, to: 0.10 } },
  { offset: 6, weight: { from: 0.00, to: 0.05 } },
];

// Resolves the ladder into concrete hp tiers for one enemy type on one level.
// Tiers whose interpolated weight rounds to zero are dropped so that callers
// only ever see tiers that can actually spawn.
function buildStrengthTable(tiers, baseHp, lerp) {
  const entries = [];

  tiers.forEach((tier) => {
    const weight = roundChance(lerp(tier.weight));
    if (weight <= 0) return;
    entries.push({ hp: baseHp + tier.offset, weight });
  });

  if (entries.length === 0) return [{ hp: baseHp, weight: 1 }];

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const table = entries.map(entry => ({ hp: entry.hp, weight: roundChance(entry.weight / total) }));

  // Rounding every share independently can leave the table a few 1e-4 short of 1.
  // Push the residue into the heaviest tier so the shares always sum to exactly 1.
  let heaviest = 0;
  table.forEach((tier, index) => {
    if (tier.weight > table[heaviest].weight) heaviest = index;
  });
  table[heaviest].weight = roundChance(
    table[heaviest].weight + (1 - table.reduce((sum, tier) => sum + tier.weight, 0)),
  );

  return table;
}

// Rolls an hp value from a strength table produced by buildStrengthTable.
export function rollEnemyHp(strengthTable, random) {
  if (!Array.isArray(strengthTable) || strengthTable.length === 0) return null;

  const roll = random();
  let cumulative = 0;

  for (let index = 0; index < strengthTable.length; index += 1) {
    cumulative += strengthTable[index].weight;
    if (roll < cumulative) return strengthTable[index].hp;
  }

  // Guards against floating point drift leaving the last tier unreachable.
  return strengthTable[strengthTable.length - 1].hp;
}

function buildCampaignLevels(curve) {
  const lastIndex = curve.total - 1;
  const levels = [];

  for (let index = 0; index < curve.total; index += 1) {
    // Linear progress: 0 on the first level, 1 on the last one.
    const progress = lastIndex === 0 ? 0 : index / lastIndex;
    const lerp = ({ from, to }) => from + (to - from) * progress;
    const chances = {};

    Object.keys(curve.chances).forEach((key) => {
      chances[key] = roundChance(lerp(curve.chances[key]));
    });

    const enemyStrength = {};
    Object.keys(ENEMY_DEFS).forEach((enemyType) => {
      enemyStrength[enemyType] = buildStrengthTable(
        ENEMY_STRENGTH_TIERS,
        ENEMY_DEFS[enemyType].hp,
        lerp,
      );
    });

    const number = index + 1;
    levels.push({
      id: `${curve.idPrefix}${String(number).padStart(2, '0')}`,
      rows: Math.round(lerp(curve.rows)),
      name: `Dungeon ${number}`,
      difficulty: number,
      bossHpMultiplier: roundChance(lerp(curve.bossHpMultiplier)),
      chances,
      enemyStrength,
    });
  }

  return levels;
}

export const CAMPAIGN_LEVELS = buildCampaignLevels(CAMPAIGN_CURVE);

// Temporary level data store.
// In the future this will be loaded from localStorage or a server.
export const LEVELS = [...STATIC_LEVELS, ...CAMPAIGN_LEVELS];

export const LEVEL_CHANCE_KEYS = [
  'ENEMY',
  'WALL',
  'HEAL',
  'AMMO',
  'ENERGY',
  'ATTACK_BONUS',
  'DEFENSE_BONUS',
  'GOLD',
];

const VALID_CELL_TYPES = new Set(Object.values({
  EMPTY: 'empty',
  ENEMY: 'enemy',
  HEAL: 'heal',
  WALL: 'wall',
  AMMO: 'ammo',
  ENERGY: 'energy',
  ATTACK_BONUS: 'attack_bonus',
  DEFENSE_BONUS: 'defense_bonus',
  ATTACK_CELL: 'attack_cell',
  GOLD: 'gold',
}));

const MAX_LEVEL_ROWS = 100;
const MAX_BOSS_HP_MULTIPLIER = 100;
const MAX_CELL_VALUE = 1000;
const MAX_HEAL_AMOUNT = 1000;
const MAX_LEVEL_NAME_LENGTH = 100;

function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateCellDefinition(cell, rowIndex, cellIndex, rowCount, errors) {
  if (cell === undefined || cell === null) return;
  if (!isRecord(cell)) {
    errors.push(`layout[${rowIndex}][${cellIndex}] must be an object`);
    return;
  }

  if (cell.type === undefined || cell.type === null || cell.type === '') return;
  if (typeof cell.type !== 'string' || !VALID_CELL_TYPES.has(cell.type.toLowerCase())) {
    errors.push(`layout[${rowIndex}][${cellIndex}] has an unknown type`);
    return;
  }

  const type = cell.type.toLowerCase();
  if (type === 'enemy') {
    const enemyType = cell.enemyType || 'TYPE_1';
    if (typeof enemyType !== 'string' || !Object.prototype.hasOwnProperty.call(ENEMY_DEFS, enemyType)) {
      errors.push(`layout[${rowIndex}][${cellIndex}] has an unknown enemyType`);
    }
  }

  if (!['attack_bonus', 'defense_bonus', 'attack_cell', 'heal', 'gold'].includes(type)) return;
  if (cell.data === undefined || cell.data === null) {
    if (type === 'attack_cell') {
      errors.push(`layout[${rowIndex}][${cellIndex}] requires data.value`);
    }
    return;
  }
  if (!isRecord(cell.data)) {
    errors.push(`layout[${rowIndex}][${cellIndex}].data must be an object`);
    return;
  }

  const dataKey = type === 'heal' || type === 'gold' ? 'amount' : 'value';
  const value = toFiniteNumber(cell.data[dataKey]);
  const minimum = type === 'attack_bonus' || type === 'defense_bonus' || type === 'attack_cell' ? 1 : 0;
  const maximum = type === 'heal' || type === 'gold' ? MAX_HEAL_AMOUNT : MAX_CELL_VALUE;
  if (value === null || value < minimum || value > maximum) {
    errors.push(`layout[${rowIndex}][${cellIndex}].data.${dataKey} has an invalid value`);
  }

  if (type === 'attack_cell' && rowIndex < rowCount - 2) {
    errors.push(`layout[${rowIndex}][${cellIndex}] attack_cell is only allowed in the boss arena`);
  }
}

export function validateLevelDefinition(level) {
  const errors = [];
  if (!isRecord(level)) {
    return { valid: false, errors: ['Level must be an object'] };
  }

  if (typeof level.id !== 'string' || level.id.length > 64 || !/^[a-z0-9_-]+$/i.test(level.id)) {
    errors.push('id must contain up to 64 latin letters, digits, dashes or underscores');
  }
  if (typeof level.name !== 'string' || level.name.trim() === '' || level.name.length > MAX_LEVEL_NAME_LENGTH) {
    errors.push(`name is required and must not exceed ${MAX_LEVEL_NAME_LENGTH} characters`);
  }
  if (!Number.isInteger(level.rows) || level.rows < 3 || level.rows > MAX_LEVEL_ROWS) {
    errors.push(`rows must be an integer from 3 to ${MAX_LEVEL_ROWS}`);
  }

  const bossHpMultiplier = toFiniteNumber(level.bossHpMultiplier);
  if (bossHpMultiplier === null || bossHpMultiplier < 0.1 || bossHpMultiplier > MAX_BOSS_HP_MULTIPLIER) {
    errors.push(`bossHpMultiplier must be a number from 0.1 to ${MAX_BOSS_HP_MULTIPLIER}`);
  }

  if (level.isTutorial) {
    if (!Array.isArray(level.layout) || level.layout.length !== level.rows) {
      errors.push('layout must contain as many rows as rows');
    } else {
      level.layout.forEach((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== 5) {
          errors.push(`layout[${rowIndex}] must contain 5 cells`);
          return;
        }
        row.forEach((cell, cellIndex) => {
          validateCellDefinition(cell, rowIndex, cellIndex, level.rows, errors);
        });
      });
    }
  } else if (!isRecord(level.chances)) {
    errors.push('chances is required for a regular level');
  } else {
    let total = 0;
    LEVEL_CHANCE_KEYS.forEach((key) => {
      const value = toFiniteNumber(level.chances[key]);
      if (value === null || value < 0 || value > 1) {
        errors.push(`chances.${key} must be a number from 0 to 1`);
      } else {
        total += value;
      }
    });
    if (total > 1.000001) {
      errors.push('The sum of chances must not exceed 1');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function getLevelById(id) {
  return LEVELS.find(level => level.id === id);
}

export const OBJECT_TYPES = {
  EMPTY: 'empty',
  ENEMY: 'enemy',
  HEAL: 'heal',
  WALL: 'wall',
  AMMO: 'ammo',
  ENERGY: 'energy',
  ATTACK_BONUS: 'attack_bonus',
  DEFENSE_BONUS: 'defense_bonus',
  BOSS: 'boss',
  ATTACK_CELL: 'attack_cell',
  GOLD: 'gold',
};

export const CELL_DEFS = {
  [OBJECT_TYPES.WALL]: {
    label: 'WALL',
    color: '#3F4556',
    blocksMovement: true
  },
  [OBJECT_TYPES.HEAL]: {
    label: 'HEALTH',
    value: '+6',
    amount: 6,
    color: '#10B981'
  },
  [OBJECT_TYPES.AMMO]: {
    label: 'BOLTS',
    value: '+2',
    amount: 2,
    color: '#5CFAFF'
  },
  [OBJECT_TYPES.ENERGY]: {
    label: 'ENERGY',
    value: '+10',
    amount: 10,
    color: '#9E6DFF'
  },
  [OBJECT_TYPES.ATTACK_BONUS]: {
    label: 'ATTACK',
    value: 5,
    color: '#FF731B'
  },
  [OBJECT_TYPES.DEFENSE_BONUS]: {
    label: 'GUARD',
    value: 5,
    color: '#0084FF'
  },
  [OBJECT_TYPES.ATTACK_CELL]: {
    label: 'ATTACK',
    value: 10, // Default damage of an attack cell
    color: '#C40014'
  },
  [OBJECT_TYPES.GOLD]: {
    label: 'GOLD',
    value: '+5',
    amount: 5,
    color: '#FFE761'
  }
};