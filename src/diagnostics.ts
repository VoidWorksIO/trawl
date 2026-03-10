/**
 * Diagnostics provider — the core differentiator.
 * Automatically analyzes open package.json files and reports
 * outdated dependencies as native VS Code diagnostics with
 * semver-aware severity levels.
 */

import * as vscode from 'vscode';
import { parseDependencies, isPackageJson } from './parser';
import { getPackageInfo, prefetchPackages, scheduleBackgroundRefresh } from './registry';
import { analyzeVersion, suggestVersionUpdate } from './semver-utils';
import { DependencyInfo, VersionAnalysis, NpmPackageInfo } from './types';

/** Diagnostic collection for outdated deps */
let diagnosticCollection: vscode.DiagnosticCollection;

/** Store analysis results for use by other providers (hover, code actions) */
const analysisCache = new Map<string, Map<string, { dep: DependencyInfo; analysis: VersionAnalysis; info: NpmPackageInfo }>>();

export function getAnalysisCache() {
  return analysisCache;
}

/**
 * Initialize the diagnostics system. Called from extension activate().
 */
export function initDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('trawl');
  context.subscriptions.push(diagnosticCollection);

  // Analyze all currently open package.json files
  for (const editor of vscode.window.visibleTextEditors) {
    if (isPackageJson(editor.document)) {
      analyzeDocument(editor.document);
    }
  }

  // Watch for newly opened package.json files
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isPackageJson(doc)) {
        analyzeDocument(doc);
      }
    })
  );

  // Watch for changes to package.json files (debounced)
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isPackageJson(event.document)) {
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          analyzeDocument(event.document);
        }, 1000); // 1 second debounce
      }
    })
  );

  // Watch for saved package.json files
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isPackageJson(doc)) {
        analyzeDocument(doc);
      }
    })
  );

  // Clean up diagnostics when a file is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (isPackageJson(doc)) {
        diagnosticCollection.delete(doc.uri);
        analysisCache.delete(doc.uri.toString());
      }
    })
  );

  // Watch for workspace folder changes (monorepo support)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      scanWorkspaceForPackageJson();
    })
  );

  // Initial workspace scan
  scanWorkspaceForPackageJson();

  return diagnosticCollection;
}

/**
 * Scan the workspace for all package.json files and analyze them.
 * Provides monorepo support by finding all package.json files.
 */
async function scanWorkspaceForPackageJson(): Promise<void> {
  const config = vscode.workspace.getConfiguration('npmDepManager');
  if (!config.get<boolean>('enableDiagnostics', true)) return;

  const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 50);
  for (const file of files) {
    try {
      const doc = await vscode.workspace.openTextDocument(file);
      analyzeDocument(doc);
    } catch {
      // Skip files that can't be opened
    }
  }
}

/**
 * Analyze a single package.json document and set diagnostics.
 */
async function analyzeDocument(document: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration('npmDepManager');
  if (!config.get<boolean>('enableDiagnostics', true)) return;

  const ignoredPackages = config.get<string[]>('ignoredPackages', []);
  const concurrency = config.get<number>('concurrency', 6);

  const deps = parseDependencies(document);
  if (deps.length === 0) {
    diagnosticCollection.set(document.uri, []);
    return;
  }

  // Filter out ignored packages
  const filteredDeps = deps.filter((d) => !ignoredPackages.includes(d.name));
  const packageNames = [...new Set(filteredDeps.map((d) => d.name))];

  // Prefetch all packages concurrently
  const packageInfoMap = await prefetchPackages(packageNames, concurrency);

  // Schedule background refresh for next time
  scheduleBackgroundRefresh(packageNames);

  const diagnostics: vscode.Diagnostic[] = [];
  const docAnalysis = new Map<string, { dep: DependencyInfo; analysis: VersionAnalysis; info: NpmPackageInfo }>();

  for (const dep of filteredDeps) {
    const info = packageInfoMap.get(dep.name);
    if (!info) continue;

    // Skip packages that appear to be local/workspace references
    if (
      dep.versionRange.startsWith('file:') ||
      dep.versionRange.startsWith('link:') ||
      dep.versionRange.startsWith('workspace:') ||
      dep.versionRange.startsWith('git') ||
      dep.versionRange.startsWith('http') ||
      dep.versionRange === '*' ||
      dep.versionRange === 'latest'
    ) {
      continue;
    }

    const analysis = analyzeVersion(dep.versionRange, info);

    // Store for hover/code action providers
    docAnalysis.set(dep.name, { dep, analysis, info });

    if (analysis.isUpToDate || analysis.updateType === 'none') {
      continue;
    }

    // Create diagnostic with semver-aware severity
    const severity = getSeverity(analysis.updateType);
    const suggested = suggestVersionUpdate(dep.versionRange, analysis.latest);

    const range = new vscode.Range(
      dep.line,
      dep.versionStartChar,
      dep.line,
      dep.versionEndChar
    );

    const message = formatDiagnosticMessage(dep, analysis, suggested);

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'trawl';
    diagnostic.code = {
      value: analysis.updateType,
      target: vscode.Uri.parse(info.npmUrl),
    };

    // Store metadata for quick-fix code actions
    (diagnostic as any)._depName = dep.name;
    (diagnostic as any)._suggestedVersion = suggested;
    (diagnostic as any)._latestVersion = analysis.latest;
    (diagnostic as any)._maxSatisfying = analysis.maxSatisfying;

    diagnostics.push(diagnostic);
  }

  analysisCache.set(document.uri.toString(), docAnalysis);
  diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Map update type to VS Code diagnostic severity.
 */
function getSeverity(updateType: string): vscode.DiagnosticSeverity {
  console.log('updateType', updateType);
  switch (updateType) {
    case 'major':
      return vscode.DiagnosticSeverity.Error;
    case 'minor':
      return vscode.DiagnosticSeverity.Warning;
    case 'patch':
      return vscode.DiagnosticSeverity.Information;
    case 'prerelease':
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * Format a human-readable diagnostic message.
 */
function formatDiagnosticMessage(
  dep: DependencyInfo,
  analysis: VersionAnalysis,
  suggested: string
): string {
  const updateLabel = analysis.updateType.charAt(0).toUpperCase() + analysis.updateType.slice(1);
  let msg = `${updateLabel} update available for ${dep.name}: ${analysis.latest}`;

  if (analysis.maxSatisfying && analysis.maxSatisfying !== analysis.latest) {
    msg += ` (current range max: ${analysis.maxSatisfying})`;
  }

  return msg;
}

/**
 * Force re-analysis of all open package.json documents.
 * Used by the "Refresh Cache" command.
 */
export async function refreshAllDiagnostics(): Promise<void> {
  for (const editor of vscode.window.visibleTextEditors) {
    if (isPackageJson(editor.document)) {
      await analyzeDocument(editor.document);
    }
  }
  // Also re-scan workspace
  await scanWorkspaceForPackageJson();
}
