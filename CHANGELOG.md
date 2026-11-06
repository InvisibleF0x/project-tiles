# Changelog

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
