# Graphics Pipeline

## 1. Решение по формату

Вся графика поставляется в PNG. Figma/master-artboard для полноэкранной графики: `1125×2436` — это физический reference-размер для `375×812 CSS` при DPR 3.

Для полноэкранных изображений экспорт выполняется `1:1` из целевого artboard. Не нужно увеличивать маленький растр: экспорт `@2x/@4x` не добавляет детализацию.

Для отдельных игровых объектов используются максимальные физические размеры:

| Объект | PNG-источник |
|---|---:|
| Background | `1125×2436` или больше |
| Dungeon/arena tile | `256×256` |
| Regular cell | `256×256` |
| Arena cell | `256×512` |
| Enemy | `256×256` |
| Player | `256×256` |
| Player arena | `256×512` |
| Boss | `256×512` |
| Item icon | `128×128` |
| FX | `256×256` или `512×512` |
| HUD source | `1125×180` / `1125×300` |
| Fullscreen UI | `1125×2436` |

Растровые ассеты рисуются в максимальном физическом размере и затем уменьшаются браузером. Это уменьшение, а не upscale.

## 2. Что адаптируется

### `cover`

Используется для полноэкранных фонов и overlay:

- `field.background`
- `field.vignette`
- `ui.screen.*`

Изображение заполняет viewport и обрезает лишние края. В Figma центральная safe area должна содержать всю важную композицию.

### `tile`

Используется для бесшовных повторяющихся текстур:

- dungeon floor;
- arena floor;
- grid;
- декоративные паттерны.

Края должны быть seamless. В manifest указывается `scale`, потому что источник `256×256` может быть больше или меньше логической клетки.

### `nine-slice`

Используется для:

- верхнего HUD;
- нижнего HUD;
- панелей босса;
- кнопок;
- окон;
- inventory slots.

Углы не растягиваются. В manifest указываются `insets: [top, right, bottom, left]` в пикселях исходного PNG.

### `sprite`

Используется для:

- игрока;
- врагов;
- босса;
- предметов;
- иконок;
- снарядов;
- эффектов.

В manifest указывается anchor:

- actor: `[0.5, 1]`;
- item/effect: `[0.5, 0.5]`;
- cell/background: `[0, 0]`.

### `contain`

Используется для центральных иллюстраций, которые нельзя обрезать.

## 3. Figma-структура

```text
00_README
01_Tokens
02_Reference_Screens
03_Field
04_Cells
05_Items
06_Player
07_Enemies
08_Bosses
09_FX
10_UI_Components
11_UI_Screens
12_Tutorial
13_Prototypes
14_Exports
```

### Обязательные reference-фреймы

```text
Reference/Phone-375x812
Reference/Phone-393x852
Reference/Phone-430x932
Reference/Tablet-768x1024
Reference/Raster-1125x2436
```

### Токены

На `01_Tokens` фиксируются:

- цвета;
- safe areas;
- типографика;
- радиусы;
- толщины обводок;
- размеры иконок;
- состояния disabled/active/danger.

Текущие runtime-цвета:

```text
background  #090A0C
cell        #1A1D28
surface     #272B38
border      #2D313D
text        #E5E7EB
muted       #94A3B8
heal        #10B981
ammo        #5CFAFF
energy      #9E6DFF
attack      #FF731B
defense     #0084FF
attack-cell #C40014
gold        #FFE761
enemy       #FF1F1F
boss        #FF58F4
wall        #3F4556
```

## 4. Компоненты и состояния

### Cells

```text
Cell/Regular/Default
Cell/Regular/Target
Cell/Regular/JumpTarget
Cell/Regular/BlockedTarget
Cell/Regular/Visited
Cell/Regular/Hidden
Cell/Arena/Default
Cell/Arena/Target
Cell/Arena/BossTarget
Cell/Arena/Danger
```

### Player

```text
Player/Idle
Player/Move
Player/Shoot
Player/Melee
Player/Damaged
Player/Defeated
Player/Arena
```

### Enemies

```text
Enemy/TYPE_1/Idle
Enemy/TYPE_1/Alert
Enemy/TYPE_1/Attack
Enemy/TYPE_1/Damaged
Enemy/TYPE_1/Death

Enemy/TYPE_2/Idle
Enemy/TYPE_2/Alert
Enemy/TYPE_2/Attack
Enemy/TYPE_2/Damaged
Enemy/TYPE_2/Death
```

### Bosses

```text
Boss/Boss-01/Idle
Boss/Boss-01/Move
Boss/Boss-01/AttackCell
Boss/Boss-01/Damaged
Boss/Boss-01/Death
```

### UI

```text
Button/Primary/Default
Button/Primary/Hover
Button/Primary/Pressed
Button/Primary/Disabled
Button/Secondary/Default
Slot/Empty
Slot/Weapon
Slot/Ammo
Slot/Attack
Slot/Defense
Slot/BossAttack
Slot/BossDefense
```

## 5. Что нельзя запекать в PNG

Динамический текст остаётся DOM/canvas-текстом:

- HP;
- energy;
- ammo;
- `+5`, `+10`;
- damage numbers;
- row counter;
- tutorial text;
- button labels, если они меняются;
- состояния ошибок.

Можно запекать:

- логотипы;
- декоративные надписи;
- статические детали;
- рамки;
- иконки;
- визуальные части карточек.

## 6. Manifest

Файл `assets/manifest.json` — источник правды для runtime.

Пример:

```json
{
  "id": "ui.hud.top",
  "enabled": true,
  "src": "assets/ui/hud-top.png",
  "mode": "nine-slice",
  "sourceSize": [1125, 180],
  "insets": [60, 120, 60, 120],
  "minSize": [360, 120]
}
```

Значение `enabled: false` означает, что asset заготовлен, но не должен загружаться. После экспорта PNG его нужно переключить в `true`.

## 7. Имена файлов

```text
assets/<category>/<entity>/<state>.png
assets/ui/<component>.png
```

Примеры:

```text
assets/field/background.png
assets/cell/regular.png
assets/items/heal.png
assets/player/idle.png
assets/enemies/type-1/alert.png
assets/bosses/boss-01/attack-cell.png
assets/fx/impact.png
assets/ui/hud-top.png
```

## 8. Runtime-интеграция

### Загрузка

`assets/loader.js`:

- загружает manifest;
- загружает только `enabled: true` assets;
- кэширует bitmap;
- не блокирует игровой цикл;
- использует procedural fallback при ошибке;
- поддерживает `sprite`, `cover`, `contain`, `tile`, `nine-slice`.

### Canvas

Canvas должен использовать DPR:

```text
canvas backing store = logical size × devicePixelRatio
canvas CSS size = logical size
```

Рисование продолжает выполняться в логических координатах.

### Renderer

Порядок слоёв:

```text
fullscreen background
field tile/grid
cell background
threat overlay
cell content / item art
player
boss
tactical line
FX
floating text
tutorial hint
```

Threat overlay остаётся поверх art клетки, но под actor/content.

### UI

UI-assets подключаются через `assets/loader.js` и `getAssetUrl()`:

- HUD;
- slots;
- buttons;
- screen backgrounds;
- icons.

Не следует менять `innerHTML` artwork-элементов каждый кадр. Стабильные DOM-узлы обновляются через CSS/textContent.

## 9. PWA

После добавления graphics:

1. Manifest должен попасть в `sw.js`.
2. Enabled assets должны precache-иться.
3. Cache version и UI version marker обновляются вместе.
4. Новый graphics bundle не должен ломать offline navigation.
5. Если используются только PNG, MIME-проблем с WebP/AVIF нет.

## 10. Порядок внедрения

### Этап 0 — baseline

- зафиксировать чистый commit;
- сохранить скриншоты текущего renderer;
- не смешивать art pass с gameplay redesign.

### Этап 1 — infrastructure

- добавить manifest;
- добавить loader;
- добавить DPR-aware canvas;
- добавить `graphics:check`;
- проверить fallback.

### Этап 2 — field

- background;
- dungeon tile;
- arena tile;
- grid;
- vignette;
- cell frames.

### Этап 3 — objects

- items;
- player;
- enemies;
- boss.

### Этап 4 — UI

- HUD;
- slots;
- buttons;
- screens;
- icons.

### Этап 5 — FX

- projectile;
- impact;
- pickup;
- heal;
- death;
- boss telegraph.

### Этап 6 — responsive/offline

- portrait;
- landscape;
- tablet;
- retina;
- offline PWA;
- performance.

## 11. Definition of Done для art

Ассет считается готовым, если:

- PNG существует по пути из manifest;
- `sourceSize` совпадает с реальным PNG;
- `mode` задан корректно;
- `anchor` и `safeArea` указаны;
- asset не содержит динамический текст;
- картинка не обрезается в safe area;
- 9-slice корректно растягивается;
- tile бесшовный;
- sprite не растягивается по осям;
- asset работает на 375×812, 393×852, 430×932 и 768×1024;
- fallback не ломает gameplay, если asset не загрузился;
- PWA precache обновлён;
- `npm run graphics:check` проходит.
