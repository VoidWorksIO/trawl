import * as vscode from 'vscode'

import { initDiagnostics, getAnalysisCache, refreshAllDiagnostics } from '../diagnostics'
import * as parser from '../parser'
import * as registry from '../registry'
import * as semverUtils from '../semver-utils'
import { DependencyInfo, NpmPackageInfo, VersionAnalysis } from '../types'


jest.mock('../parser')
jest.mock('../registry')
jest.mock('../semver-utils')

const DEBOUNCE_TIMEOUT_MS = 1001

function flushPromises(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

function createMockDocument(fileName = '/project/package.json', languageId = 'json'): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fileName),
    fileName,
    languageId,
    getText: jest.fn(() => '{}'),
  } as unknown as vscode.TextDocument
}

function createMockExtensionContext(): vscode.ExtensionContext {
  return {
    subscriptions: { push: jest.fn() },
  } as unknown as vscode.ExtensionContext
}

function createMockDep(overrides: Partial<DependencyInfo> = {}): DependencyInfo {
  return {
    name: 'lodash',
    versionRange: '^4.17.21',
    group: 'dependencies',
    line: 2,
    nameStartChar: 5,
    nameEndChar: 11,
    versionStartChar: 15,
    versionEndChar: 23,
    ...overrides,
  }
}

function createMockPackageInfo(overrides: Partial<NpmPackageInfo> = {}): NpmPackageInfo {
  return {
    name: 'lodash',
    versions: ['4.17.21', '5.0.0'],
    distTags: { latest: '5.0.0' },
    time: { '5.0.0': '2023-01-01T00:00:00.000Z' },
    npmUrl: 'https://www.npmjs.com/package/lodash',
    ...overrides,
  }
}

function createMockAnalysis(overrides: Partial<VersionAnalysis> = {}): VersionAnalysis {
  return {
    currentRange: '^4.17.21',
    maxSatisfying: '4.17.21',
    latest: '5.0.0',
    isUpToDate: false,
    updateType: 'major',
    ...overrides,
  }
}

let mockCollection: { set: jest.Mock; delete: jest.Mock; clear: jest.Mock; dispose: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()

  mockCollection = { set: jest.fn(), delete: jest.fn(), clear: jest.fn(), dispose: jest.fn() }
  ;(vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection)
  ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  })
  ;(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([])
  ;(vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = []

  // Default parser mocks
  jest.mocked(parser.isPackageJson).mockReturnValue(true)
  jest.mocked(parser.parseDependencies).mockReturnValue([])

  // Default registry mocks
  jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map())
  jest.mocked(registry.scheduleBackgroundRefresh).mockReturnValue(undefined)

  // Default semver mocks
  jest.mocked(semverUtils.analyzeVersion).mockReturnValue(createMockAnalysis({ isUpToDate: true, updateType: 'none' }))
  jest.mocked(semverUtils.suggestVersionUpdate).mockReturnValue('^5.0.0')
})

describe('initDiagnostics', () => {
  it('registers all 5 workspace event listeners', () => {
    const context = createMockExtensionContext()
    initDiagnostics(context)

    expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalled()
    expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled()
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled()
    expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalled()
    expect(vscode.workspace.onDidChangeWorkspaceFolders).toHaveBeenCalled()
  })

  it('returns the diagnostic collection', () => {
    const context = createMockExtensionContext()
    const collection = initDiagnostics(context)
    expect(collection).toBe(mockCollection)
  })
})

describe('analyzeDocument (via onDidOpenTextDocument)', () => {
  function getOpenDocumentCallback(): (doc: vscode.TextDocument) => void {
    return (vscode.workspace.onDidOpenTextDocument as jest.Mock).mock.calls[0][0] as (
      doc: vscode.TextDocument
    ) => void
  }

  it('skips non-package.json files', async () => {
    jest.mocked(parser.isPackageJson).mockReturnValue(false)
    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/tsconfig.json', 'json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    expect(parser.parseDependencies).not.toHaveBeenCalled()
  })

  it('skips analysis when enableDiagnostics is false', async () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'enableDiagnostics') return false
        return defaultValue
      }),
    })
    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(parser.parseDependencies).not.toHaveBeenCalled()
  })

  it('sets empty diagnostics when no deps are found', async () => {
    jest.mocked(parser.parseDependencies).mockReturnValue([])
    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    expect(mockCollection.set).toHaveBeenCalledWith(mockDoc.uri, [])
  })

  it('skips packages in ignoredPackages config', async () => {
    const dep = createMockDep({ name: 'ignored-pkg' })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'ignoredPackages') return ['ignored-pkg']
        return defaultValue
      }),
    })

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(registry.prefetchPackages).toHaveBeenCalledWith([], expect.any(Number))
  })

  it('skips file: version ranges', async () => {
    const dep = createMockDep({ versionRange: 'file:../local-pkg' })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    const packageInfo = createMockPackageInfo()
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(semverUtils.analyzeVersion).not.toHaveBeenCalled()
  })

  it('skips workspace: version ranges', async () => {
    const dep = createMockDep({ versionRange: 'workspace:^1.0.0' })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    const packageInfo = createMockPackageInfo()
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(semverUtils.analyzeVersion).not.toHaveBeenCalled()
  })

  it('skips * version', async () => {
    const dep = createMockDep({ versionRange: '*' })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    const packageInfo = createMockPackageInfo()
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(semverUtils.analyzeVersion).not.toHaveBeenCalled()
  })

  it('skips latest version string', async () => {
    const dep = createMockDep({ versionRange: 'latest' })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    const packageInfo = createMockPackageInfo()
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onOpen = getOpenDocumentCallback()
    onOpen(createMockDocument())
    await flushPromises()

    expect(semverUtils.analyzeVersion).not.toHaveBeenCalled()
  })

  it('creates Error diagnostic for major update', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'major' })
    )
    jest.mocked(semverUtils.suggestVersionUpdate).mockReturnValue('^5.0.0')

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    expect(mockCollection.set).toHaveBeenCalledWith(mockDoc.uri, expect.any(Array))
    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as vscode.Diagnostic[]
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Error)
  })

  it('creates Warning diagnostic for minor update', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'minor' })
    )

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package-minor.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as vscode.Diagnostic[]
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Warning)
  })

  it('creates Information diagnostic for patch update', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'patch' })
    )

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package-patch.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as vscode.Diagnostic[]
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Information)
  })

  it('creates Hint diagnostic for prerelease update', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'prerelease' })
    )

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package-pre.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as vscode.Diagnostic[]
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Hint)
  })

  it('stores _depName, _suggestedVersion, _latestVersion metadata on the diagnostic', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'major', latest: '5.0.0' })
    )
    jest.mocked(semverUtils.suggestVersionUpdate).mockReturnValue('^5.0.0')

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package-meta.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as Array<vscode.Diagnostic & { _depName: string; _suggestedVersion: string; _latestVersion: string }>
    expect(diagnostics[0]._depName).toBe('lodash')
    expect(diagnostics[0]._suggestedVersion).toBe('^5.0.0')
    expect(diagnostics[0]._latestVersion).toBe('5.0.0')
  })

  it('does not create diagnostic when dep is up to date', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map([['lodash', packageInfo]]))
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: true, updateType: 'none' })
    )

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package-uptodate.json')
    const onOpen = getOpenDocumentCallback()
    onOpen(mockDoc)
    await flushPromises()

    const diagnostics = mockCollection.set.mock.calls.find(
      (call: unknown[]) => call[0] === mockDoc.uri
    )?.[1] as vscode.Diagnostic[]
    expect(diagnostics).toHaveLength(0)
  })
})

describe('getAnalysisCache', () => {
  it('returns the shared analysis map', () => {
    const cache = getAnalysisCache()
    expect(cache).toBeInstanceOf(Map)
  })
})

describe('onDidCloseTextDocument', () => {
  it('deletes diagnostics and cache for the closed document', () => {
    jest.mocked(parser.isPackageJson).mockReturnValue(true)
    const context = createMockExtensionContext()
    initDiagnostics(context)

    const mockDoc = createMockDocument('/project/package.json')
    const onClose = (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls[0][0] as (
      doc: vscode.TextDocument
    ) => void
    onClose(mockDoc)

    expect(mockCollection.delete).toHaveBeenCalledWith(mockDoc.uri)
  })
})

describe('debounced onDidChangeTextDocument', () => {
  it('only fires analyzeDocument once after 1000ms of quiet', async () => {
    jest.useFakeTimers()
    jest.mocked(parser.parseDependencies).mockReturnValue([])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map())

    const context = createMockExtensionContext()
    initDiagnostics(context)

    const onChange = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0] as (
      event: { document: vscode.TextDocument }
    ) => void
    const mockDoc = createMockDocument()

    // Fire the change event multiple times
    onChange({ document: mockDoc })
    onChange({ document: mockDoc })
    onChange({ document: mockDoc })

    // parseDependencies should not have been called yet
    expect(parser.parseDependencies).not.toHaveBeenCalled()

    // Advance timers past the debounce window and flush async work
    await jest.advanceTimersByTimeAsync(DEBOUNCE_TIMEOUT_MS)

    expect(parser.parseDependencies).toHaveBeenCalledTimes(1)

    jest.useRealTimers()
  })
})

describe('refreshAllDiagnostics', () => {
  it('re-analyses all visible package.json editors', async () => {
    const mockDoc = createMockDocument()
    jest.mocked(parser.isPackageJson).mockReturnValue(true)
    jest.mocked(parser.parseDependencies).mockReturnValue([])
    ;(vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [
      { document: mockDoc },
    ]

    // Need the diagnostic collection to be initialized
    const context = createMockExtensionContext()
    initDiagnostics(context)
    jest.clearAllMocks()
    jest.mocked(parser.isPackageJson).mockReturnValue(true)
    jest.mocked(parser.parseDependencies).mockReturnValue([])
    ;(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([])
    jest.mocked(registry.prefetchPackages).mockResolvedValue(new Map())
    jest.mocked(registry.scheduleBackgroundRefresh).mockReturnValue(undefined)

    await refreshAllDiagnostics()

    expect(parser.parseDependencies).toHaveBeenCalledWith(mockDoc)
  })
})
