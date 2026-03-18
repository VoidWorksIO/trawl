import * as vscode from 'vscode'

import * as diagnostics from '../diagnostics'
import { DependencyHoverProvider } from '../hover'
import * as parser from '../parser'
import * as registry from '../registry'
import * as semverUtils from '../semver-utils'
import { DependencyInfo, NpmPackageInfo, VersionAnalysis } from '../types'


jest.mock('../parser')
jest.mock('../registry')
jest.mock('../diagnostics')
jest.mock('../semver-utils')

function createMockDocument(fileName = '/project/package.json'): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fileName),
    fileName,
    languageId: 'json',
    getText: jest.fn(() => '{}'),
  } as unknown as vscode.TextDocument
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
    time: { '5.0.0': '2023-01-15T00:00:00.000Z' },
    npmUrl: 'https://www.npmjs.com/package/lodash',
    description: 'A utility library',
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

const MOCK_POSITION_CHAR = 17
const mockPosition = new vscode.Position(2, MOCK_POSITION_CHAR)
const mockToken = {} as vscode.CancellationToken

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(parser.isPackageJson).mockReturnValue(true)
  jest.mocked(parser.parseDependencies).mockReturnValue([])
  jest.mocked(parser.getDependencyByName).mockReturnValue(undefined)
  jest.mocked(parser.getDependencyAtPosition).mockReturnValue(undefined)
  jest.mocked(registry.getPackageInfo).mockResolvedValue(null)
  jest.mocked(diagnostics.getAnalysisCache).mockReturnValue(new Map())
  jest.mocked(semverUtils.analyzeVersion).mockReturnValue(createMockAnalysis())
  ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  })
})

describe('DependencyHoverProvider.provideHover', () => {
  const provider = new DependencyHoverProvider()

  it('returns undefined for non-package.json documents', async () => {
    jest.mocked(parser.isPackageJson).mockReturnValue(false)
    const document = createMockDocument('/project/other.json')
    const result = await provider.provideHover(document, mockPosition, mockToken)
    expect(result).toBeUndefined()
  })

  it('returns undefined when enableHover is false', async () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'enableHover') return false
        return defaultValue
      }),
    })
    const document = createMockDocument()
    const result = await provider.provideHover(document, mockPosition, mockToken)
    expect(result).toBeUndefined()
  })

  it('returns undefined when no dep is found at position', async () => {
    jest.mocked(parser.getDependencyByName).mockReturnValue(undefined)
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(undefined)
    const document = createMockDocument()
    const result = await provider.provideHover(document, mockPosition, mockToken)
    expect(result).toBeUndefined()
  })

  it('returns undefined when getPackageInfo returns null', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(null)
    const document = createMockDocument()
    const result = await provider.provideHover(document, mockPosition, mockToken)
    expect(result).toBeUndefined()
  })

  it('prefers dep found by name over dep found by version position', async () => {
    const depByName = createMockDep({ name: 'lodash-by-name' })
    const depByVersion = createMockDep({ name: 'lodash-by-version' })
    jest.mocked(parser.getDependencyByName).mockReturnValue(depByName)
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(depByVersion)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo({ name: 'lodash-by-name' }))
    const document = createMockDocument()

    await provider.provideHover(document, mockPosition, mockToken)
    expect(registry.getPackageInfo).toHaveBeenCalledWith('lodash-by-name')
  })

  it('uses cached analysis when available', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo()
    const cachedAnalysis = createMockAnalysis({ isUpToDate: true, updateType: 'none' })
    const document = createMockDocument()
    const docCache = new Map([[dep.name, { dep, analysis: cachedAnalysis, info: packageInfo }]])
    jest.mocked(diagnostics.getAnalysisCache).mockReturnValue(
      new Map([[document.uri.toString(), docCache]])
    )
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)

    await provider.provideHover(document, mockPosition, mockToken)

    // Should use cached data, not fetch fresh
    expect(registry.getPackageInfo).not.toHaveBeenCalled()
    expect(semverUtils.analyzeVersion).not.toHaveBeenCalled()
  })

  it('falls back to fresh analyzeVersion when no cache for dep', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    jest.mocked(diagnostics.getAnalysisCache).mockReturnValue(new Map())
    const document = createMockDocument()

    await provider.provideHover(document, mockPosition, mockToken)

    expect(semverUtils.analyzeVersion).toHaveBeenCalled()
  })

  it('hover content is a MarkdownString with package name header', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    expect(result).toBeInstanceOf(vscode.Hover)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('lodash')
  })

  it('hover table includes current range, latest, status, and group', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(createMockAnalysis())
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('Current range')
    expect(md.value).toContain('Latest')
    expect(md.value).toContain('Status')
    expect(md.value).toContain('Group')
  })

  it('status row shows up to date when updateType is none', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: true, updateType: 'none' })
    )
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('Up to date')
  })

  it('status row shows Major update available for major update', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    jest.mocked(semverUtils.analyzeVersion).mockReturnValue(
      createMockAnalysis({ isUpToDate: false, updateType: 'major' })
    )
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('Major update available')
  })

  it('hover includes npm link', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(
      createMockPackageInfo({ npmUrl: 'https://www.npmjs.com/package/lodash' })
    )
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('[npm]')
  })

  it('hover includes homepage link when it differs from npmUrl', async () => {
    const dep = createMockDep()
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(
      createMockPackageInfo({
        npmUrl: 'https://www.npmjs.com/package/lodash',
        homepage: 'https://lodash.com',
      })
    )
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const md = result!.contents as unknown as { value: string }
    expect(md.value).toContain('[Homepage]')
  })

  it('hover range uses name range when hovering by name', async () => {
    const dep = createMockDep({ nameStartChar: 5, nameEndChar: 11, line: 2 })
    jest.mocked(parser.getDependencyByName).mockReturnValue(dep)
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(undefined)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const range = result!.range as vscode.Range
    expect(range.start.character).toBe(dep.nameStartChar)
    expect(range.end.character).toBe(dep.nameEndChar)
  })

  it('hover range uses version range when hovering by version', async () => {
    const dep = createMockDep({ versionStartChar: 15, versionEndChar: 23, line: 2 })
    jest.mocked(parser.getDependencyByName).mockReturnValue(undefined)
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideHover(document, mockPosition, mockToken)
    const range = result!.range as vscode.Range
    expect(range.start.character).toBe(dep.versionStartChar)
    expect(range.end.character).toBe(dep.versionEndChar)
  })
})
