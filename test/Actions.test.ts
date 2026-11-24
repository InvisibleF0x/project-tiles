import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../src/domain/ProjectCatalog';
import { CatalogData, effectiveActions } from '../src/domain/model';
import { listSubfolders, pathsFromDropped } from '../src/services/FolderScan';

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe('tile buttons', () => {
  it('keeps only buttons with a safe unique id, a name and a command', () => {
    const data = {
      version: 1,
      collections: [{ id: 'c', name: 'Work', actions: [{ id: 'x', name: ' Test ', command: ' npm test ' }, { id: 'x', name: 'dup', command: 'a' }] }],
      projects: [{ id: 'p', name: 'p', path: '/p', actions: [{ id: '../bad', name: 'a', command: 'b' }, { id: 'ok', name: '', command: 'b' }, 'junk'] }],
      actions: [{ id: 'g', name: 'Build', command: 'npm run build' }],
    } as unknown as CatalogData;
    const normalized = ProjectCatalog.normalize(data);
    assert.deepEqual(normalized.collections[0]!.actions, [{ id: 'x', name: 'Test', command: 'npm test' }]);
    assert.equal(normalized.projects[0]!.actions, undefined);
    assert.deepEqual(normalized.actions, [{ id: 'g', name: 'Build', command: 'npm run build' }]);
  });

  it('shows the global buttons, then the collection ones, then the project ones', () => {
    const global = [{ id: 'g', name: 'G', command: 'g' }];
    const collection = { actions: [{ id: 'c', name: 'C', command: 'c' }] };
    const project = { actions: [{ id: 'p', name: 'P', command: 'p' }] };
    assert.deepEqual(effectiveActions(global, collection, project).map((a) => a.id), ['g', 'c', 'p']);
    assert.deepEqual(effectiveActions(undefined, undefined, {}), []);
  });

  it('writes collection fields in the same order as the JetBrains plugin', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const c = catalog.addCollection('Work', '#539bf5', 'Client work', [{ id: 'a', name: 'Build', command: 'make' }]);
    assert.deepEqual(Object.keys(c), ['id', 'name', 'description', 'color', 'actions']);
    const updated = catalog.updateCollection(c.id, { collapsed: true })!;
    assert.deepEqual(Object.keys(updated), ['id', 'name', 'description', 'color', 'collapsed', 'actions']);
  });

  it('writes back the same JSON the JetBrains plugin writes (see CoreTest)', () => {
    const json = `{
  "version": 1,
  "collections": [
    {
      "id": "c1",
      "name": "Work",
      "description": "Client projects",
      "color": "#447099",
      "collapsed": true,
      "actions": [
        {
          "id": "a1",
          "name": "Test",
          "command": "npm test"
        }
      ]
    }
  ],
  "projects": [
    {
      "id": "p1",
      "name": "Shop backend",
      "path": "C:\\\\Dev\\\\shop-backend",
      "description": "Online shop API",
      "logo": {
        "kind": "emoji",
        "value": "🛒"
      },
      "languages": [
        "PHP",
        "Blade"
      ],
      "color": "#e5534b",
      "collectionId": "c1",
      "show": {
        "description": false,
        "git": true
      },
      "actions": [
        {
          "id": "a2",
          "name": "Deploy",
          "command": "php artisan deploy --env=\\"prod\\""
        }
      ]
    }
  ],
  "actions": [
    {
      "id": "a3",
      "name": "Build",
      "command": "npm run build"
    }
  ]
}`;
    const catalog = new ProjectCatalog(JSON.parse(json) as CatalogData, ids());
    assert.equal(JSON.stringify(catalog.snapshot(), null, 2), json);
  });

  it('clears the global buttons when the list is empty', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    catalog.setActions([{ id: 'a', name: 'Build', command: 'make' }]);
    assert.equal(catalog.snapshot().actions?.length, 1);
    catalog.setActions([]);
    assert.equal('actions' in catalog.snapshot(), false);
  });
});

describe('bulk changes', () => {
  it('changes only the fields in the patch', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const work = catalog.addCollection('Work');
    const p = catalog.addProject({ name: 'a', path: '/a', color: '#111111', show: { git: false, path: true }, actions: [{ id: 'own', name: 'Own', command: 'x' }] });
    const input = catalog.bulkInput(p, { collectionId: work.id, show: { git: null, languages: false }, addActions: [{ id: 'new', name: 'New', command: 'y' }, { id: 'own', name: 'Dup', command: 'z' }] });
    const saved = catalog.updateProject(p.id, input)!;
    assert.equal(saved.collectionId, work.id);
    assert.equal(saved.color, '#111111');
    assert.deepEqual(saved.show, { path: true, languages: false });
    assert.deepEqual(saved.actions?.map((a) => a.id), ['own', 'new']);
  });

  it('can take projects out of a collection and clear their colour', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const work = catalog.addCollection('Work');
    const p = catalog.addProject({ name: 'a', path: '/a', color: '#111111', collectionId: work.id });
    const saved = catalog.updateProject(p.id, catalog.bulkInput(p, { collectionId: null, color: null, logo: 'auto' }))!;
    assert.equal(saved.collectionId, undefined);
    assert.equal(saved.color, undefined);
    assert.deepEqual(saved.logo, { kind: 'auto' });
  });

  it('ignores a collection that does not exist', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const p = catalog.addProject({ name: 'a', path: '/a' });
    assert.equal(catalog.bulkInput(p, { collectionId: 'missing' }).collectionId, undefined);
  });
});

describe('adding folders', () => {
  it('turns dropped file URIs and paths into local paths', () => {
    assert.deepEqual(pathsFromDropped(['file:///c%3A/Dev/My%20App', 'C:\\Dev\\Other', '# comment', 'https://example.com', 'relative'], 'win32'), [
      'c:\\Dev\\My App',
      'C:\\Dev\\Other',
    ]);
    assert.deepEqual(pathsFromDropped(['file://nas/code/shop'], 'win32'), ['\\\\nas\\code\\shop']);
    assert.deepEqual(pathsFromDropped(['file:///home/a/dev/shop', '/home/a/dev/shop'], 'linux'), ['/home/a/dev/shop']);
  });

  it('lists subfolders with git repositories first and skips hidden ones', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-tiles-'));
    try {
      for (const dir of ['zeta', 'alpha', 'repo/.git', '.hidden', 'node_modules']) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
      }
      await fs.writeFile(path.join(root, 'file.txt'), 'x');
      const found = await listSubfolders(root);
      assert.deepEqual(found.map((f) => [f.name, f.isGit]), [['repo', true], ['alpha', false], ['zeta', false]]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
