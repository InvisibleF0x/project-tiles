import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { unavailability, volumeRoot } from '../src/services/PathState';

describe('volumeRoot', () => {
  it('finds the drive or share on Windows', () => {
    assert.equal(volumeRoot('D:\\Projects\\shop', 'win32'), 'D:\\');
    assert.equal(volumeRoot('\\\\nas\\code\\shop', 'win32'), '\\\\nas\\code\\');
  });

  it('finds removable and network volumes on macOS and Linux', () => {
    assert.equal(volumeRoot('/Volumes/External/dev/shop', 'darwin'), '/Volumes/External');
    assert.equal(volumeRoot('/Users/a/dev/shop', 'darwin'), '/');
    assert.equal(volumeRoot('/media/a/USB/shop', 'linux'), '/media/a/USB');
    assert.equal(volumeRoot('/run/media/a/USB/shop', 'linux'), '/run/media/a/USB');
    assert.equal(volumeRoot('/mnt/nas/shop', 'linux'), '/mnt/nas');
    assert.equal(volumeRoot('/home/a/shop', 'linux'), '/');
  });
});

describe('unavailability', () => {
  it('tells a deleted folder from an existing one', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-tiles-path-'));
    try {
      assert.equal(await unavailability(dir), undefined);
      assert.equal(await unavailability(path.join(dir, 'gone')), 'deleted');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
