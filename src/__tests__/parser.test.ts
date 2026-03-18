import * as vscode from 'vscode'

import { parseDependencies, isPackageJson, getDependencyAtPosition, getDependencyByName } from '../parser'


// Char positions for `    "lodash": "^4.17.21"` (line 2 of SIMPLE_PACKAGE_JSON)
const NAME_START_CHAR = 5
const NAME_END_CHAR = 11
const VERSION_START_CHAR = 15
const VERSION_END_CHAR = 23

function createMockDocument(text: string, fileName = '/workspace/package.json', languageId = 'json'): vscode.TextDocument {
  const lines = text.split('\n')

  function positionAt(offset: number): vscode.Position {
    const lineStartOffsets = lines.map((_, i) =>
      lines.slice(0, i).reduce((sum, line) => sum + line.length + 1, 0)
    )
    const lineIndex = lineStartOffsets.filter((start) => start <= offset).length - 1
    const safeLineIndex = Math.max(0, lineIndex)
    return new vscode.Position(safeLineIndex, offset - lineStartOffsets[safeLineIndex])
  }

  function offsetAt(position: vscode.Position): number {
    return lines.slice(0, position.line).reduce((acc, line) => acc + line.length + 1, 0) + position.character
  }

  return {
    getText: () => text,
    languageId,
    fileName,
    uri: vscode.Uri.file(fileName),
    positionAt,
    offsetAt,
  } as unknown as vscode.TextDocument
}

const SIMPLE_PACKAGE_JSON = `{
  "dependencies": {
    "lodash": "^4.17.21"
  }
}`

describe('isPackageJson', () => {
  it('returns true for a document named package.json with json languageId', () => {
    const document = createMockDocument('{}', '/project/package.json', 'json')
    expect(isPackageJson(document)).toBe(true)
  })

  it('returns false for a non-package.json filename', () => {
    const document = createMockDocument('{}', '/project/other.json', 'json')
    expect(isPackageJson(document)).toBe(false)
  })

  it('returns false when languageId is not json', () => {
    const document = createMockDocument('{}', '/project/package.json', 'javascript')
    expect(isPackageJson(document)).toBe(false)
  })
})

describe('parseDependencies', () => {
  it('returns empty array on invalid JSON', () => {
    const document = createMockDocument('not valid json { {{')
    const deps = parseDependencies(document)
    expect(deps).toEqual([])
  })

  it('returns empty array for empty object', () => {
    const document = createMockDocument('{}')
    const deps = parseDependencies(document)
    expect(deps).toEqual([])
  })

  it('extracts dependencies from the dependencies group', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    expect(deps).toHaveLength(1)
    expect(deps[0].name).toBe('lodash')
    expect(deps[0].versionRange).toBe('^4.17.21')
    expect(deps[0].group).toBe('dependencies')
  })

  it('extracts scoped packages correctly', () => {
    const text = `{
  "dependencies": {
    "@org/pkg": "^1.0.0"
  }
}`
    const document = createMockDocument(text)
    const deps = parseDependencies(document)
    expect(deps).toHaveLength(1)
    expect(deps[0].name).toBe('@org/pkg')
    expect(deps[0].versionRange).toBe('^1.0.0')
  })

  it('records correct line number for the dependency', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    expect(deps[0].line).toBe(2)
  })

  it('records correct name char positions', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    expect(dep.nameStartChar).toBe(NAME_START_CHAR)
    expect(dep.nameEndChar).toBe(NAME_END_CHAR)
  })

  it('records correct version char positions', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    expect(dep.versionStartChar).toBe(VERSION_START_CHAR)
    expect(dep.versionEndChar).toBe(VERSION_END_CHAR)
  })

  it('extracts deps from all 4 dependency groups', () => {
    const text = `{
  "dependencies": { "react": "^18.0.0" },
  "devDependencies": { "jest": "^29.0.0" },
  "peerDependencies": { "typescript": "^5.0.0" },
  "optionalDependencies": { "fsevents": "^2.0.0" }
}`
    const document = createMockDocument(text)
    const deps = parseDependencies(document)
    const groups = deps.map((dep) => dep.group)
    expect(groups).toContain('dependencies')
    expect(groups).toContain('devDependencies')
    expect(groups).toContain('peerDependencies')
    expect(groups).toContain('optionalDependencies')
    expect(deps).toHaveLength(4)
  })

  it('extracts both dependencies and devDependencies', () => {
    const text = `{
  "dependencies": {
    "react": "^18.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}`
    const document = createMockDocument(text)
    const deps = parseDependencies(document)
    expect(deps).toHaveLength(2)
    const names = deps.map((dep) => dep.name)
    expect(names).toContain('react')
    expect(names).toContain('jest')
  })
})

describe('getDependencyAtPosition', () => {
  it('returns the dep when position is inside the version string', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const position = new vscode.Position(dep.line, dep.versionStartChar + 1)
    const result = getDependencyAtPosition(document, position, deps)
    expect(result).toBeDefined()
    expect(result?.name).toBe('lodash')
  })

  it('returns the dep when position is at the start of the version string', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const position = new vscode.Position(dep.line, dep.versionStartChar)
    const result = getDependencyAtPosition(document, position, deps)
    expect(result).toBeDefined()
  })

  it('returns undefined when position is outside the version string', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const OUT_OF_RANGE_OFFSET = 5
    const position = new vscode.Position(dep.line, dep.versionEndChar + OUT_OF_RANGE_OFFSET)
    const result = getDependencyAtPosition(document, position, deps)
    expect(result).toBeUndefined()
  })

  it('returns undefined when position is on a different line', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const position = new vscode.Position(0, 0)
    const result = getDependencyAtPosition(document, position, deps)
    expect(result).toBeUndefined()
  })
})

describe('getDependencyByName', () => {
  it('returns the dep when position is inside the name key', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const position = new vscode.Position(dep.line, dep.nameStartChar + 1)
    const result = getDependencyByName(document, position, deps)
    expect(result).toBeDefined()
    expect(result?.name).toBe('lodash')
  })

  it('returns the dep when position is at the start of the name', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const position = new vscode.Position(dep.line, dep.nameStartChar)
    const result = getDependencyByName(document, position, deps)
    expect(result).toBeDefined()
  })

  it('returns undefined when position is outside the name', () => {
    const document = createMockDocument(SIMPLE_PACKAGE_JSON)
    const deps = parseDependencies(document)
    const dep = deps[0]
    const OUT_OF_RANGE_OFFSET = 5
    const position = new vscode.Position(dep.line, dep.nameEndChar + OUT_OF_RANGE_OFFSET)
    const result = getDependencyByName(document, position, deps)
    expect(result).toBeUndefined()
  })
})
