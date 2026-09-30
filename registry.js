import { BALANCE } from './balance.generated.js';

// Re-exported so that tests and tooling can reach the raw source data without
// importing the generated module directly.
export { BALANCE };

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

// Enemy definitions, straight out of balance.csv. Declared before
// CAMPAIGN_LEVELS is built because the strength window resolves its tiers
// against the base hp of each type.
//
// The key stays stable so that tutorial layouts, level validation and sprite
// ids keep working; `label` is what the player sees. `type` is the spawn share
// and the shares must sum to 1. Enemy damage equals current hp, so a stronger
// type also hits harder.
export const ENEMY_DEFS = BALANCE.enemies;

// Spawn weights are declared as relative numbers in balance.csv and normalised
// here, so hand editing never has to add up to exactly 1. With the shipped
// data all three weights are 1, which makes the pick uniform.
export const ENEMY_TYPE_WEIGHTS = (() => {
  const total = Object.values(ENEMY_DEFS).reduce((sum, def) => sum + def.weight, 0);
  return Object.keys(ENEMY_DEFS).map((enemyType, index, keys) => {
    const normalised = ENEMY_DEFS[enemyType].weight / total;
    // Last entry absorbs the floating point residue so the shares sum to 1.
    if (index < keys.length - 1) return { key: enemyType, weight: normalised };
    const before = keys.slice(0, -1).reduce((sum, key) => sum + ENEMY_DEFS[key].weight / total, 0);
    return { key: enemyType, weight: 1 - before };
  });
})();

// Rolls an enemy type key from ENEMY_TYPE_WEIGHTS.
export function rollEnemyType(random) {
  const roll = random();
  let cumulative = 0;

  for (let index = 0; index < ENEMY_TYPE_WEIGHTS.length; index += 1) {
    cumulative += ENEMY_TYPE_WEIGHTS[index].weight;
    if (roll < cumulative) return ENEMY_TYPE_WEIGHTS[index].key;
  }

  return ENEMY_TYPE_WEIGHTS[ENEMY_TYPE_WEIGHTS.length - 1].key;
}

// Campaign difficulty curve: linear interpolation between the first and last level.
// from - value on Dungeon 1, to - value on the last dungeon.
//
// Every number below comes from balance.csv via balance.generated.js. Nothing
// here may hardcode a tunable; edit balance.csv and run `npm run build:balance`.
export const CAMPAIGN_CURVE = {
  total: BALANCE.campaign.total,
  idPrefix: BALANCE.campaign.idPrefix,
  rows: BALANCE.campaign.rows,
  bossHpMultiplier: BALANCE.campaign.bossHpMultiplier,
  chances: BALANCE.campaign.chances,
};

function roundChance(value) {
  return Math.round(value * 10000) / 10000;
}

// Enemy strength window, shared by every enemy type.
//
// A fixed band of shape.length tiers that slides upwards across the campaign.
//
// floor is the offset of the weakest tier against the type's base hp from
// ENEMY_DEFS, on the first and on the last dungeon. With the shipped numbers a
// type starts one step below its base and ends six steps above it, so an
// ARCANIST (base 4) opens on 3-5 and closes on 10-12.
//
// shape holds the shares of the tiers inside the band, weakest first.
//
// The floor travels as a float, so the band hands over gradually: while it
// sits between two whole offsets the trailing tier fades out at the same time
// as the leading tier fades in. That is what makes old strengths wane instead
// of vanishing between two dungeons, and it removes the step the floor used to
// take on the last level.
//
// Raising the ceiling means raising floor.to in balance.csv; there is no other
// cap.
export const ENEMY_STRENGTH_WINDOW = BALANCE.enemyWindow;

// Resolves the window into concrete hp tiers for one enemy type on one level.
function buildStrengthTable(window, baseHp, lerp) {
  const floorPosition = lerp(window.floor);
  const lowest = Math.floor(floorPosition);
  const blend = floorPosition - lowest;
  const [weakest, middle, strongest] = window.shape;

  // The band straddles two whole offsets, so blend the two alignments together.
  // blend 0 means the window sits exactly on `lowest`, blend 1 on `lowest + 1`.
  const shares = new Map();
  const add = (offset, weight) => {
    if (weight <= 0) return;
    shares.set(offset, (shares.get(offset) || 0) + weight);
  };

  add(lowest, (1 - blend) * weakest);
  add(lowest + 1, (1 - blend) * middle + blend * weakest);
  add(lowest + 2, (1 - blend) * strongest + blend * middle);
  add(lowest + 3, blend * strongest);

  if (shares.size === 0) return [{ hp: baseHp, weight: 1 }];

  const total = [...shares.values()].reduce((sum, weight) => sum + weight, 0);
  const table = [...shares.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, weight]) => ({ hp: baseHp + offset, weight: roundChance(weight / total) }))
    // Rounding can collapse a sliver to zero; such a tier can never be rolled,
    // and leaving it in would let the rollEnemyHp fallback return it.
    .filter(tier => tier.weight > 0);

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
        ENEMY_STRENGTH_WINDOW,
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

// Cell and item definitions. The values come from balance.csv, keyed here by the
// OBJECT_TYPES members so that the rest of the game can keep looking cells up by
// their runtime type value.
export const CELL_DEFS = {
  [OBJECT_TYPES.WALL]: BALANCE.cells.WALL,
  [OBJECT_TYPES.HEAL]: BALANCE.cells.HEAL,
  [OBJECT_TYPES.AMMO]: BALANCE.cells.AMMO,
  [OBJECT_TYPES.ENERGY]: BALANCE.cells.ENERGY,
  [OBJECT_TYPES.ATTACK_BONUS]: BALANCE.cells.ATTACK_BONUS,
  [OBJECT_TYPES.DEFENSE_BONUS]: BALANCE.cells.DEFENSE_BONUS,
  [OBJECT_TYPES.ATTACK_CELL]: BALANCE.cells.ATTACK_CELL,
  [OBJECT_TYPES.GOLD]: BALANCE.cells.GOLD,
};

// Player stats, straight out of balance.csv. Flat for the whole campaign because
// meta upgrades are not wired up yet; the Elder takes player hp times
// bossHpMultiplier and has no field of its own.
export const PLAYER_DEFS = BALANCE.player;