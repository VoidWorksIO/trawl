/**
 * Code Action provider — offers quick-fix actions to update
 * dependency versions directly in the editor.
 */

import * as vscode from 'vscode';
import { isPackageJson } from './parser';
import { suggestVersionUpdate } from './semver-utils';

export class VersionQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    if (!isPackageJson(document)) return [];

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'trawl') continue;

      const depName = (diagnostic as any)._depName as string | undefined;
      const suggestedVersion = (diagnostic as any)._suggestedVersion as string | undefined;
      const latestVersion = (diagnostic as any)._latestVersion as string | undefined;
      const maxSatisfying = (diagnostic as any)._maxSatisfying as string | undefined;

      if (!depName || !latestVersion) continue;

      // Action: Update to latest version (preserving prefix)
      if (suggestedVersion) {
        const updateToLatest = new vscode.CodeAction(
          `Update ${depName} to ${suggestedVersion}`,
          vscode.CodeActionKind.QuickFix
        );
        updateToLatest.edit = new vscode.WorkspaceEdit();
        updateToLatest.edit.replace(document.uri, diagnostic.range, suggestedVersion);
        updateToLatest.isPreferred = true;
        updateToLatest.diagnostics = [diagnostic];
        actions.push(updateToLatest);
      }

      // Action: Pin to exact latest version
      {
        const pinToLatest = new vscode.CodeAction(
          `Pin ${depName} to exact ${latestVersion}`,
          vscode.CodeActionKind.QuickFix
        );
        pinToLatest.edit = new vscode.WorkspaceEdit();
        pinToLatest.edit.replace(document.uri, diagnostic.range, latestVersion);
        pinToLatest.diagnostics = [diagnostic];
        actions.push(pinToLatest);
      }

      // Action: Open npm page
      {
        const openNpm = new vscode.CodeAction(
          `Open ${depName} on npm`,
          vscode.CodeActionKind.QuickFix
        );
        openNpm.command = {
          title: `Open ${depName} on npm`,
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(`https://www.npmjs.com/package/${depName}`)],
        };
        openNpm.diagnostics = [diagnostic];
        actions.push(openNpm);
      }
    }

    return actions;
  }
}
