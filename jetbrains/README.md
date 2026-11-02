# Project Tiles for JetBrains IDEs

The Project Tiles dashboard for PhpStorm and every other IntelliJ-based IDE (2025.2 or newer).
It shows the same page as the VS Code extension and reads and writes the same project list, so a
change made in one editor appears in the other.

## Where it shows up

- **Editor tab**: *Tools | Project Tiles | Open Dashboard*, or the tiles icon on the side bar.
- **Welcome screen**: a *Projects* tab with the dashboard, next to the IDE's own recent-projects list.
- *Tools | Project Tiles* also has *Add Current Project*, *Refresh Git & Language Info* and *Open Data File*.
- Settings: *Settings | Tools | Project Tiles*.

Clicking a tile opens the project in this window, and *New window* opens it in a new one. A VS Code
`.code-workspace` entry opens the folder that contains it. *Terminal* opens the IDE's terminal in the
project folder, or the system terminal on the welcome screen.

## How it is built

- `media/dashboard.js` and `media/dashboard.css` run unchanged in JCEF. A short inline script provides
  `acquireVsCodeApi()`, and the IDE theme is mapped onto the `--vscode-*` CSS variables.
- `shared/` (UI strings, language table) is common to both editions. Gradle copies both folders into the plugin.
- `domain/` (catalog rules), `storage/` (shared JSON, per-IDE metadata cache), `services/` (git CLI,
  language scan, logos, metadata refresh), `ui/` (JCEF view, editor tab, side bar, welcome tab).

## Development

Requires JDK 21.

```
./gradlew test           # unit tests
./gradlew buildPlugin    # build/distributions/project-tiles-jetbrains-<version>.zip
./gradlew verifyPlugin   # Plugin Verifier against the oldest and newest supported PhpStorm
./gradlew runIde -PopenProject=<dir> -PappData=<scratch dir>
```

`runIde` starts IntelliJ IDEA Community 2025.2 with the plugin. `-PopenProject` opens that project, and
`-PappData` points the shared data folder at a throwaway location instead of your real list.
