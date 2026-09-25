// Версия данных - увеличивайте при изменении уровней, врагов или баланса
export const DATA_VERSION = 3;

// Уровни, заданные вручную: обучение и отладочные полигоны.
// Кампания Dungeon 1..30 генерируется из CAMPAIGN_CURVE.
const STATIC_LEVELS = [
  {
    "id": "tutorial",
    "rows": 13,
    "name": "Обучение",
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
    "name": "Тестовый полигон",
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
    "name": "[DEBUG] Арена",
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

// Кривая сложности кампании: линейная интерполяция между первым и последним уровнем.
// from - значение на Dungeon 1, to - значение на Dungeon 30.
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

function buildCampaignLevels(curve) {
  const lastIndex = curve.total - 1;
  const levels = [];

  for (let index = 0; index < curve.total; index += 1) {
    // Линейный прогресс: 0 на первом уровне, 1 на последнем.
    const progress = lastIndex === 0 ? 0 : index / lastIndex;
    const lerp = ({ from, to }) => from + (to - from) * progress;
    const chances = {};

    Object.keys(curve.chances).forEach((key) => {
      chances[key] = roundChance(lerp(curve.chances[key]));
    });

    const number = index + 1;
    levels.push({
      id: `${curve.idPrefix}${String(number).padStart(2, '0')}`,
      rows: Math.round(lerp(curve.rows)),
      name: `Dungeon ${number}`,
      difficulty: number,
      bossHpMultiplier: roundChance(lerp(curve.bossHpMultiplier)),
      chances,
    });
  }

  return levels;
}

export const CAMPAIGN_LEVELS = buildCampaignLevels(CAMPAIGN_CURVE);

// Временное хранилище данных об уровнях.
// В будущем это будет загружаться из localStorage или сервера.
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
    errors.push(`layout[${rowIndex}][${cellIndex}] должен быть объектом`);
    return;
  }

  if (cell.type === undefined || cell.type === null || cell.type === '') return;
  if (typeof cell.type !== 'string' || !VALID_CELL_TYPES.has(cell.type.toLowerCase())) {
    errors.push(`layout[${rowIndex}][${cellIndex}] содержит неизвестный тип`);
    return;
  }

  const type = cell.type.toLowerCase();
  if (type === 'enemy') {
    const enemyType = cell.enemyType || 'TYPE_1';
    if (typeof enemyType !== 'string' || !Object.prototype.hasOwnProperty.call(ENEMY_DEFS, enemyType)) {
      errors.push(`layout[${rowIndex}][${cellIndex}] содержит неизвестный enemyType`);
    }
  }

  if (!['attack_bonus', 'defense_bonus', 'attack_cell', 'heal', 'gold'].includes(type)) return;
  if (cell.data === undefined || cell.data === null) {
    if (type === 'attack_cell') {
      errors.push(`layout[${rowIndex}][${cellIndex}] требует data.value`);
    }
    return;
  }
  if (!isRecord(cell.data)) {
    errors.push(`layout[${rowIndex}][${cellIndex}].data должен быть объектом`);
    return;
  }

  const dataKey = type === 'heal' || type === 'gold' ? 'amount' : 'value';
  const value = toFiniteNumber(cell.data[dataKey]);
  const minimum = type === 'attack_bonus' || type === 'defense_bonus' || type === 'attack_cell' ? 1 : 0;
  const maximum = type === 'heal' || type === 'gold' ? MAX_HEAL_AMOUNT : MAX_CELL_VALUE;
  if (value === null || value < minimum || value > maximum) {
    errors.push(`layout[${rowIndex}][${cellIndex}].data.${dataKey} имеет недопустимое значение`);
  }

  if (type === 'attack_cell' && rowIndex < rowCount - 2) {
    errors.push(`layout[${rowIndex}][${cellIndex}] attack_cell разрешён только на арене босса`);
  }
}

export function validateLevelDefinition(level) {
  const errors = [];
  if (!isRecord(level)) {
    return { valid: false, errors: ['Уровень должен быть объектом'] };
  }

  if (typeof level.id !== 'string' || level.id.length > 64 || !/^[a-z0-9_-]+$/i.test(level.id)) {
    errors.push('id должен содержать до 64 латинских букв, цифр, дефиса или подчёркивания');
  }
  if (typeof level.name !== 'string' || level.name.trim() === '' || level.name.length > MAX_LEVEL_NAME_LENGTH) {
    errors.push(`name обязателен и не должен превышать ${MAX_LEVEL_NAME_LENGTH} символов`);
  }
  if (!Number.isInteger(level.rows) || level.rows < 3 || level.rows > MAX_LEVEL_ROWS) {
    errors.push(`rows должно быть целым числом от 3 до ${MAX_LEVEL_ROWS}`);
  }

  const bossHpMultiplier = toFiniteNumber(level.bossHpMultiplier);
  if (bossHpMultiplier === null || bossHpMultiplier < 0.1 || bossHpMultiplier > MAX_BOSS_HP_MULTIPLIER) {
    errors.push(`bossHpMultiplier должен быть числом от 0.1 до ${MAX_BOSS_HP_MULTIPLIER}`);
  }

  if (level.isTutorial) {
    if (!Array.isArray(level.layout) || level.layout.length !== level.rows) {
      errors.push('layout должен содержать столько же строк, сколько rows');
    } else {
      level.layout.forEach((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== 5) {
          errors.push(`layout[${rowIndex}] должен содержать 5 клеток`);
          return;
        }
        row.forEach((cell, cellIndex) => {
          validateCellDefinition(cell, rowIndex, cellIndex, level.rows, errors);
        });
      });
    }
  } else if (!isRecord(level.chances)) {
    errors.push('chances обязателен для обычного уровня');
  } else {
    let total = 0;
    LEVEL_CHANCE_KEYS.forEach((key) => {
      const value = toFiniteNumber(level.chances[key]);
      if (value === null || value < 0 || value > 1) {
        errors.push(`chances.${key} должен быть числом от 0 до 1`);
      } else {
        total += value;
      }
    });
    if (total > 1.000001) {
      errors.push('Сумма chances не должна превышать 1');
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

export const ENEMY_DEFS = {
  TYPE_1: {
    label: 'СНАЙПЕР',
    hp: 4,
    visionRange: 4, // Видит на 3 клетки вперед
    actionRange: 4, // Может атаковать с расстояния в 3 клетки
    color: '#FF1F1F'
  },
  TYPE_2: {
    label: 'СТРАЖ',
    hp: 8,
    visionRange: 2, // Видит на 2 клетки вперед
    actionRange: 2, // Может атаковать с расстояния в 2 клетки
    color: '#FF1F1F'
  }
};

export const CELL_DEFS = {
  [OBJECT_TYPES.WALL]: {
    label: 'Стена',
    color: '#3F4556',
    blocksMovement: true
  },
  [OBJECT_TYPES.HEAL]: {
    label: 'ЗДОРОВЬЕ',
    value: '+6',
    amount: 6,
    color: '#10B981'
  },
  [OBJECT_TYPES.AMMO]: {
    label: 'ЗАРЯДЫ',
    value: '+2',
    amount: 2,
    color: '#5CFAFF'
  },
  [OBJECT_TYPES.ENERGY]: {
    label: 'ЭНЕРГИЯ',
    value: '+10',
    amount: 10,
    color: '#9E6DFF'
  },
  [OBJECT_TYPES.ATTACK_BONUS]: {
    label: 'АТАКА',
    value: 5,
    color: '#FF731B'
  },
  [OBJECT_TYPES.DEFENSE_BONUS]: {
    label: 'ЗАЩИТА',
    value: 5,
    color: '#0084FF'
  },
  [OBJECT_TYPES.ATTACK_CELL]: {
    label: 'АТАКА',
    value: 10, // Урон по умолчанию для клетки атаки
    color: '#C40014'
  },
  [OBJECT_TYPES.GOLD]: {
    label: 'ЗОЛОТО',
    value: '+5',
    amount: 5,
    color: '#FFE761'
  }
};