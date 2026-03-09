// Эти значения будут обновляться при изменении размера окна
export const DIMS = {
  CELL_SIZE: 64,
  COLS: 5,
  VISIBLE_ROWS: 4, // Как вы и просили, 4 видимых ряда
  CANVAS_WIDTH: 320,
  CANVAS_HEIGHT: 480,
  TOP_UI_H: 60, // Высота верхней панели UI
  BOTTOM_UI_H: 100, // Высота нижней панели UI
};

export const AppState = {
  BOOT: 'BOOT',
  META_HUB: 'META_HUB',
  RUN_PLAYING: 'RUN_PLAYING',
  RUN_SUMMARY: 'RUN_SUMMARY',
  RUN_VICTORY: 'RUN_VICTORY',
};