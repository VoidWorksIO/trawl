import * as vscode from 'vscode'

import { VersionCompletionProvider, MAX_VERSIONS } from '../completion'
import * as parser from '../parser'
import * as registry from '../registry'
import { DependencyInfo, NpmPackageInfo } from '../types'


jest.mock('../parser')
jest.mock('../registry')

const MOCK_POSITION_CHAR = 17
const VERSION_START_CHAR = 15
const VERSION_END_CHAR = 23

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
    versions: ['4.17.21', '4.18.0', '5.0.0'],
    distTags: { latest: '5.0.0' },
    time: {
      '4.17.21': '2020-01-01T00:00:00.000Z',
      '4.18.0': '2021-06-01T00:00:00.000Z',
      '5.0.0': '2023-01-15T00:00:00.000Z',
    },
    npmUrl: 'https://www.npmjs.com/package/lodash',
    ...overrides,
  }
}

const mockPosition = new vscode.Position(2, MOCK_POSITION_CHAR)
const mockToken = {} as vscode.CancellationToken
const mockContext = {} as vscode.CompletionContext

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(parser.isPackageJson).mockReturnValue(true)
  jest.mocked(parser.parseDependencies).mockReturnValue([])
  jest.mocked(parser.getDependencyAtPosition).mockReturnValue(undefined)
  ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  })
})

describe('VersionCompletionProvider.provideCompletionItems', () => {
  const provider = new VersionCompletionProvider()

  it('returns undefined for non-package.json documents', async () => {
    jest.mocked(parser.isPackageJson).mockReturnValue(false)
    const document = createMockDocument('/project/other.json')
    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeUndefined()
  })

  it('returns undefined when enableVersionAutocomplete is false', async () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'enableVersionAutocomplete') return false
        return defaultValue
      }),
    })
    const document = createMockDocument()
    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeUndefined()
  })

  it('returns undefined when no dependency is at the cursor position', async () => {
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(undefined)
    const document = createMockDocument()
    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeUndefined()
  })

  it('returns undefined when getPackageInfo returns null', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(null)
    const document = createMockDocument()
    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeUndefined()
  })

  it('returns undefined when packageInfo has no versions', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(
      createMockPackageInfo({ versions: [] })
    )
    const document = createMockDocument()
    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeUndefined()
  })

  it('includes ^latest item as the first suggestion with sortText 0000', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    expect(result).toBeDefined()
    const firstItem = result![0]
    expect(firstItem.label).toBe('^5.0.0')
    expect(firstItem.sortText).toBe('0000')
  })

  it('includes exact latest item with sortText 0001', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const exactItem = result!.find((item) => item.sortText === '0001')
    expect(exactItem?.label).toBe('5.0.0')
  })

  it('includes ~latest item with sortText 0002', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const tildeItem = result!.find((item) => item.sortText === '0002')
    expect(tildeItem?.label).toBe('~5.0.0')
  })

  it('includes other dist-tags before individual versions', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo({
      distTags: { latest: '5.0.0', next: '6.0.0-alpha.1', beta: '5.1.0-beta.1' },
    })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(packageInfo)
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const nextItem = result!.find((item) => item.sortText?.startsWith('01-next'))
    const betaItem = result!.find((item) => item.sortText?.startsWith('01-beta'))
    expect(nextItem).toBeDefined()
    expect(betaItem).toBeDefined()
  })

  it('individual versions are sorted newest-first', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    // Individual version items have sortText starting with '1-'
    const versionItems = result!.filter((item) => item.sortText?.startsWith('1-'))
    // First item should be the newest version
    expect(versionItems[0].label).toBe('^5.0.0')
  })

  it('limits individual versions to MAX_VERSIONS (30)', async () => {
    const dep = createMockDep()
    const manyVersions = Array.from({ length: 50 }, (_, i) => `1.${i}.0`)
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(
      createMockPackageInfo({ versions: manyVersions, distTags: { latest: '1.49.0' } })
    )
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const versionItems = result!.filter((item) => item.sortText?.startsWith('1-'))
    expect(versionItems.length).toBeLessThanOrEqual(MAX_VERSIONS)
  })

  it('replacement range spans the entire version string', async () => {
    const dep = createMockDep({ versionStartChar: VERSION_START_CHAR, versionEndChar: VERSION_END_CHAR, line: 2 })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const firstItem = result![0]
    const range = firstItem.range as vscode.Range
    expect(range.start.line).toBe(2)
    expect(range.start.character).toBe(VERSION_START_CHAR)
    expect(range.end.line).toBe(2)
    expect(range.end.character).toBe(VERSION_END_CHAR)
  })

  it('filterText is set to the version without prefix', async () => {
    const dep = createMockDep()
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(createMockPackageInfo())
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    const firstItem = result![0]
    expect(firstItem.filterText).toBe('5.0.0')
  })

  it('completion items include publish date in detail when available', async () => {
    const dep = createMockDep()
    const packageInfo = createMockPackageInfo({
      versions: ['5.0.0'],
      distTags: { latest: '5.0.0' },
      time: { '5.0.0': '2023-01-15T00:00:00.000Z' },
    })
    jest.mocked(parser.parseDependencies).mockReturnValue([dep])
    jest.mocked(parser.getDependencyAtPosition).mockReturnValue(dep)
    jest.mocked(registry.getPackageInfo).mockResolvedValue(packageInfo)
    const document = createMockDocument()

    const result = await provider.provideCompletionItems(document, mockPosition, mockToken, mockContext)
    // Version items (sortText '1-...') should have publish date in detail
    const versionItems = result!.filter((item) => item.sortText?.startsWith('1-'))
    expect(versionItems[0].detail).toBeDefined()
    expect(typeof versionItems[0].detail).toBe('string')
  })
})
