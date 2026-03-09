// Временное хранилище данных об уровнях.
// В будущем это будет загружаться из localStorage или сервера.
export const LEVELS = [
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
      "DEFENSE_BONUS": 0.03
    }
  },
  {
    "id": "sector_1",
    "rows": 30,
    "name": "Сектор 1",
    "bossHpMultiplier": 1.2,
    "chances": {
      "ENEMY": 0.1,
      "WALL": 0.15,
      "HEAL": 0.06,
      "AMMO": 0.05,
      "ENERGY": 0.06,
      "ATTACK_BONUS": 0.05,
      "DEFENSE_BONUS": 0.06
    }
  },
  {
    "id": "sector_2",
    "rows": 50,
    "name": "Сектор 2",
    "bossHpMultiplier": 3.5,
    "chances": {
      "ENEMY": 0.15,
      "WALL": 0.1,
      "HEAL": 0.05,
      "AMMO": 0.04,
      "ENERGY": 0.04,
      "ATTACK_BONUS": 0.03,
      "DEFENSE_BONUS": 0.03
    }
  },
  {
    "id": "core",
    "rows": 75,
    "name": "Ядро",
    "bossHpMultiplier": 5,
    "chances": {
      "ENEMY": 0.2,
      "WALL": 0.15,
      "HEAL": 0.05,
      "AMMO": 0.04,
      "ENERGY": 0.04,
      "ATTACK_BONUS": 0.03,
      "DEFENSE_BONUS": 0.03
    }
  }
];

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
};

export const ENEMY_DEFS = {
  TYPE_1: {
    label: 'СНАЙПЕР',
    hp: 4,
    visionRange: 4, // Видит на 3 клетки вперед
    actionRange: 4, // Может атаковать с расстояния в 3 клетки
    color: '#f87171'
  },
  TYPE_2: {
    label: 'СТРАЖ',
    hp: 8,
    visionRange: 2, // Видит на 2 клетки вперед
    actionRange: 2, // Может атаковать с расстояния в 2 клетки
    color: '#ef4444'
  }
};

export const CELL_DEFS = {
  [OBJECT_TYPES.WALL]: {
    label: 'Стена',
    color: '#3f4556',
    blocksMovement: true
  },
  [OBJECT_TYPES.HEAL]: {
    label: 'ЗДОРОВЬЕ',
    value: '+6',
    amount: 6,
    color: '#10b981'
  },
  [OBJECT_TYPES.AMMO]: {
    label: 'ЗАРЯДЫ',
    value: '+2',
    amount: 2,
    color: '#f59e0b' // Amber color
  },
  [OBJECT_TYPES.ENERGY]: {
    label: 'ЭНЕРГИЯ',
    value: '+10',
    amount: 10,
    color: '#3b82f6' // Blue color
  },
  [OBJECT_TYPES.ATTACK_BONUS]: {
    label: 'АТАКА',
    value: 5,
    color: '#fde047' // Yellow-300
  },
  [OBJECT_TYPES.DEFENSE_BONUS]: {
    label: 'ЗАЩИТА',
    value: 5,
    color: '#a5b4fc' // Indigo-300
  },
  [OBJECT_TYPES.ATTACK_CELL]: {
    label: 'АТАКА',
    value: 10, // Урон по умолчанию для клетки атаки
    color: '#fca5a5' // Red-300
  }
};