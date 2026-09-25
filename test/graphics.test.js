import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAsset, getAssetDefinition, getAssetManifest, getAssetUrl } from '../assets/loader.js';

const manifest = JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));

test('graphics manifest uses the agreed reference size and PNG-only contract', () => {
  assert.deepEqual(manifest.referenceSize, [1125, 2436]);
  assert.equal(Object.keys(manifest.assets).length > 0, true);

  for (const [id, entry] of Object.entries(manifest.assets)) {
    assert.match(entry.src, /\.png$/, id);
    assert.equal(['sprite', 'cover', 'contain', 'tile', 'nine-slice'].includes(entry.mode), true, id);
    assert.equal(Array.isArray(entry.sourceSize), true, id);
    assert.equal(entry.sourceSize.length, 2, id);
  }
});

test('pending graphics entries expose definitions but do not load until enabled', () => {
  const definition = manifest.assets['ui.hud.top'];
  assert.equal(definition.mode, 'nine-slice');
  assert.deepEqual(definition.insets, [60, 120, 60, 120]);
  assert.equal(getAssetDefinition('ui.hud.top'), null);
  assert.equal(getAssetUrl('ui.hud.top'), null);
  assert.equal(getAsset('ui.hud.top'), null);
  assert.equal(getAssetManifest().referenceSize[0], 1125);
});

test('unknown graphics ids fail safely', () => {
  assert.equal(getAsset('does.not.exist'), null);
  assert.equal(getAssetUrl('does.not.exist'), null);
});
