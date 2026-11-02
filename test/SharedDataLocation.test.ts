import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sharedDataDirectory } from '../src/storage/SharedDataLocation';

describe('sharedDataDirectory', () => {
  it('uses APPDATA on Windows, Application Support on macOS and XDG elsewhere', () => {
    assert.equal(sharedDataDirectory({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\project-tiles');
    assert.equal(sharedDataDirectory({}, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\project-tiles');
    assert.equal(sharedDataDirectory({}, 'darwin', '/Users/a'), '/Users/a/Library/Application Support/project-tiles');
    assert.equal(sharedDataDirectory({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/a'), '/cfg/project-tiles');
    assert.equal(sharedDataDirectory({}, 'linux', '/home/a'), '/home/a/.config/project-tiles');
  });
});
