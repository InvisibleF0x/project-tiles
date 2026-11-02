import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../src/domain/ProjectCatalog';
import { clampGraphemes, initialsFor } from '../src/domain/model';

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe('ProjectCatalog', () => {
  it('adds projects with trimmed fields and derives a name from the path', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const p = catalog.addProject({ name: '  ', path: 'C:\\Dev\\MyGame\\', description: ' x ', languages: [' C# ', ''] });
    assert.equal(p.name, 'MyGame');
    assert.equal(p.description, 'x');
    assert.deepEqual(p.languages, ['C#']);
    assert.equal(p.logo, undefined);
  });

  it('finds projects by path regardless of separators, case and trailing slash', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    catalog.addProject({ name: 'a', path: 'C:\\Dev\\App' });
    assert.ok(catalog.findProjectByPath('c:/dev/app/'));
    assert.equal(catalog.findProjectByPath('c:/dev/other'), undefined);
  });

  it('moves projects between collections at a given index', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const work = catalog.addCollection('Work');
    const a = catalog.addProject({ name: 'a', path: '/a', collectionId: work.id });
    const b = catalog.addProject({ name: 'b', path: '/b', collectionId: work.id });
    const c = catalog.addProject({ name: 'c', path: '/c' });

    assert.ok(catalog.moveProject(c.id, work.id, 1));
    const names = catalog.grouped()[0]!.projects.map((p) => p.name);
    assert.deepEqual(names, ['a', 'c', 'b']);

    assert.ok(catalog.moveProject(a.id, undefined, 0));
    assert.deepEqual(catalog.grouped()[1]!.projects.map((p) => p.name), ['a']);
    assert.equal(catalog.getProject(a.id)?.collectionId, undefined);
    assert.equal(catalog.getProject(b.id)?.collectionId, work.id);
  });

  it('rejects moves into unknown collections', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const a = catalog.addProject({ name: 'a', path: '/a' });
    assert.equal(catalog.moveProject(a.id, 'nope', 0), false);
  });

  it('reorders collections and keeps the index within bounds', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const x = catalog.addCollection('x');
    catalog.addCollection('y');
    catalog.addCollection('z');
    assert.ok(catalog.moveCollection(x.id, 99));
    assert.deepEqual(catalog.collections.map((c) => c.name), ['y', 'z', 'x']);
  });

  it('removing a collection keeps its projects as uncollected', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const col = catalog.addCollection('c');
    const p = catalog.addProject({ name: 'p', path: '/p', collectionId: col.id });
    assert.ok(catalog.removeCollection(col.id));
    assert.equal(catalog.getProject(p.id)?.collectionId, undefined);
    assert.equal(catalog.projects.length, 1);
  });

  it('rejects malformed entries when loading (tampered or hand-edited file)', () => {
    const catalog = new ProjectCatalog(
      {
        version: 1,
        collections: [{ id: 'c1', name: 'c', color: 'red; background:url(x)' } as never, { id: '../x', name: 'bad' }],
        projects: [
          { id: 'p1', name: 'a', path: '/a', color: 'blue', logo: { kind: 'image', value: '../../secret.png' } },
          { id: 'p2', name: 'b', path: '/b', logo: { kind: 'emoji', value: '🚀🚀🚀🚀🚀' }, languages: ['C#', 42 as never] },
          { id: 'x/y', name: 'bad', path: '/bad' },
          { id: 'p3', name: 'no path', path: '' },
        ],
      },
      ids(),
    );
    assert.deepEqual(catalog.collections.map((c) => [c.id, c.color]), [['c1', undefined]]);
    assert.deepEqual(catalog.projects.map((p) => p.id), ['p1', 'p2']);
    assert.equal(catalog.getProject('p1')?.color, undefined);
    assert.equal(catalog.getProject('p1')?.logo, undefined);
    assert.equal(catalog.getProject('p2')?.logo?.value, '🚀🚀🚀');
    assert.deepEqual(catalog.getProject('p2')?.languages, ['C#']);
  });

  it('normalizes dangling collection references and duplicate ids when loading', () => {
    const catalog = new ProjectCatalog(
      {
        version: 1,
        collections: [{ id: 'c1', name: 'c' }],
        projects: [
          { id: 'p1', name: 'a', path: '/a', collectionId: 'gone' },
          { id: 'p1', name: 'dup', path: '/dup' },
          { id: 'p2', name: 'b', path: '/b', collectionId: 'c1' },
        ],
      },
      ids(),
    );
    assert.equal(catalog.projects.length, 2);
    assert.equal(catalog.getProject('p1')?.collectionId, undefined);
    assert.equal(catalog.getProject('p2')?.collectionId, 'c1');
  });

  it('normalizes colours and drops invalid ones', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const p = catalog.addProject({ name: 'a', path: '/a', color: 'E5534B' });
    assert.equal(p.color, '#e5534b');
    assert.equal(catalog.updateProject(p.id, { color: 'red' })?.color, undefined);
    const c = catalog.addCollection('c', '#ABC');
    assert.equal(c.color, '#abc');
    assert.equal(catalog.updateCollection(c.id, { color: '' })?.color, undefined);
  });

  it('limits text logos to three graphemes', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const p = catalog.addProject({ name: 'a', path: '/a', logo: { kind: 'emoji', value: '📱🐱🚀🔥' } });
    assert.equal(p.logo?.value, '📱🐱🚀');
    assert.equal(clampGraphemes('🇵🇱👍🏽abc', 3), '🇵🇱👍🏽a');
    assert.equal(catalog.updateProject(p.id, { logo: { kind: 'emoji', value: '  ' } })?.logo, undefined);
  });

  it('derives initials from project names', () => {
    assert.equal(initialsFor('MyGameStudio'), 'MGS');
    assert.equal(initialsFor('MyGameStudioMobileApp'), 'MGS');
    assert.equal(initialsFor('shop-backend'), 'SB');
    assert.equal(initialsFor('Tools'), 'TO');
    assert.equal(initialsFor('shop_api 2'), 'SA2');
    assert.equal(initialsFor('---'), '?');
  });

  it('updateProject clears optional fields that become empty', () => {
    const catalog = new ProjectCatalog(undefined, ids());
    const p = catalog.addProject({ name: 'a', path: '/a', description: 'd', logo: { kind: 'emoji', value: '🚀' } });
    const updated = catalog.updateProject(p.id, { description: '', logo: { kind: 'none' } })!;
    assert.equal(updated.description, undefined);
    assert.equal(updated.logo, undefined);

    const col = catalog.addCollection('c');
    catalog.updateProject(p.id, { logo: { kind: 'emoji', value: '🚀' }, collectionId: col.id });
    const cleared = catalog.updateProject(p.id, { logo: undefined, collectionId: undefined })!;
    assert.equal(cleared.logo, undefined);
    assert.equal(cleared.collectionId, undefined);
  });
});
