// @ts-check
/**
 * Dashboard UI. Plain DOM, no framework: the whole page is re-rendered from the
 * last state object, and metadata updates patch individual tiles in place.
 */
(function () {
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  /** @type {import('../src/webview/protocol').DashboardState | undefined} */
  let state;
  let filter = (vscode.getState() || {}).filter || '';
  let busy = false;
  /** @type {{kind:'project', id:string} | {kind:'collection', id:string} | undefined} */
  let drag;

  const SWATCHES = ['#e5534b', '#f0883e', '#d4a72c', '#57ab5a', '#39c5cf', '#539bf5', '#986ee2', '#c96198', '#8b949e'];

  const ICONS = {
    search: '<svg class="i" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg>',
    plus: '<svg class="i" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
    folder: '<svg class="i" viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z"/></svg>',
    refresh: '<svg class="i" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3"/></svg>',
    edit: '<svg class="i s" viewBox="0 0 16 16"><path d="M11 2.5 13.5 5 6 12.5H3.5V10z"/></svg>',
    window: '<svg class="i s" viewBox="0 0 16 16"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5"/></svg>',
    here: '<svg class="i s" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/></svg>',
    terminal: '<svg class="i s" viewBox="0 0 16 16"><path d="M3 4l4 4-4 4M8 12h5"/></svg>',
    trash: '<svg class="i s" viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9"/></svg>',
    reveal: '<svg class="i s" viewBox="0 0 16 16"><path d="M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/></svg>',
    branch: '<svg class="i s" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 5v6M12 6.5c0 2.5-3 2-5 3.5"/></svg>',
    commit: '<svg class="i s" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/><path d="M1.5 8h4M10.5 8h4"/></svg>',
    chevron: '<svg class="i s chev" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>',
    check: '<svg class="i s" viewBox="0 0 16 16"><path d="m3 8.5 3 3 7-7"/></svg>',
    spinner: '<svg class="i s spin" viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 1-4.5 2"/></svg>',
    up: '<svg class="i s" viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
    down: '<svg class="i s" viewBox="0 0 16 16"><path d="M8 3v10M4 9l4 4 4-4"/></svg>',
    grip: '<svg class="i s" viewBox="0 0 16 16"><path d="M5 4h.01M5 8h.01M5 12h.01M11 4h.01M11 8h.01M11 12h.01" stroke-width="2.4"/></svg>',
  };

  const h = (/** @type {string} */ tag, /** @type {Record<string, any>} */ attrs = {}, /** @type {(Node|string|null|undefined)[]} */ children = []) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k in el && k !== 'draggable') /** @type {any} */ (el)[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  };
  const iconBtn = (/** @type {string} */ icon, /** @type {string} */ title, /** @type {(e: MouseEvent) => void} */ onclick) =>
    h('button', { class: 'icon', title, html: ICONS[icon], onclick: (e) => { e.stopPropagation(); onclick(e); } });
  const footerBtn = (/** @type {string} */ icon, /** @type {string} */ label, /** @type {() => void} */ onclick) =>
    h('button', { class: 'footer-btn', title: label, html: ICONS[icon] + `<span>${escapeHtml(label)}</span>`, onclick: (e) => { e.stopPropagation(); onclick(); } });
  const escapeHtml = (/** @type {string} */ s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const post = (/** @type {import('../src/webview/protocol').WebviewToHost} */ m) => vscode.postMessage(m);
  const S = () => /** @type {NonNullable<typeof state>} */ (state).strings;
  const matches = (/** @type {import('../src/webview/protocol').ProjectView} */ p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    const m = state && state.meta[p.id];
    const hay = [p.name, p.description || '', p.path, ...(p.languages || []), ...((m && m.languages) || []).map((l) => l.name), m && m.git ? m.git.branch : '']
      .join('\n').toLowerCase();
    return hay.includes(q);
  };

  function render() {
    if (!state) return;
    document.body.classList.toggle('compact', state.settings.tileSize === 'compact');
    document.body.style.setProperty('--cols', String(state.settings.columns || 3));
    const scrollY = window.scrollY;
    app.replaceChildren(renderHeader(), ...renderCollections());
    window.scrollTo(0, scrollY);
  }

  function renderHeader() {
    const s = S();
    return h('div', { class: 'header' }, [
      h('h1', {}, [s.title]),
      h('div', { class: 'search', html: ICONS.search }, [
        h('input', { type: 'search', placeholder: s.search, value: filter, oninput: (e) => { filter = e.target.value; vscode.setState({ filter }); render(); } }),
      ]),
      h('div', { class: 'spacer' }),
      h('button', { html: ICONS.plus + s.addCurrent, onclick: () => post({ type: 'addCurrent' }) }),
      h('button', { class: 'secondary', html: ICONS.folder + s.addFolder, onclick: () => openProjectEditor(undefined, {}) }),
      h('button', { class: 'secondary', html: ICONS.plus + s.newCollection, onclick: () => openCollectionEditor(undefined) }),
      h('button', { class: 'icon refresh-btn' + (busy ? ' busy' : ''), title: busy ? s.refreshing : s.refresh, html: ICONS.refresh, onclick: () => post({ type: 'refresh' }) }),
    ]);
  }

  function renderCollections() {
    const st = /** @type {NonNullable<typeof state>} */ (state);
    if (st.projects.length === 0 && st.collections.length === 0) {
      return [h('div', { class: 'empty' }, [S().empty])];
    }
    const groups = st.collections.map((c) => ({ collection: c, projects: st.projects.filter((p) => p.collectionId === c.id) }));
    groups.push({ collection: /** @type {any} */ (undefined), projects: st.projects.filter((p) => !p.collectionId) });
    const out = groups
      .filter((g) => g.collection || g.projects.length > 0)
      .map((g, index) => renderCollection(g.collection, g.projects, index));
    const anyVisible = st.projects.some(matches);
    if (!anyVisible && filter.trim()) out.push(h('div', { class: 'empty' }, [S().noMatches]));
    return out;
  }

  /** @param {import('../src/domain/model').Collection | undefined} c */
  function renderCollection(c, projects, index) {
    const s = S();
    const id = c ? c.id : '';
    const visible = projects.filter(matches);
    const section = h('section', {
      class: 'collection' + (c && c.collapsed ? ' collapsed' : ''),
      'data-collection': id,
      ondragover: (e) => { if (drag && drag.kind === 'collection' && c) { e.preventDefault(); section.classList.add('drag-over-collection'); } },
      ondragleave: () => section.classList.remove('drag-over-collection'),
      ondrop: (e) => {
        section.classList.remove('drag-over-collection');
        if (drag && drag.kind === 'collection' && c && drag.id !== c.id) { e.preventDefault(); post({ type: 'moveCollection', id: drag.id, index }); }
      },
    });
    const header = h('div', { class: 'collection-header' }, [
      c ? h('span', { class: 'handle', title: s.dragHint, html: ICONS.grip, draggable: 'true',
        ondragstart: (e) => { drag = { kind: 'collection', id: c.id }; e.dataTransfer.effectAllowed = 'move'; },
        ondragend: () => { drag = undefined; } }) : null,
      h('span', { class: 'dot', style: c && c.color ? `background:${c.color}` : '' }),
      h('h2', { onclick: () => c && post({ type: 'toggleCollection', id: c.id, collapsed: !c.collapsed }), title: c ? (c.collapsed ? s.expand : s.collapse) : '' },
        [c ? c.name : s.uncollected, ' ', c ? h('span', { html: ICONS.chevron }) : null]),
      h('span', { class: 'count' }, [String(projects.length)]),
      c && c.description ? h('span', { class: 'cdesc', title: c.description }, [c.description]) : null,
      c ? h('div', { class: 'actions' }, [
        iconBtn('edit', s.edit, () => openCollectionEditor(c)),
        iconBtn('trash', s.delete, () => confirmDialog(s.deleteCollectionConfirm, () => post({ type: 'removeCollection', id: c.id }))),
      ]) : null,
    ]);
    const grid = h('div', { class: 'grid',
      ondragover: (e) => { if (drag && drag.kind === 'project') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; grid.classList.add('drag-over'); } },
      ondragleave: (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('drag-over'); },
      ondrop: (e) => {
        grid.classList.remove('drag-over');
        if (!drag || drag.kind !== 'project') return;
        e.preventDefault();
        post({ type: 'moveProject', id: drag.id, collectionId: c ? c.id : undefined, index: dropIndex(grid, e.clientX, e.clientY, drag.id) });
      },
    }, visible.length ? visible.map(renderTile) : [h('div', { class: 'placeholder' }, [filter.trim() ? s.noMatches : s.empty])]);
    section.append(header, grid);
    return section;
  }

  /** Index among the grid's tiles where a dragged tile should land, based on pointer position. */
  function dropIndex(grid, x, y, draggedId) {
    const tiles = [...grid.querySelectorAll('.tile')].filter((t) => t.dataset.id !== draggedId);
    let index = tiles.length;
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i].getBoundingClientRect();
      const before = y < r.top + r.height / 2 ? x < r.left + r.width / 2 || y < r.top : false;
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2) || before) { index = i; break; }
    }
    return index;
  }

  /** @param {import('../src/webview/protocol').ProjectView} p */
  function renderTile(p) {
    const s = S();
    const st = /** @type {NonNullable<typeof state>} */ (state);
    const collection = st.collections.find((c) => c.id === p.collectionId);
    const tileColor = p.color || (collection && collection.color) || '';
    const meta = st.meta[p.id];
    const tile = h('div', {
      class: 'tile' + (p.isCurrent ? ' current' : '') + (meta && !meta.exists ? ' missing' : ''),
      'data-id': p.id,
      'data-current': s.current,
      tabindex: '0',
      draggable: 'true',
      style: tileColor ? `--tile-color:${tileColor}` : '',
      title: p.path,
      onclick: (e) => post({ type: 'open', id: p.id, newWindow: st.settings.openInNewWindow !== (e.ctrlKey || e.metaKey) }),
      onkeydown: (e) => { if (e.key === 'Enter') post({ type: 'open', id: p.id, newWindow: st.settings.openInNewWindow !== e.ctrlKey }); },
      ondragstart: (e) => { drag = { kind: 'project', id: p.id }; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => tile.classList.add('dragging')); },
      ondragend: () => { drag = undefined; tile.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach((g) => g.classList.remove('drag-over')); },
    }, [
      h('div', { class: 'tile-top' }, [
        renderLogo(p),
        h('div', { class: 'tile-title' }, [h('div', { class: 'name' }, [p.name]), h('div', { class: 'path' }, ['‎' + p.path])]),
      ]),
      p.description ? h('div', { class: 'desc' }, [p.description]) : null,
      h('div', { class: 'meta' }),
      h('div', { class: 'tile-footer' }, [
        footerBtn('here', s.openCurrentWindow, () => post({ type: 'open', id: p.id, newWindow: false })),
        footerBtn('window', s.openNewWindow, () => post({ type: 'open', id: p.id, newWindow: true })),
        footerBtn('terminal', s.terminal, () => post({ type: 'terminal', id: p.id })),
      ]),
      h('div', { class: 'tile-actions' }, [
        iconBtn('reveal', s.reveal, () => post({ type: 'reveal', id: p.id })),
        iconBtn('edit', s.edit, () => openProjectEditor(p.id, p)),
        iconBtn('trash', s.remove, () => confirmDialog(s.removeProjectConfirm, () => post({ type: 'removeProject', id: p.id }))),
      ]),
    ]);
    patchMeta(tile, p, meta);
    return tile;
  }

  /** @param {{name:string, logo?: import('../src/domain/model').Logo, logoUri?: string}} p */
  function renderLogo(p) {
    if (p.logoUri) return h('div', { class: 'logo image' }, [h('img', { src: p.logoUri, alt: '' })]);
    if (p.logo && p.logo.kind === 'emoji' && p.logo.value) {
      const text = clampGraphemes(p.logo.value, LOGO_TEXT_MAX);
      const kind = /\p{Extended_Pictographic}/u.test(text) ? 'emoji' : 'initial';
      return h('div', { class: 'logo ' + kind, 'data-n': String(graphemes(text).length) }, [text]);
    }
    const initials = initialsFor(p.name || '');
    return h('div', { class: 'logo initial', 'data-n': String(initials.length) }, [initials]);
  }

  const LOGO_TEXT_MAX = 3;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = (text) => [...segmenter.segment(text)].map((x) => x.segment);
  const clampGraphemes = (text, max) => graphemes(text).slice(0, max).join('');
  /** Mirrors initialsFor() in src/domain/model.ts. */
  function initialsFor(name) {
    const words = name.replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return clampGraphemes(words[0], 2).toUpperCase();
    return words.slice(0, LOGO_TEXT_MAX).map((w) => clampGraphemes(w, 1)).join('').toUpperCase();
  }

  /** Fills the languages + git block of a tile from metadata (or a loading placeholder). */
  function patchMeta(tile, p, meta) {
    const s = S();
    const box = tile.querySelector('.meta');
    if (!box) return;
    if (!meta) { box.replaceChildren(h('div', { class: 'git muted loading', html: ICONS.spinner + `<span>${escapeHtml(s.loading)}</span>` })); return; }
    if (!meta.exists) { box.replaceChildren(h('div', { class: 'git muted' }, [s.missing])); return; }
    const parts = [];
    if (meta.languages.length) {
      parts.push(h('div', { class: 'langbar' }, meta.languages.map((l) => h('span', { style: `width:${l.percent}%;background:${l.color}`, title: `${l.name} ${l.percent}%` }))));
      parts.push(h('div', { class: 'langs' }, meta.languages.slice(0, 4).map((l) =>
        h('span', {}, [h('i', { style: `background:${l.color}` }), h('b', {}, [l.name]), p.languages && p.languages.length ? '' : ` ${l.percent}%`]))));
    } else {
      parts.push(h('div', { class: 'langs' }, [h('span', {}, [s.noLanguages])]));
    }
    if (meta.git) {
      const rows = [h('div', { class: 'row' }, [h('span', { html: ICONS.branch }), h('span', { class: 'branch' }, [meta.git.branch]), renderSync(meta.git.sync)])];
      if (meta.git.commit) {
        const c = meta.git.commit;
        rows.push(h('div', { class: 'row', title: `${c.subject}\n${s.by} ${c.author}, ${c.relativeDate}` }, [
          h('span', { html: ICONS.commit }), h('span', { class: 'hash' }, [c.hash]), h('span', { class: 'subject' }, [c.subject]), h('span', { class: 'when' }, [c.relativeDate]),
        ]));
      }
      parts.push(h('div', { class: 'git' }, rows));
    } else {
      parts.push(h('div', { class: 'git muted' }, [s.notGit]));
    }
    box.replaceChildren(...parts);
  }

  /** Ahead/behind badge next to the branch name; nothing when the branch has no upstream. */
  function renderSync(sync) {
    if (!sync) return null;
    const s = S();
    if (sync.checking) {
      return h('span', { class: 'sync checking', title: `${s.checking}\n${s.syncVs} ${sync.upstream}`, html: ICONS.spinner + `<span>${escapeHtml(s.checking)}</span>` });
    }
    const hint = `${s.syncVs} ${sync.upstream}\n${sync.fetched ? s.syncFetched : s.syncNotFetched}`;
    const stale = sync.fetched ? '' : ' stale';
    if (sync.ahead === 0 && sync.behind === 0) {
      const label = sync.fetched ? s.upToDate : s.upToDateLocal;
      return h('span', { class: 'sync ok' + stale, title: `${label}\n${hint}`, html: ICONS.check + `<span>${escapeHtml(label)}</span>` });
    }
    const parts = [];
    if (sync.behind > 0) parts.push(h('span', { class: 'behind', title: `${sync.behind} ${s.behind}\n${hint}`, html: ICONS.down + sync.behind }));
    if (sync.ahead > 0) parts.push(h('span', { class: 'ahead', title: `${sync.ahead} ${s.ahead}\n${hint}`, html: ICONS.up + sync.ahead }));
    return h('span', { class: 'sync' + stale, title: hint }, parts);
  }

  /** @type {HTMLElement | undefined} */
  let overlay;
  function closeDialog() { if (overlay) { overlay.remove(); overlay = undefined; } }
  function showDialog(dialog) {
    closeDialog();
    overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) closeDialog(); } }, [dialog]);
    document.body.append(overlay);
    const first = dialog.querySelector('input, textarea, select');
    if (first) first.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay) closeDialog(); });

  function confirmDialog(text, onYes) {
    const s = S();
    showDialog(h('div', { class: 'dialog small' }, [
      h('p', {}, [text]),
      h('div', { class: 'buttons' }, [
        h('button', { class: 'secondary', onclick: closeDialog }, [s.cancel]),
        h('button', { class: 'danger', onclick: () => { closeDialog(); onYes(); } }, [s.delete]),
      ]),
    ]));
  }

  /**
   * @param {string | undefined} id  existing project id, or undefined for a new one
   * @param {Partial<import('../src/webview/protocol').ProjectView>} p
   */
  function openProjectEditor(id, p) {
    const s = S();
    const st = /** @type {NonNullable<typeof state>} */ (state);
    const draftId = id || p.id || crypto.randomUUID();
    const logo = { kind: (p.logo && p.logo.kind) || 'none', value: (p.logo && p.logo.value) || '' };
    let logoUri = p.logoUri || '';
    const meta = id ? st.meta[id] : undefined;

    const nameInput = h('input', { value: p.name || '' });
    const pathInput = h('input', { value: p.path || '', oninput: () => { if (!nameInput.value) nameInput.value = baseName(pathInput.value); } });
    const descInput = h('textarea', { value: p.description || '' });
    const emojiInput = h('input', { value: logo.kind === 'emoji' ? logo.value : '', placeholder: '🚀🐱 / ABC', spellcheck: false, oninput: () => {
      const clamped = clampGraphemes(emojiInput.value.trim(), LOGO_TEXT_MAX);
      if (clamped !== emojiInput.value) emojiInput.value = clamped;
      logo.kind = 'emoji'; logo.value = clamped; syncLogo();
    } });
    const langInput = h('input', { value: (p.languages || []).join(', '), placeholder: 'C#, ShaderLab' });
    const collectionSelect = h('select', { onchange: () => syncLogo() }, [
      h('option', { value: '' }, [s.noCollection]),
      ...st.collections.map((c) => h('option', { value: c.id, selected: c.id === p.collectionId }, [c.name])),
    ]);
    const error = h('div', { class: 'error' });
    const preview = h('div', { class: 'logo-preview' });
    const picker = colorPicker(p.color);
    const radios = {};

    function syncLogo() {
      for (const [kind, radio] of Object.entries(radios)) radio.checked = kind === logo.kind;
      const previewLogo = { name: nameInput.value || baseName(pathInput.value), logo: { kind: logo.kind, value: logo.kind === 'emoji' ? emojiInput.value : logo.value }, logoUri: logo.kind === 'image' ? logoUri : '' };
      if (logo.kind === 'auto' && p.logo && p.logo.kind === 'auto') previewLogo.logoUri = p.logoUri;
      preview.style.setProperty('--tile-color', picker.value || (collectionSelect.value && (st.collections.find((c) => c.id === collectionSelect.value) || {}).color) || '');
      preview.replaceChildren(renderLogo(previewLogo), logo.kind === 'image' ? h('button', { class: 'secondary', onclick: () => post({ type: 'pickLogo', id: draftId }) }, [s.chooseImage]) : '');
    }
    const radio = (kind, label) => {
      const input = h('input', { type: 'radio', name: 'logo', onchange: () => { logo.kind = kind; if (kind === 'image' && !logo.value) post({ type: 'pickLogo', id: draftId }); syncLogo(); } });
      radios[kind] = input;
      return h('label', {}, [input, label]);
    };
    pendingLogoHandler = (msg) => { if (msg.id === draftId) { logo.kind = 'image'; logo.value = msg.fileName; logoUri = msg.logoUri; syncLogo(); } };
    pendingFolderHandler = (msg) => { pathInput.value = msg.path; if (!nameInput.value) nameInput.value = msg.name; syncLogo(); };

    const dialog = h('div', { class: 'dialog' }, [
      h('h3', {}, [id ? s.editProject : s.newProject]),
      h('div', { class: 'field' }, [h('label', {}, [s.path]), h('div', { class: 'row2' }, [pathInput, h('button', { class: 'secondary', onclick: () => post({ type: 'pickFolder' }) }, [s.browse])]), error]),
      h('div', { class: 'field' }, [h('label', {}, [s.name]), nameInput]),
      h('div', { class: 'field' }, [h('label', {}, [s.description]), descInput]),
      h('div', { class: 'field' }, [
        h('label', {}, [s.logo]),
        h('div', { class: 'logo-opts' }, [radio('none', s.logoNone), radio('auto', s.logoAuto), radio('emoji', s.logoEmoji), radio('image', s.logoImage)]),
        h('div', { class: 'row2' }, [preview, emojiInput]),
      ]),
      h('div', { class: 'field' }, [
        h('label', {}, [s.languages]), langInput,
        h('div', { class: 'hint' }, [s.languagesHint]),
        meta && meta.languages.length ? h('div', { class: 'chips' }, [
          h('span', { style: 'background:transparent;color:var(--muted);padding-left:0;cursor:default' }, [s.detected + ':']),
          ...meta.languages.map((l) => h('span', { onclick: () => { langInput.value = [...new Set([...splitList(langInput.value), l.name])].join(', '); } }, [`${l.name} ${l.percent}%`])),
        ]) : null,
      ]),
      h('div', { class: 'field' }, [h('label', {}, [s.color]), picker, h('div', { class: 'hint' }, [s.colorHint])]),
      h('div', { class: 'field' }, [h('label', {}, [s.collection]), collectionSelect]),
      h('div', { class: 'buttons' }, [
        id ? h('button', { class: 'danger left', onclick: () => confirmDialog(s.removeProjectConfirm, () => post({ type: 'removeProject', id })) }, [s.remove]) : null,
        h('button', { class: 'secondary', onclick: closeDialog }, [s.cancel]),
        h('button', { onclick: () => {
          const path = pathInput.value.trim();
          if (!path) { error.textContent = s.pathRequired; return; }
          const dup = st.projects.find((o) => o.id !== id && samePath(o.path, path));
          if (dup) { error.textContent = s.pathExists; return; }
          post({ type: 'saveProject', id: id || draftId, patch: {
            name: nameInput.value.trim() || baseName(path), path, description: descInput.value,
            logo: { kind: logo.kind, value: logo.kind === 'emoji' ? emojiInput.value : logo.value },
            languages: splitList(langInput.value), color: picker.value || undefined, collectionId: collectionSelect.value || undefined,
          } });
          closeDialog();
        } }, [s.save]),
      ]),
    ]);
    syncLogo();
    showDialog(dialog);
    emojiInput.style.maxWidth = '120px';
  }

  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const normalizeHex = (v) => { v = (v || '').trim(); if (!v) return ''; if (!v.startsWith('#')) v = '#' + v; return HEX.test(v) ? v.toLowerCase() : null; };

  /**
   * Swatches + hex text field + native colour input. Returns the element; read the
   * current value with `.value` (empty string = no colour).
   */
  function colorPicker(initial) {
    const s = S();
    let color = normalizeHex(initial) || '';
    const swatches = h('div', { class: 'swatches' });
    const hexInput = h('input', { class: 'hex', value: color, placeholder: '#rrggbb', maxLength: 7, spellcheck: false });
    const native = h('input', { type: 'color', class: 'native', value: color || '#888888', title: s.color });
    const draw = () => {
      swatches.replaceChildren(
        h('div', { class: 'swatch none' + (color ? '' : ' selected'), title: s.clearColor, onclick: () => set('') }),
        ...SWATCHES.map((hex) => h('div', { class: 'swatch' + (color === hex ? ' selected' : ''), style: `background:${hex}`, onclick: () => set(hex) })),
        native,
      );
      native.style.setProperty('--picked', color || 'transparent');
      native.classList.toggle('selected', !!color && !SWATCHES.includes(color));
    };
    const set = (hex) => { color = hex; hexInput.value = hex; hexInput.classList.remove('invalid'); if (hex) native.value = hex; draw(); };
    hexInput.addEventListener('input', () => {
      const n = normalizeHex(hexInput.value);
      hexInput.classList.toggle('invalid', n === null);
      if (n !== null) { color = n; if (n) native.value = n; draw(); }
    });
    native.addEventListener('input', () => set(native.value));
    draw();
    const el = h('div', { class: 'color-picker' }, [swatches, hexInput]);
    Object.defineProperty(el, 'value', { get: () => color });
    return el;
  }

  /** @param {import('../src/domain/model').Collection | undefined} c */
  function openCollectionEditor(c) {
    const s = S();
    const nameInput = h('input', { value: c ? c.name : '' });
    const descInput = h('textarea', { value: (c && c.description) || '', rows: 2 });
    const picker = colorPicker(c && c.color);
    const save = () => { post({ type: 'saveCollection', id: c ? c.id : undefined, name: nameInput.value, color: picker.value || undefined, description: descInput.value.trim() || undefined }); closeDialog(); };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    showDialog(h('div', { class: 'dialog small' }, [
      h('h3', {}, [c ? s.editCollection : s.newCollection]),
      h('div', { class: 'field' }, [h('label', {}, [s.collectionName]), nameInput]),
      h('div', { class: 'field' }, [h('label', {}, [s.collectionDescription]), descInput]),
      h('div', { class: 'field' }, [h('label', {}, [s.color]), picker]),
      h('div', { class: 'buttons' }, [h('button', { class: 'secondary', onclick: closeDialog }, [s.cancel]), h('button', { onclick: save }, [s.save])]),
    ]));
  }

  const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  const samePath = (a, b) => a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  const splitList = (text) => text.split(',').map((x) => x.trim()).filter(Boolean);

  /** @type {((m: any) => void) | undefined} */
  let pendingLogoHandler;
  /** @type {((m: any) => void) | undefined} */
  let pendingFolderHandler;

  window.addEventListener('message', (event) => {
    /** @type {import('../src/webview/protocol').HostToWebview} */
    const msg = event.data;
    switch (msg.type) {
      case 'state':
        state = msg.state;
        render();
        if (msg.state.editing === 'new') openProjectEditor(undefined, msg.state.draft || {});
        else if (msg.state.editing) {
          const p = state.projects.find((x) => x.id === msg.state.editing);
          if (p) openProjectEditor(p.id, p);
        }
        break;
      case 'meta': {
        if (!state) break;
        state.meta[msg.id] = msg.meta;
        const p = state.projects.find((x) => x.id === msg.id);
        if (!p) break;
        if (msg.logoUri) p.logoUri = msg.logoUri;
        const tile = app.querySelector(`.tile[data-id="${msg.id}"]`);
        if (tile) {
          patchMeta(tile, p, msg.meta);
          tile.classList.toggle('missing', !msg.meta.exists);
          if (msg.logoUri) { const old = tile.querySelector('.logo'); if (old) old.replaceWith(renderLogo(p)); }
        }
        break;
      }
      case 'busy': {
        busy = msg.busy;
        const btn = app.querySelector('.refresh-btn');
        if (btn) { btn.classList.toggle('busy', busy); btn.title = busy ? S().refreshing : S().refresh; }
        break;
      }
      case 'logoPicked':
        if (pendingLogoHandler) pendingLogoHandler(msg);
        break;
      case 'folderPicked':
        if (pendingFolderHandler) pendingFolderHandler(msg);
        break;
    }
  });

  post({ type: 'ready' });
})();
