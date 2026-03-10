# Project Overview

Trawl is a VS Code extension that provides zero-click outdated dependency warnings and version autocomplete for `package.json` files. Outdated deps surface as native VS Code diagnostics (Problems panel, editor underlines, file explorer decorations) - no toolbar button, no sidebar required.

## Essential Commands

### Development
- `yarn compile` - Type-check then bundle with esbuild (dev mode, with sourcemaps)
- `yarn watch` - Start esbuild in watch mode (use alongside F5 Extension Development Host)
- `yarn check-types` - Run `tsc --noEmit` to check types without emitting files
- `yarn package` - Production build (type-check + minified bundle, no sourcemaps)
- `yarn lint` - Run ESLint on `src/`

### Debugging
Press **F5** in VS Code to launch the Extension Development Host with the extension loaded. After editing source files, press `Ctrl+Shift+F5` / `Cmd+Shift+F5` to reload.

## Architecture Overview

### Tech Stack
- TypeScript (strict mode, ES2022, CommonJS output)
- VS Code Extension API (`vscode` 1.85+)
- `semver` library for version comparison
- esbuild for bundling (single output file: `dist/extension.js`)
- Node.js `https` module for npm registry HTTP requests (no fetch, no axios)

### Key Directory Structure
```
src/
├── extension.ts      # Entry point - registers all providers and commands
├── types.ts          # Shared interfaces and constants (no runtime logic)
├── parser.ts         # Parses package.json TextDocument, returns deps with exact char positions
├── registry.ts       # npm registry HTTP client with TTL cache + request deduplication
├── semver-utils.ts   # Version analysis (update type, suggested range)
├── diagnostics.ts    # Core feature - zero-click diagnostic warnings
├── code-actions.ts   # Quick-fix lightbulb actions (update, pin, open npm)
├── completion.ts     # Autocomplete provider for version strings
└── hover.ts          # Hover provider showing version info and npm links
```

### Core Features
- **Diagnostics**: Severity mapped to update type - major=Error, minor=Warning, patch=Info, prerelease=Hint
- **Completion**: Real npm versions sorted newest-first, dist-tags included, replaces entire version string
- **Hover**: Markdown table with current range, max satisfying, latest, publish date, and npm links
- **Code Actions**: Update to latest (preserving `^`/`~` prefix), pin exact, open on npm
- **Caching**: In-memory TTL cache with inflight deduplication and background refresh at 80% TTL

### Import Paths
Uses relative imports within `src/` - no path aliases. Example:
```ts
import { parseDependencies } from './parser'
import { getPackageInfo } from './registry'
```

### Configuration Namespace
All VS Code settings use the `trawl.*` prefix (e.g. `trawl.cacheTTLMinutes`). When reading config, always use `vscode.workspace.getConfiguration('trawl')`.

## Testing Strategy

No test suite exists yet. When adding tests, use Jest with the `@vscode/test-electron` runner. Place test files alongside source in `src/__tests__/`.

## Development Guidelines

### Code Style
- Never use `any` - use `unknown`, generics, or utility types
- Use descriptive variable names; use singular form when iterating (e.g. `for (const dep of deps)`)
- Avoid superfluous comments; only comment for non-obvious logic or business rules
- Do not truncate variable names (e.g. `document` not `doc`, `packageName` not `pkg`)
- Prefer interfaces over type aliases
- Named exports everywhere; no default exports

### VS Code Extension Patterns
- Register all disposables via `context.subscriptions.push(...)` - never leak disposables
- Use `vscode.workspace.getConfiguration('trawl')` for all config reads
- Diagnostics go through the shared `DiagnosticCollection` in `diagnostics.ts`
- Analysis results are cached in the `analysisCache` Map and shared with hover/code-action providers to avoid redundant registry calls
- The `TrawlDiagnostic` type extends `vscode.Diagnostic` with metadata fields (`_depName`, `_suggestedVersion`, etc.) for use by code actions

### Dependency Pinning
Always pin packages to exact versions in `package.json` (e.g. `"semver": "7.6.0"`, not `"^7.6.0"`).
