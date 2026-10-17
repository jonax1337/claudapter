import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cleanupSavedImages, saveImageFile } from '../dist/tui/opencode/clipboard-image.js';

test('saved image files live in tracked temp directories that cleanup removes', async () => {
  const path = await saveImageFile({ mediaType: 'image/png', data: Buffer.from('fixture-png').toString('base64') });
  await stat(path);
  await cleanupSavedImages();
  await assert.rejects(stat(dirname(path)), /ENOENT/);
  await cleanupSavedImages();
});
