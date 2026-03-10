# NPM Dependency Manager

Zero-click outdated dependency warnings and version autocomplete for `package.json` — right inside VS Code and Cursor.

The key differentiator versus existing tools is the **zero-interaction warning model**. Existing extensions either require clicking a toolbar button (Version Lens) or opening a sidebar panel (NPM by Idered). This extension surfaces outdated deps as native VS Code diagnostics — they show up in the Problems panel, as underlines in the editor, and in the file explorer decorations, just like a TypeScript error would.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [NPM Scripts](#npm-scripts)
- [Getting Started](#getting-started)
- [Building for Distribution](#building-for-distribution)
- [Publishing](#publishing)
- [Configuration](#configuration)
- [Commands](#commands)

---

## Features

**Zero-Click Diagnostics** — Outdated dependencies appear as native VS Code warnings the moment you open a `package.json`. No toolbar button, no sidebar, no CodeLens.

**Semver-Aware Severity** — Patch updates show as `Information` (blue), minor/major updates show as `Warning` (yellow), and pre-release changes show as `Hint`.

**Version Autocomplete** — When your cursor is inside a version string, real npm versions appear in the standard autocomplete dropdown, sorted newest-first, with `latest`, `next`, and other dist-tags highlighted.

**Quick-Fix Actions** — Click the lightbulb (or `Cmd+.` / `Ctrl+.`) on any outdated dependency to update to latest (preserving your `^`/`~` prefix), pin to an exact version, or open on npm.

**Hover Documentation** — Hover over any dependency name or version to see the package description, current range vs. latest version, max satisfying version, last publish date, and links to npm and homepage.

**Monorepo Support** — Automatically discovers and analyzes all `package.json` files in your workspace.

**Intelligent Caching** — Registry responses are cached with a configurable TTL (default 30 min). Background refresh keeps the cache warm so the UX is never blocked by network calls.

---

## Project Structure

```
trawl/
├── .vscode/
│   ├── launch.json          # F5 debug configuration for Extension Development Host
│   └── tasks.json           # Build task wired to esbuild watch mode
├── dist/
│   └── extension.js         # Bundled output (single file, all source + deps merged)
├── src/
│   ├── extension.ts         # Entry point — registers all providers, commands, and config watchers
│   ├── types.ts             # Shared TypeScript interfaces and constants
│   ├── parser.ts            # Parses package.json to extract dependencies with exact character positions
│   ├── registry.ts          # npm registry HTTP client with in-memory cache, TTL, and request dedup
│   ├── semver-utils.ts      # Semver analysis — determines update type (major/minor/patch) and suggests new ranges
│   ├── diagnostics.ts       # Core feature — zero-click diagnostic warnings with semver-aware severity
│   ├── code-actions.ts      # Quick-fix lightbulb actions (update version, pin exact, open npm)
│   ├── completion.ts        # Autocomplete provider for version strings inside dependency values
│   └── hover.ts             # Hover provider showing version info, publish date, and npm links
├── .gitignore               # Ignores node_modules, dist, out, and .vsix files
├── .vscodeignore            # Controls what goes into the .vsix package (excludes source, config, node_modules)
├── esbuild.js               # Build script — bundles all TS into a single dist/extension.js
├── package.json             # Extension manifest (activation events, commands, settings, scripts, deps)
├── tsconfig.json            # TypeScript compiler options (strict, ES2022, CommonJS)
└── README.md
```

### Directory breakdown

#### `.vscode/`

VS Code workspace configuration for developing this extension. `launch.json` defines a debug configuration that launches a new VS Code window (the Extension Development Host) with this extension loaded — press `F5` to start. `tasks.json` wires the default build task to esbuild in watch mode so the extension recompiles on every save.

#### `src/`

All TypeScript source files. This is where the extension logic lives. Each file is a self-contained module with a single responsibility:

| File | Purpose |
|------|---------|
| `extension.ts` | Entry point. Called by VS Code on activation. Registers every provider (diagnostics, completions, hover, code actions) and both commands. Listens for configuration changes. |
| `types.ts` | Shared type definitions — `DependencyInfo`, `NpmPackageInfo`, `VersionAnalysis`, `CachedPackageInfo`, and the `DependencyGroup` union. No runtime logic. |
| `parser.ts` | Parses a `package.json` `TextDocument` and extracts every dependency entry across all four groups (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`). Returns precise line/character positions so diagnostics underline the exact version string. |
| `registry.ts` | HTTP client for the npm registry (`https://registry.npmjs.org/<package>`). Features an in-memory cache with configurable TTL, inflight request deduplication (concurrent calls for the same package share one HTTP request), and a `scheduleBackgroundRefresh` function that pre-fetches packages nearing cache expiry. Falls back to stale cache data on network errors. |
| `semver-utils.ts` | Wraps the `semver` library to compare a declared version range against available versions. Determines the update type (`major`, `minor`, `patch`, `prerelease`, or `none`) and generates a suggested update string that preserves the user's prefix (`^`, `~`, etc.). |
| `diagnostics.ts` | The core differentiator. On file open, change, and save, it parses dependencies, concurrently fetches registry data, runs semver analysis, and sets native VS Code diagnostics with severity mapped to update type. Also handles workspace scanning for monorepo support. |
| `code-actions.ts` | `CodeActionProvider` that reads diagnostics on the current line and offers quick-fix actions: "Update to ^x.y.z", "Pin to exact x.y.z", and "Open on npm". |
| `completion.ts` | `CompletionItemProvider` triggered inside version string values. Fetches real npm versions and presents them sorted newest-first, with `^`, `~`, and exact variants. Includes dist-tags like `latest`, `next`, and `beta`. |
| `hover.ts` | `HoverProvider` for dependency names and version values. Shows a Markdown table with current range, max satisfying version, latest version, update status, publish date, dependency group, and links to npm/homepage. |

#### `dist/`

Build output directory. Contains a single `extension.js` file produced by esbuild. This file bundles all TypeScript source and the `semver` dependency into one file. The `vscode` module is excluded (it's provided by the VS Code runtime). This is what VS Code actually loads.

---

## NPM Scripts

Defined in `package.json` under `"scripts"`:

| Script | Command | What it does |
|--------|---------|--------------|
| `compile` | `npm run check-types && node esbuild.js` | Type-checks the project with `tsc --noEmit`, then bundles with esbuild (development mode — includes sourcemaps, no minification). |
| `check-types` | `tsc --noEmit` | Runs the TypeScript compiler in check-only mode. Reports type errors without emitting any files. |
| `watch` | `node esbuild.js --watch` | Starts esbuild in watch mode. Rebuilds `dist/extension.js` on every source file change. Used during development alongside the Extension Development Host. |
| `watch:esbuild` | `node esbuild.js --watch` | Alias for `watch`. Present for compatibility if you want to run esbuild and tsc watches separately. |
| `watch:tsc` | `tsc --noEmit --watch --project tsconfig.json` | Runs the TypeScript compiler in watch mode for continuous type-checking in a separate terminal. |
| `package` | `npm run check-types && node esbuild.js --production` | Production build. Type-checks, then bundles with esbuild using `--production` flag (minified, no sourcemaps). Used before packaging a `.vsix`. |
| `vscode:prepublish` | `npm run package` | Automatically called by `vsce` before creating a `.vsix` or publishing. Ensures a clean production build. |
| `lint` | `eslint src --ext ts` | Lints all TypeScript files in `src/`. Requires eslint to be installed (optional dev dependency — not included by default). |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [VS Code](https://code.visualstudio.com/) or [Cursor](https://cursor.sh/)

### Install and run

```bash

# Install dependencies
npm install

# Open in VS Code / Cursor
code .
```

Press **F5** to launch the Extension Development Host. Open any project with a `package.json` and you should see outdated dependency warnings appear automatically.

### Development workflow

1. Run `npm watch` in a terminal (or let the default build task handle it)
2. Press `F5` to open the Extension Development Host
3. Edit source files in `src/` — esbuild recompiles on save
4. Press `Ctrl+Shift+F5` (or `Cmd+Shift+F5`) to reload the Extension Development Host and pick up changes

---

## Building for Distribution

There are two ways to distribute this extension: as a `.vsix` file (for direct installation) or via a marketplace (for public discovery).

### 1. Package as a `.vsix` file

A `.vsix` is a zip archive that VS Code and Cursor can install directly. This is the simplest distribution method and works for private/team use.

```bash
# Install the VS Code Extension CLI (one time)
npm install -g @vscode/vsce

# Build and package
vsce package
```

This runs the `vscode:prepublish` script (which type-checks and creates a minified production build), then packages everything into a file like `trawl-0.1.0.vsix`.

The `.vscodeignore` file controls what goes into the package. Source files, `node_modules`, and config files are excluded — only `dist/extension.js`, `package.json`, and `README.md` are included, keeping the package small (~17 KB).

### 2. Install the `.vsix` locally

**Via the UI:**

1. Open VS Code / Cursor
2. Go to the Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Click the `...` menu at the top of the Extensions panel
4. Select **Install from VSIX...**
5. Choose the `.vsix` file

**Via the command line:**

```bash
# VS Code
code --install-extension trawl-0.1.0.vsix

# Cursor
cursor --install-extension trawl-0.1.0.vsix
```

### 3. Bump the version

Before publishing updates, bump the version. You can do this manually in `package.json` or let `vsce` handle it:

```bash
vsce publish patch   # 0.1.0 → 0.1.1
vsce publish minor   # 0.1.0 → 0.2.0
vsce publish major   # 0.1.0 → 1.0.0
```

---

## Publishing

### Option A: Visual Studio Marketplace

This is where most VS Code users discover extensions. Cursor also uses this marketplace.

**One-time setup:**

1. Create a [Microsoft account](https://account.microsoft.com/) if you don't have one
2. Go to [Azure DevOps](https://dev.azure.com/) and create an organization
3. Generate a **Personal Access Token (PAT)**: profile icon → User settings → Personal access tokens → New Token. Set the scope to **Marketplace > Manage**. Copy the token immediately.
4. Create a publisher at the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage) (or run `vsce create-publisher <name>`)
5. Login: `vsce login <publisher-name>` and paste your PAT when prompted

**Publish:**

```bash
# From the extension root directory
vsce publish
```

Your extension will be live at `https://marketplace.visualstudio.com/items?itemName=<publisher>.<extension-name>` within a few minutes.

### Option B: Open VSX Registry

[Open VSX](https://open-vsx.org/) is the open-source marketplace used by VS Code forks like VSCodium, Gitpod, and Eclipse Theia.

**One-time setup:**

1. Create an account at [accounts.eclipse.org](https://accounts.eclipse.org/) and sign the Eclipse Contributor Agreement
2. Link your GitHub account under Social Accounts
3. Log in to [open-vsx.org](https://open-vsx.org/) with GitHub
4. Create a namespace at [open-vsx.org/user-settings/namespaces](https://open-vsx.org/user-settings/namespaces) matching your publisher name
5. Generate an access token at [open-vsx.org/user-settings/tokens](https://open-vsx.org/user-settings/tokens)

**Publish:**

```bash
# Install the Open VSX CLI (one time)
npm install -g ovsx

# Create the namespace (first time only)
npx ovsx create-namespace <publisher-name> -p <token>

# Package the extension
vsce package

# Publish the .vsix
npx ovsx publish trawl-0.1.0.vsix -p <token>
```

### Option C: GitHub Releases (private / manual distribution)

If you just want to share the `.vsix` with your team without a marketplace listing:

1. Run `vsce package` to generate the `.vsix`
2. Create a GitHub release on your repo
3. Attach the `.vsix` file as a release asset
4. Recipients download the `.vsix` and install it via **Install from VSIX...**

### CI/CD automation

You can automate publishing with GitHub Actions. Add your PATs as repository secrets (`VSCE_TOKEN` and `OVSX_TOKEN`) and create a workflow:

```yaml
name: Publish Extension
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run package
      - run: npx @vscode/vsce package
      - run: npx @vscode/vsce publish -p ${{ secrets.VSCE_TOKEN }}
      - run: npx ovsx publish -p ${{ secrets.OVSX_TOKEN }}
```

Then tag and push to trigger a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Configuration

All settings are under the `trawl` namespace in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `trawl.cacheTTLMinutes` | `30` | How long to cache npm registry responses before background refresh |
| `trawl.enableDiagnostics` | `true` | Toggle automatic outdated dependency warnings |
| `trawl.enableVersionAutocomplete` | `true` | Toggle version autocomplete inside dependency values |
| `trawl.enableHover` | `true` | Toggle hover documentation on dependencies |
| `trawl.concurrency` | `6` | Max concurrent requests to the npm registry |
| `trawl.ignoredPackages` | `[]` | Package names to skip when checking for updates |

---

## Commands

Available from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| **NPM: Check Outdated Dependencies** | Manually trigger a dependency check across all open `package.json` files |
| **NPM: Refresh Dependency Cache** | Clear the in-memory cache and re-check everything from the registry |

---

## License

MIT
