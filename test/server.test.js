import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server, resolveRequestPath } from '../server.js';

let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('serves the application only from the project root', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(body, /Dungeon Card Crawler/);
});

test('rejects unsupported methods and dotfiles', async () => {
  const postResponse = await fetch(`${baseUrl}/run.js`, { method: 'POST' });
  const dotfileResponse = await fetch(`${baseUrl}/.qwen/settings.json`);

  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get('allow'), 'GET, HEAD');
  assert.equal(dotfileResponse.status, 400);
});

test('rejects encoded path traversal', async () => {
  const response = await fetch(`${baseUrl}/%2e%2e%2f%2e%2e%2fWindows%2fwin.ini`);
  assert.equal(response.status, 400);
  assert.equal(resolveRequestPath('/%2e%2e%2fsecret.txt'), null);
});

test('HEAD returns headers without a body', async () => {
  const response = await fetch(`${baseUrl}/run.js`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});
