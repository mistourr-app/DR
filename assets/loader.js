const MANIFEST_URL = new URL('./manifest.json', import.meta.url).href;
const ASSET_MODES = new Set(['sprite', 'cover', 'contain', 'tile', 'nine-slice']);
const assets = new Map();
const listeners = new Set();
let manifest = { version: 1, referenceSize: [1125, 2436], assets: {} };
let loadPromise = null;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePair(value, fallback) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return fallback;
  return [first, second];
}

function normalizeInsets(value) {
  const pair = normalizePair(value, null);
  if (pair) return pair;
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, 0, 0];
  const numbers = value.map((item) => Number(item));
  return numbers.every((item) => Number.isFinite(item) && item >= 0) ? numbers : [0, 0, 0, 0];
}

function normalizeEntry(id, value) {
  if (!isRecord(value) || value.enabled === false || typeof value.src !== 'string' || value.src.length === 0) {
    return null;
  }

  const mode = ASSET_MODES.has(value.mode) ? value.mode : 'sprite';
  return {
    ...value,
    id,
    src: value.src,
    mode,
    sourceSize: normalizePair(value.sourceSize, [0, 0]),
    anchor: normalizePair(value.anchor, [0.5, 0.5]),
    insets: normalizeInsets(value.insets),
    scale: Number.isFinite(Number(value.scale)) && Number(value.scale) > 0 ? Number(value.scale) : 1,
  };
}

function notify() {
  for (const listener of listeners) listener(assets, manifest);
}

export function subscribeAssets(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssetManifest() {
  return manifest;
}

export function getAssetDefinition(id) {
  return manifest.assets[id] || null;
}

export function getAsset(id) {
  return assets.get(id) || null;
}

export function getAssetUrl(id) {
  const entry = manifest.assets[id];
  return entry && entry.enabled !== false ? entry.src : null;
}

export function hasAsset(id) {
  return assets.has(id);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error(`Image API is unavailable for ${src}`));
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load asset: ${src}`));
    image.src = src;
  });
}

export function loadAssets({ onError } = {}) {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      const loadedManifest = await response.json();
      if (!isRecord(loadedManifest) || !isRecord(loadedManifest.assets)) {
        throw new Error('Graphics manifest is invalid');
      }
      manifest = {
        ...loadedManifest,
        referenceSize: normalizePair(loadedManifest.referenceSize, [1125, 2436]),
        assets: loadedManifest.assets,
      };
    } catch (error) {
      onError?.(error);
      manifest = { version: 1, referenceSize: [1125, 2436], assets: {} };
      notify();
      return { assets, manifest };
    }

    const entries = Object.entries(manifest.assets)
      .map(([id, value]) => [id, normalizeEntry(id, value)])
      .filter(([, entry]) => entry !== null);

    await Promise.all(entries.map(async ([id, entry]) => {
      try {
        const image = await loadImage(entry.src);
        assets.set(id, {
          ...entry,
          image,
          width: image.naturalWidth || entry.sourceSize[0],
          height: image.naturalHeight || entry.sourceSize[1],
        });
      } catch (error) {
        onError?.(error, entry);
      }
    }));

    notify();
    return { assets, manifest };
  })();

  return loadPromise;
}

function drawPart(context, image, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || destinationWidth <= 0 || destinationHeight <= 0) return;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
}

function drawSprite(context, asset, x, y, width, height, options) {
  const imageWidth = asset.width || asset.sourceSize[0];
  const imageHeight = asset.height || asset.sourceSize[1];
  const anchor = normalizePair(options.anchor, asset.anchor || [0.5, 0.5]);
  drawPart(
    context,
    asset.image,
    0,
    0,
    imageWidth,
    imageHeight,
    x - width * anchor[0],
    y - height * anchor[1],
    width,
    height,
  );
}

function drawCover(context, asset, x, y, width, height) {
  const imageWidth = asset.width || asset.sourceSize[0];
  const imageHeight = asset.height || asset.sourceSize[1];
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  drawPart(
    context,
    asset.image,
    (imageWidth - sourceWidth) / 2,
    (imageHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function drawContain(context, asset, x, y, width, height) {
  const imageWidth = asset.width || asset.sourceSize[0];
  const imageHeight = asset.height || asset.sourceSize[1];
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const destinationWidth = imageWidth * scale;
  const destinationHeight = imageHeight * scale;
  drawPart(
    context,
    asset.image,
    0,
    0,
    imageWidth,
    imageHeight,
    x + (width - destinationWidth) / 2,
    y + (height - destinationHeight) / 2,
    destinationWidth,
    destinationHeight,
  );
}

function drawTile(context, asset, x, y, width, height, options) {
  const imageWidth = asset.width || asset.sourceSize[0];
  const imageHeight = asset.height || asset.sourceSize[1];
  const scale = Number(options.scale) > 0 ? Number(options.scale) : asset.scale;
  const tileWidth = imageWidth * scale;
  const tileHeight = imageHeight * scale;
  if (tileWidth <= 0 || tileHeight <= 0) return;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  for (let offsetY = 0; offsetY < height; offsetY += tileHeight) {
    for (let offsetX = 0; offsetX < width; offsetX += tileWidth) {
      drawPart(context, asset.image, 0, 0, imageWidth, imageHeight, x + offsetX, y + offsetY, tileWidth, tileHeight);
    }
  }
  context.restore();
}

function drawNineSlice(context, asset, x, y, width, height) {
  const imageWidth = asset.width || asset.sourceSize[0];
  const imageHeight = asset.height || asset.sourceSize[1];
  const [top, right, bottom, left] = normalizeInsets(asset.insets);
  const sourceCenterWidth = Math.max(0, imageWidth - left - right);
  const sourceCenterHeight = Math.max(0, imageHeight - top - bottom);
  const scaleX = width / imageWidth;
  const scaleY = height / imageHeight;
  const destinationLeft = left * scaleX;
  const destinationRight = right * scaleX;
  const destinationTop = top * scaleY;
  const destinationBottom = bottom * scaleY;
  const destinationCenterWidth = Math.max(0, width - destinationLeft - destinationRight);
  const destinationCenterHeight = Math.max(0, height - destinationTop - destinationBottom);

  const slices = [
    [0, 0, left, top, x, y, destinationLeft, destinationTop],
    [left, 0, sourceCenterWidth, top, x + destinationLeft, y, destinationCenterWidth, destinationTop],
    [imageWidth - right, 0, right, top, x + width - destinationRight, y, destinationRight, destinationTop],
    [0, top, left, sourceCenterHeight, x, y + destinationTop, destinationLeft, destinationCenterHeight],
    [left, top, sourceCenterWidth, sourceCenterHeight, x + destinationLeft, y + destinationTop, destinationCenterWidth, destinationCenterHeight],
    [imageWidth - right, top, right, sourceCenterHeight, x + width - destinationRight, y + destinationTop, destinationRight, destinationCenterHeight],
    [0, imageHeight - bottom, left, bottom, x, y + height - destinationBottom, destinationLeft, destinationBottom],
    [left, imageHeight - bottom, sourceCenterWidth, bottom, x + destinationLeft, y + height - destinationBottom, destinationCenterWidth, destinationBottom],
    [imageWidth - right, imageHeight - bottom, right, bottom, x + width - destinationRight, y + height - destinationBottom, destinationRight, destinationBottom],
  ];

  for (const [sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight] of slices) {
    drawPart(context, asset.image, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight);
  }
}

export function drawAsset(context, id, x, y, width, height, options = {}) {
  const asset = getAsset(id);
  if (!asset) return false;

  const alpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1;
  const rotation = Number.isFinite(Number(options.rotation)) ? Number(options.rotation) : 0;
  context.save();
  context.globalAlpha *= Math.max(0, Math.min(1, alpha));
  if (rotation !== 0) {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.translate(-centerX, -centerY);
  }

  if (asset.mode === 'cover') {
    drawCover(context, asset, x, y, width, height);
  } else if (asset.mode === 'contain') {
    drawContain(context, asset, x, y, width, height);
  } else if (asset.mode === 'tile') {
    drawTile(context, asset, x, y, width, height, options);
  } else if (asset.mode === 'nine-slice') {
    drawNineSlice(context, asset, x, y, width, height);
  } else {
    drawSprite(context, asset, x, y, width, height, options);
  }
  context.restore();
  return true;
}

export function resetAssets() {
  assets.clear();
  manifest = { version: 1, referenceSize: [1125, 2436], assets: {} };
  loadPromise = null;
  notify();
}
