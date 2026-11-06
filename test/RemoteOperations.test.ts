import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { Project, ProjectMetadata } from '../src/domain/model';
import { CliGitInfoProvider } from '../src/services/git/GitInfoProvider';
import { ExtensionLanguageDetector } from '../src/services/languages/LanguageDetector';
import { NodeDirectoryReader } from '../src/services/languages/NodeDirectoryReader';
import { LogoStore } from '../src/services/logo/LogoStore';
import { MetadataService } from '../src/services/MetadataService';

const roots: string[] = [];
after(() => Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true }))));

const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env, stdio: 'pipe' }).toString();

async function commit(repo: string, file: string): Promise<void> {
  await fs.writeFile(path.join(repo, file), file);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', `Add ${file}`);
}

/** A clone with its "server" (a bare repository) and a second clone standing in for a teammate. */
async function setup(): Promise<{ local: string; teammate: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-tiles-remote-'));
  roots.push(root);
  const bare = path.join(root, 'server.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  const local = path.join(root, 'local');
  git(root, 'clone', '-q', bare, local);
  await commit(local, 'a.txt');
  git(local, 'push', '-q', '-u', 'origin', 'main');
  const teammate = path.join(root, 'teammate');
  git(root, 'clone', '-q', bare, teammate);
  return { local, teammate };
}

function service(): MetadataService {
  return new MetadataService(
    new CliGitInfoProvider({ fetchRemote: () => true }),
    () => new ExtensionLanguageDetector(new NodeDirectoryReader(), { ignoreDirs: [], maxFiles: 100 }),
    new LogoStore(path.join(os.tmpdir(), 'project-tiles-remote-logos')),
    undefined,
    { gitTtlMs: () => 0, languagesTtlMs: () => 0 },
  );
}

const project = (dir: string): Project => ({ id: 'p1', name: 'Repo', path: dir });

describe('fetch / pull / push', () => {
  it('pushes local commits and the tile shows nothing left to push', async () => {
    const { local } = await setup();
    await commit(local, 'b.txt');
    let meta: ProjectMetadata | undefined;
    const result = await service().runRemote(project(local), 'push', (_p, m) => (meta = m));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual([meta?.git?.sync?.ahead, meta?.git?.sync?.behind, meta?.git?.sync?.fetched], [0, 0, true]);
  });

  it('fetch reveals new remote commits and pull brings them in', async () => {
    const { local, teammate } = await setup();
    await commit(teammate, 'c.txt');
    git(teammate, 'push', '-q');
    const metadata = service();
    let meta: ProjectMetadata | undefined;
    assert.equal((await metadata.runRemote(project(local), 'fetch', (_p, m) => (meta = m))).ok, true);
    assert.equal(meta?.git?.sync?.behind, 1);
    assert.equal((await metadata.runRemote(project(local), 'pull', (_p, m) => (meta = m))).ok, true);
    assert.equal(meta?.git?.sync?.behind, 0);
    assert.equal(meta?.git?.commit?.subject, 'Add c.txt');
  });

  it('pull refuses to merge diverged histories and reports git\'s message', async () => {
    const { local, teammate } = await setup();
    await commit(teammate, 'c.txt');
    git(teammate, 'push', '-q');
    await commit(local, 'd.txt');
    const result = await service().runRemote(project(local), 'pull', () => undefined);
    assert.equal(result.ok, false);
    assert.match(result.error, /fast-forward|diverg/i);
  });
});
