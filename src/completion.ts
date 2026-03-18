/**
 * Version autocomplete provider.
 * When the cursor is inside a version string value in dependencies,
 * suggests real npm versions via the standard VS Code autocomplete dropdown.
 */

import * as semver from 'semver'
import * as vscode from 'vscode'

import { parseDependencies, isPackageJson, getDependencyAtPosition } from './parser'
import { getPackageInfo } from './registry'

export const MAX_VERSIONS = 30

export class VersionCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    if (!isPackageJson(document)) return undefined

    const config = vscode.workspace.getConfiguration('trawl')
    if (!config.get<boolean>('enableVersionAutocomplete', true)) return undefined

    // Check if the cursor is inside a version value in a dep group
    const deps = parseDependencies(document)
    const dep = getDependencyAtPosition(document, position, deps)

    if (!dep) return undefined

    // Fetch available versions for this package
    const packageInfo = await getPackageInfo(dep.name)
    if (!packageInfo || packageInfo.versions.length === 0) return undefined

    // Sort versions descending (newest first)
    const sortedVersions = packageInfo.versions
      .filter((v) => semver.valid(v))
      .sort((a, b) => semver.rcompare(a, b))

    // Build completion items
    const items: vscode.CompletionItem[] = []

    // The replacement range is the entire version string
    const replaceRange = new vscode.Range(
      dep.line,
      dep.versionStartChar,
      dep.line,
      dep.versionEndChar
    )

    // Add latest as the top suggestion
    const latest = packageInfo.distTags.latest
    if (latest) {
      const latestItem = new vscode.CompletionItem(
        `^${latest}`,
        vscode.CompletionItemKind.Value
      )
      latestItem.detail = '(latest)'
      latestItem.documentation = new vscode.MarkdownString(
        `Latest stable version of **${dep.name}**`
      )
      latestItem.sortText = '0000'
      latestItem.range = replaceRange
      latestItem.filterText = latest
      items.push(latestItem)

      // Also suggest exact latest
      const exactItem = new vscode.CompletionItem(
        latest,
        vscode.CompletionItemKind.Value
      )
      exactItem.detail = '(latest, exact)'
      exactItem.sortText = '0001'
      exactItem.range = replaceRange
      exactItem.filterText = latest
      items.push(exactItem)

      // Suggest tilde latest
      const tildeItem = new vscode.CompletionItem(
        `~${latest}`,
        vscode.CompletionItemKind.Value
      )
      tildeItem.detail = '(latest, patch updates only)'
      tildeItem.sortText = '0002'
      tildeItem.range = replaceRange
      tildeItem.filterText = latest
      items.push(tildeItem)
    }

    // Add other dist-tags (e.g., next, beta, rc)
    for (const [tag, version] of Object.entries(packageInfo.distTags)) {
      if (tag === 'latest') continue

      const tagItem = new vscode.CompletionItem(
        `^${version}`,
        vscode.CompletionItemKind.Value
      )
      tagItem.detail = `(${tag})`
      tagItem.sortText = `01-${tag}`
      tagItem.range = replaceRange
      tagItem.filterText = `${version} ${tag}`
      items.push(tagItem)
    }

    // Add individual versions (limit to prevent overwhelming)
    const versionItems = sortedVersions.slice(0, MAX_VERSIONS).map((version, index) => {
      const publishDate = packageInfo.time[version]
      const item = new vscode.CompletionItem(`^${version}`, vscode.CompletionItemKind.Value)
      item.detail = publishDate ? new Date(publishDate).toLocaleDateString() : undefined
      item.sortText = `1-${String(index).padStart(4, '0')}`
      item.range = replaceRange
      item.filterText = version
      if (version === latest) {
        item.detail = `${item.detail ?? ''} ★ latest`.trim()
      }
      return item
    })
    items.push(...versionItems)

    return items
  }
}
