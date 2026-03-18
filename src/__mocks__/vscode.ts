export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  readonly start: Position
  readonly end: Position

  constructor(
    startOrLine: Position | number,
    startCharOrEnd: Position | number,
    endLine?: number,
    endChar?: number
  ) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, startCharOrEnd as number)
      this.end = new Position(endLine as number, endChar as number)
    }
    else {
      this.start = startOrLine
      this.end = startCharOrEnd as Position
    }
  }
}

export class Diagnostic {
  source?: string
  code?: unknown
  relatedInformation?: unknown[]

  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
}

export class DiagnosticRelatedInformation {
  constructor(public location: unknown, public message: string) {}
}

export class Uri {
  readonly fsPath: string

  private constructor(public readonly scheme: string, private readonly rawPath: string) {
    this.fsPath = rawPath
  }

  toString(): string {
    return `${this.scheme}:${this.rawPath}`
  }

  static parse(value: string): Uri {
    const match = value.match(/^(\w+):(.*)$/)
    if (match) return new Uri(match[1], match[2])
    return new Uri('file', value)
  }

  static file(path: string): Uri {
    return new Uri('file', path)
  }
}

export class WorkspaceEdit {
  private readonly _replacements: Array<{ uri: Uri; range: Range; newText: string }> = []

  replace(uri: Uri, range: Range, newText: string): void {
    this._replacements.push({ uri, range, newText })
  }

  get replacements(): Array<{ uri: Uri; range: Range; newText: string }> {
    return this._replacements
  }
}

export class CodeAction {
  edit?: WorkspaceEdit
  isPreferred?: boolean
  diagnostics?: Diagnostic[]
  command?: { title: string; command: string; arguments?: unknown[] }

  constructor(public title: string, public kind?: string) {}
}

export const CodeActionKind = {
  QuickFix: 'quickfix',
  Refactor: 'refactor',
  Source: 'source',
  Empty: '',
} as const

export class CompletionItem {
  detail?: string
  documentation?: unknown
  sortText?: string
  range?: Range
  filterText?: string

  constructor(public label: string, public kind?: number) {}
}

export const CompletionItemKind = {
  Value: 12,
  Module: 9,
  Text: 1,
} as const

export class Hover {
  constructor(public contents: unknown, public range?: Range) {}
}

export class MarkdownString {
  value = ''
  isTrusted = false
  supportHtml = false

  appendMarkdown(text: string): this {
    this.value += text
    return this
  }
}

function createDisposable(): { dispose: jest.Mock } {
  return { dispose: jest.fn() }
}

export const languages = {
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
    name: 'trawl',
  })),
}

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  })),
  onDidOpenTextDocument: jest.fn(() => createDisposable()),
  onDidChangeTextDocument: jest.fn(() => createDisposable()),
  onDidSaveTextDocument: jest.fn(() => createDisposable()),
  onDidCloseTextDocument: jest.fn(() => createDisposable()),
  onDidChangeWorkspaceFolders: jest.fn(() => createDisposable()),
  visibleTextEditors: [] as unknown[],
  findFiles: jest.fn(() => Promise.resolve([])),
  openTextDocument: jest.fn(() => Promise.resolve(null)),
}

export const window = {
  visibleTextEditors: [] as unknown[],
}

export const commands = {
  registerCommand: jest.fn(() => createDisposable()),
  executeCommand: jest.fn(),
}
