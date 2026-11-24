# Changelog

## 1.4.0 — 2026-11-24

- **Tile buttons**: your own commands next to *Terminal* (e.g. *Build* → `npm run build`). A click runs the
  command in a new terminal in the project's folder. Buttons can be set for every tile (⚡ in the header),
  for a collection (its edit form) or for one project (its edit form, or the ⚡ icon on the tile).
- **Add many projects at once**: *Add folders* takes several folders, *All subfolders of a folder* lists the
  folders inside one (git repositories ticked), and folders dragged onto the dashboard are added to the
  collection they are dropped on (in VS Code hold Shift while dropping).
- **Bulk edit**: tick tiles (Shift+click for a range) to move them to a collection, remove them, or change
  their colour, logo, visibility and buttons in one go.

## 1.3.0 — 2026-11-17

- JetBrains: the dashboard opens in the **Home window** of 2026.3 IDEs (and the non-modal welcome screen of
  earlier ones), in place of the start page and its agent prompt. Turn it off in *Settings | Tools | Project Tiles*.
- JetBrains: in the Home window the dashboard no longer offers to add the hidden welcome project as the current folder.

## 1.2.0 — 2026-11-06

- **Per-tile visibility**: each project can show or hide its path, description, languages and git status
  regardless of the global settings (edit form → *Show on the tile*); "Default" follows the global setting.
  Overrides live in `projects.json`, so they apply in every editor.
- New global setting `projectTiles.showDescription`.

## 1.1.0 — 2026-11-06

- **Fetch, pull and push** buttons on tiles of repositories with an upstream. Pull is fast-forward only, so it
  never creates a merge; git's own message is shown when an operation fails.
- **Add recent…**: pick any number of projects from the editor's recently opened list and add them at once.
- **Drives**: a project on a disconnected drive or network share is greyed out ("Drive not connected") and keeps
  its last known details; a folder that was deleted or moved on a connected drive gets a warning instead.
- **Tile options**: hide the path, the languages or the git status (`projectTiles.showPath`, `showLanguages`,
  `showGit`). Hidden parts are not computed at all, so with git hidden no git process runs.
- Smaller buttons on tiles.
- "Add current folder" only appears when a folder or project is open; on the JetBrains welcome screen it did nothing.

## 1.0.2 — 2026-11-04

- JetBrains: the dashboard did not open in 2026.2 IDEs (the embedded browser moved to a separate bundled plugin).

## 1.0.1 — 2026-11-02

- Sponsor link: the *Sponsor* button in VS Code and a link in the JetBrains plugin description point to GitHub Sponsors.

## 1.0.0 — 2026-11-02

First public release, for VS Code and its forks (Positron, Cursor, Antigravity, VSCodium) and for
JetBrains IDEs (PhpStorm, IntelliJ IDEA, WebStorm and the rest of the family, 2025.2 or newer).

- Tile dashboard in its own tab: name, description, logo (emoji or text, an image, or a `logo.png` /
  `icon.png` found in the project) and colour per project.
- Collections with colours and descriptions; drag & drop to reorder projects and collections.
- Git branch, last commit and an ahead/behind badge per repository. `git fetch` runs only when the
  dashboard opens or on manual refresh.
- Languages weighted by bytes like on GitHub, with a manual override.
- One project list shared by every editor and live-synced between open windows.
- English and Polish UI.
