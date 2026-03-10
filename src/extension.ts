/**
 * Extension entry point.
 * Wires together all providers and commands.
 */

import * as vscode from 'vscode'

import { VersionQuickFixProvider } from './code-actions'
import { VersionCompletionProvider } from './completion'
import { initDiagnostics, refreshAllDiagnostics } from './diagnostics'
import { DependencyHoverProvider } from './hover'
import { clearCache, setCacheTTL } from './registry'


const DOCUMENT_SELECTOR: vscode.DocumentSelector = {
  language: 'json',
  pattern: '**/package.json',
}

export function activate(context: vscode.ExtensionContext): void {
  // Apply initial configuration
  applyConfig()

  // Initialize diagnostics (zero-click warnings)
  initDiagnostics(context)

  // Register completion provider (trigger on quotes and digits for version editing)
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      new VersionCompletionProvider(),
      '"', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '^', '~'
    )
  )

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      DOCUMENT_SELECTOR,
      new DependencyHoverProvider()
    )
  )

  // Register code action provider (quick-fix)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      DOCUMENT_SELECTOR,
      new VersionQuickFixProvider(),
      { providedCodeActionKinds: VersionQuickFixProvider.providedCodeActionKinds }
    )
  )

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('trawl.checkOutdated', async () => {
      await refreshAllDiagnostics()
      vscode.window.showInformationMessage('Trawl: Dependencies checked.')
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('trawl.refreshCache', async () => {
      clearCache()
      await refreshAllDiagnostics()
      vscode.window.showInformationMessage('Trawl: Cache cleared and dependencies refreshed.')
    })
  )

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('trawl')) {
        applyConfig()
        refreshAllDiagnostics()
      }
    })
  )

}

const DEFAULT_CACHE_TTL_MINUTES = 30

function applyConfig(): void {
  const config = vscode.workspace.getConfiguration('trawl')
  const ttl = config.get<number>('cacheTTLMinutes', DEFAULT_CACHE_TTL_MINUTES)
  setCacheTTL(ttl)
}

export function deactivate(): void {
  // Cleanup is handled by disposables in context.subscriptions
}
