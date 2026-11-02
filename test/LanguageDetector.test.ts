import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DirectoryReader, ExtensionLanguageDetector, languageForFileName, sharesFromNames } from '../src/services/languages/LanguageDetector';
import { parseAheadBehind, parseCommitLine, GIT_FIELD_SEPARATOR } from '../src/services/git/parse';

/** In-memory tree: directory → entries; files map to their byte size. */
class FakeReader implements DirectoryReader {
  constructor(private readonly tree: Record<string, Record<string, number | 'dir'>>) {}
  async readDirectory(dir: string) {
    const entries = this.tree[dir] ?? {};
    return Object.entries(entries).map(([name, v]) => ({ name, isDirectory: v === 'dir', isFile: v !== 'dir' }));
  }
  async fileSize(file: string) {
    const slash = file.lastIndexOf('/');
    const v = this.tree[file.slice(0, slash)]?.[file.slice(slash + 1)];
    return typeof v === 'number' ? v : 0;
  }
  join(...parts: string[]) {
    return parts.join('/');
  }
}

describe('ExtensionLanguageDetector', () => {
  it('weighs languages by bytes and ignores data files and ignored directories (Unity case)', async () => {
    const reader = new FakeReader({
      '/game': { Assets: 'dir', Library: 'dir', 'Game.sln': 10, 'README.md': 500 },
      '/game/Assets': { 'Player.cs': 300, 'Enemy.cs': 100, 'Scene.unity': 90000, 'Water.shader': 100, 'Main.xaml': 5000 },
      '/game/Library': { 'huge.cs': 1_000_000 },
    });
    const detector = new ExtensionLanguageDetector(reader, { ignoreDirs: ['Library'], maxFiles: 100 });
    const shares = await detector.detect('/game');
    assert.deepEqual(
      shares.map((s) => [s.name, s.percent]),
      [
        ['C#', 80],
        ['ShaderLab', 20],
      ],
    );
  });

  it('stops after maxFiles', async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 50; i++) {
      files[`f${i}.ts`] = 10;
    }
    const detector = new ExtensionLanguageDetector(new FakeReader({ '/p': files }), { ignoreDirs: [], maxFiles: 5 });
    const shares = await detector.detect('/p');
    assert.equal(shares[0]?.name, 'TypeScript');
  });

  it('maps special file names', () => {
    assert.equal(languageForFileName('Dockerfile')?.name, 'Dockerfile');
    assert.equal(languageForFileName('CMakeLists.txt')?.name, 'CMake');
    assert.equal(languageForFileName('types.d.ts')?.name, 'TypeScript');
    assert.equal(languageForFileName('view.blade.php')?.name, 'Blade');
    assert.equal(languageForFileName('data.json'), undefined);
    assert.equal(languageForFileName('.gitignore'), undefined);
  });
});

describe('sharesFromNames', () => {
  it('uses palette colours for known names and a neutral colour otherwise', () => {
    const shares = sharesFromNames(['c#', 'Brainfuck', 'C#']);
    assert.equal(shares.length, 2);
    assert.equal(shares[0]!.name, 'C#');
    assert.equal(shares[0]!.color, '#178600');
    assert.equal(shares[1]!.color, '#8b949e');
    assert.equal(shares[0]!.percent, 50);
  });
});

describe('parseCommitLine', () => {
  it('parses the custom log format', () => {
    const line = ['abc1234', 'Fix: thing', '2 hours ago', 'Dominik'].join(GIT_FIELD_SEPARATOR) + '\n';
    assert.deepEqual(parseCommitLine(line), { hash: 'abc1234', subject: 'Fix: thing', relativeDate: '2 hours ago', author: 'Dominik' });
    assert.equal(parseCommitLine(''), undefined);
  });

  it('parses ahead/behind counts', () => {
    assert.deepEqual(parseAheadBehind('2\t5\n'), { ahead: 2, behind: 5 });
    assert.equal(parseAheadBehind('fatal: no upstream'), undefined);
  });
});
