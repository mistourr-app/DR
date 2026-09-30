// These values are updated whenever the window is resized
export const DIMS = {
  CELL_SIZE: 64,
  COLS: 5,
  VISIBLE_ROWS: 4, // 4 visible rows, as requested
  CANVAS_WIDTH: 320,
  CANVAS_HEIGHT: 480,
  TOP_UI_H: 60, // Height of the top UI bar
  BOTTOM_UI_H: 100, // Height of the bottom UI bar
};

export const AppState = {
  BOOT: 'BOOT',
  META_HUB: 'META_HUB',
  RUN_PLAYING: 'RUN_PLAYING',
  RUN_SUMMARY: 'RUN_SUMMARY',
  RUN_VICTORY: 'RUN_VICTORY',
};