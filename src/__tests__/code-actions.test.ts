import * as vscode from 'vscode'

import { VersionQuickFixProvider } from '../code-actions'
import * as parser from '../parser'
import { TrawlDiagnostic } from '../types'


jest.mock('../parser')

interface WorkspaceEditWithReplacements {
  replacements: Array<{ uri: vscode.Uri; range: vscode.Range; newText: string }>
}

const VERSION_START_CHAR = 15
const VERSION_END_CHAR = 23
const MOCK_RANGE_END_CHAR = 30

function createMockDocument(fileName = '/project/package.json'): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fileName),
    fileName,
    languageId: 'json',
    getText: jest.fn(() => '{}'),
  } as unknown as vscode.TextDocument
}

function createTrawlDiagnostic(overrides: Partial<TrawlDiagnostic> = {}): TrawlDiagnostic {
  const range = new vscode.Range(2, VERSION_START_CHAR, 2, VERSION_END_CHAR)
  const diagnostic = new vscode.Diagnostic(range, 'Major update available: 5.0.0', vscode.DiagnosticSeverity.Error) as TrawlDiagnostic
  diagnostic.source = 'trawl'
  diagnostic._depName = 'lodash'
  diagnostic._suggestedVersion = '^5.0.0'
  diagnostic._latestVersion = '5.0.0'
  diagnostic._maxSatisfying = '4.17.21'
  Object.assign(diagnostic, overrides)
  return diagnostic
}

function createMockCodeActionContext(diagnostics: vscode.Diagnostic[]): vscode.CodeActionContext {
  return { diagnostics, triggerKind: 1, only: undefined } as unknown as vscode.CodeActionContext
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(parser.isPackageJson).mockReturnValue(true)
})

describe('VersionQuickFixProvider.provideCodeActions', () => {
  const provider = new VersionQuickFixProvider()
  const mockRange = new vscode.Range(2, 0, 2, MOCK_RANGE_END_CHAR)
  const mockToken = {} as vscode.CancellationToken

  it('returns empty array when no trawl diagnostics are in range', () => {
    const document = createMockDocument()
    const nonTrawlDiagnostic = new vscode.Diagnostic(mockRange, 'Some other issue', vscode.DiagnosticSeverity.Warning)
    nonTrawlDiagnostic.source = 'eslint'
    const context = createMockCodeActionContext([nonTrawlDiagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(0)
  })

  it('ignores diagnostics with source !== trawl', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    diagnostic.source = 'typescript'
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(0)
  })

  it('returns empty array for non-package.json documents', () => {
    jest.mocked(parser.isPackageJson).mockReturnValue(false)
    const document = createMockDocument('/project/other.json')
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(0)
  })

  it('returns 3 code actions per trawl diagnostic', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(3)
  })

  it('update action has suggestedVersion, isPreferred=true, and a WorkspaceEdit', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    const updateAction = actions[0]

    expect(updateAction.title).toContain('^5.0.0')
    expect(updateAction.isPreferred).toBe(true)
    expect(updateAction.edit).toBeInstanceOf(vscode.WorkspaceEdit)
  })

  it('update action WorkspaceEdit replaces with the suggested version', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    const updateAction = actions[0]

    const edit = updateAction.edit as unknown as WorkspaceEditWithReplacements
    expect(edit.replacements).toHaveLength(1)
    expect(edit.replacements[0].uri).toEqual(document.uri)
    expect(edit.replacements[0].range).toEqual(diagnostic.range)
    expect(edit.replacements[0].newText).toBe('^5.0.0')
  })

  it('pin action uses latestVersion without prefix', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    const pinAction = actions[1]

    expect(pinAction.title).toContain('5.0.0')
    const edit = pinAction.edit as unknown as WorkspaceEditWithReplacements
    expect(edit.replacements).toHaveLength(1)
    expect(edit.replacements[0].uri).toEqual(document.uri)
    expect(edit.replacements[0].range).toEqual(diagnostic.range)
    expect(edit.replacements[0].newText).toBe('5.0.0')
  })

  it('open npm action uses vscode.open command with npm URL', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    const openNpmAction = actions[2]

    expect(openNpmAction.title).toContain('lodash')
    expect(openNpmAction.command?.command).toBe('vscode.open')
    expect(openNpmAction.command?.arguments).toBeDefined()
  })

  it('skips diagnostics missing _depName', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    ;(diagnostic as unknown as Record<string, unknown>)._depName = undefined
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(0)
  })

  it('skips diagnostics missing _latestVersion', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    ;(diagnostic as unknown as Record<string, unknown>)._latestVersion = undefined
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(0)
  })

  it('skips the update action when _suggestedVersion is missing but still returns pin and npm actions', () => {
    const document = createMockDocument()
    const diagnostic = createTrawlDiagnostic()
    ;(diagnostic as unknown as Record<string, unknown>)._suggestedVersion = undefined
    const context = createMockCodeActionContext([diagnostic])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    // No update action (suggestedVersion missing), but pin and open npm remain
    expect(actions).toHaveLength(2)
  })

  it('returns actions for multiple diagnostics', () => {
    const document = createMockDocument()
    const diagnostic1 = createTrawlDiagnostic({ _depName: 'lodash', _latestVersion: '5.0.0', _suggestedVersion: '^5.0.0' })
    const diagnostic2 = createTrawlDiagnostic({ _depName: 'react', _latestVersion: '19.0.0', _suggestedVersion: '^19.0.0' })
    const context = createMockCodeActionContext([diagnostic1, diagnostic2])

    const actions = provider.provideCodeActions(document, mockRange, context, mockToken)
    expect(actions).toHaveLength(6)
  })
})
