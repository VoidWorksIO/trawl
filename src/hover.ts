/**
 * Hover provider — shows dependency information on hover.
 * Displays current version, latest version, last publish date,
 * and a link to the npm page.
 */

import * as vscode from 'vscode'

import { getAnalysisCache } from './diagnostics'
import { parseDependencies, isPackageJson, getDependencyAtPosition, getDependencyByName } from './parser'
import { getPackageInfo } from './registry'
import { analyzeVersion } from './semver-utils'


export class DependencyHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    if (!isPackageJson(document)) return undefined

    const config = vscode.workspace.getConfiguration('trawl')
    if (!config.get<boolean>('enableHover', true)) return undefined

    const deps = parseDependencies(document)

    // Check if hovering over a dep name or version
    const depByName = getDependencyByName(document, position, deps)
    const depByVersion = getDependencyAtPosition(document, position, deps)
    const dep = depByName || depByVersion

    if (!dep) return undefined

    // Try to get cached analysis first, otherwise fetch
    const docAnalysis = getAnalysisCache().get(document.uri.toString())
    let cachedEntry = docAnalysis?.get(dep.name)

    let info = cachedEntry?.info
    let analysis = cachedEntry?.analysis

    if (!info) {
      info = await getPackageInfo(dep.name) ?? undefined
      if (!info) return undefined
      analysis = analyzeVersion(dep.versionRange, info)
    }

    if (!analysis) {
      analysis = analyzeVersion(dep.versionRange, info)
    }

    // Build the hover content
    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true

    // Package name and description
    md.appendMarkdown(`### 📦 ${dep.name}\n\n`)

    if (info.description) {
      md.appendMarkdown(`${info.description}\n\n`)
    }

    md.appendMarkdown('---\n\n')

    // Version info table
    md.appendMarkdown('| | |\n|---|---|\n')
    md.appendMarkdown(`| **Current range** | \`${dep.versionRange}\` |\n`)

    if (analysis.maxSatisfying) {
      md.appendMarkdown(`| **Max satisfying** | \`${analysis.maxSatisfying}\` |\n`)
    }

    md.appendMarkdown(`| **Latest** | \`${analysis.latest}\` |\n`)

    // Status
    if (analysis.isUpToDate) {
      md.appendMarkdown('| **Status** | ✅ Up to date |\n')
    }
    else {
      const updateLabel = analysis.updateType.charAt(0).toUpperCase() + analysis.updateType.slice(1)
      md.appendMarkdown(`| **Status** | ⚠️ ${updateLabel} update available |\n`)
    }

    // Publish date
    if (analysis.latestPublishDate) {
      const date = new Date(analysis.latestPublishDate)
      const formatted = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      md.appendMarkdown(`| **Last published** | ${formatted} |\n`)
    }

    md.appendMarkdown(`| **Group** | \`${dep.group}\` |\n`)

    md.appendMarkdown('\n---\n\n')

    // Links
    md.appendMarkdown(`[npm](${info.npmUrl})`)
    if (info.homepage && info.homepage !== info.npmUrl) {
      md.appendMarkdown(` · [Homepage](${info.homepage})`)
    }

    // Hover range — cover the full key-value pair
    const hoverRange = depByName
      ? new vscode.Range(dep.line, dep.nameStartChar, dep.line, dep.nameEndChar)
      : new vscode.Range(dep.line, dep.versionStartChar, dep.line, dep.versionEndChar)

    return new vscode.Hover(md, hoverRange)
  }
}
