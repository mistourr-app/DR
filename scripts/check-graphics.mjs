import { readFile } from 'node:fs/promises';
import path from 'node:path';

const manifestPath = path.resolve('assets/manifest.json');
const errors = [];
const warnings = [];
const validModes = new Set(['sprite', 'cover', 'contain', 'tile', 'nine-slice']);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(isPositiveInteger);
}

function isValidInsets(value, sourceSize) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => Number.isInteger(item) && item >= 0)) return false;
  const [top, right, bottom, left] = value;
  return top + bottom < sourceSize[1] && left + right < sourceSize[0];
}

async function readPngSize(filePath) {
  const buffer = await readFile(filePath);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buffer.length < 24 || !signature.every((value, index) => buffer[index] === value)) {
    throw new Error('not a PNG file');
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest must be an object');
  }
  if (!isValidPair(manifest.referenceSize) || manifest.referenceSize[0] !== 1125 || manifest.referenceSize[1] !== 2436) {
    errors.push('referenceSize must be [1125, 2436]');
  }
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    errors.push('assets must be an object');
  } else {
    for (const [id, entry] of Object.entries(manifest.assets)) {
      if (!id || !entry || typeof entry !== 'object') {
        errors.push(`${id || '<empty id>'}: entry must be an object`);
        continue;
      }
      if (typeof entry.src !== 'string' || !entry.src.toLowerCase().endsWith('.png')) {
        errors.push(`${id}: src must point to a PNG`);
      }
      if (!validModes.has(entry.mode)) {
        errors.push(`${id}: unsupported mode ${entry.mode}`);
      }
      if (!isValidPair(entry.sourceSize)) {
        errors.push(`${id}: sourceSize must contain two positive integers`);
        continue;
      }
      if (entry.mode === 'nine-slice' && !isValidInsets(entry.insets, entry.sourceSize)) {
        errors.push(`${id}: nine-slice insets must fit sourceSize`);
      }
      if (entry.enabled === false) {
        warnings.push(`${id}: pending (enabled=false)`);
        continue;
      }
      const filePath = path.resolve(path.dirname(manifestPath), entry.src);
      try {
        const [width, height] = await readPngSize(filePath);
        if (width !== entry.sourceSize[0] || height !== entry.sourceSize[1]) {
          errors.push(`${id}: PNG is ${width}x${height}, manifest expects ${entry.sourceSize.join('x')}`);
        }
      } catch (error) {
        errors.push(`${id}: ${error.message}`);
      }
    }
  }
} catch (error) {
  errors.push(error.message);
}

if (errors.length > 0) {
  console.error('Graphics manifest check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Graphics manifest is valid. Pending assets: ${warnings.length}.`);
}
