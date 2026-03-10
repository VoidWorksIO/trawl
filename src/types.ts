/**
 * Types used across the extension.
 */

import type * as vscode from 'vscode'


export interface DependencyInfo {
  /** The package name */
  name: string;
  /** The version range string from package.json (e.g., "^2.0.0") */
  versionRange: string;
  /** Which dependency group this belongs to */
  group: DependencyGroup;
  /** Line number in the document (0-based) */
  line: number;
  /** Start character of the version string value (inside quotes) */
  versionStartChar: number;
  /** End character of the version string value (inside quotes) */
  versionEndChar: number;
  /** Start character of the package name key (inside quotes) */
  nameStartChar: number;
  /** End character of the package name key (inside quotes) */
  nameEndChar: number;
}

export type DependencyGroup =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export const DEPENDENCY_GROUPS: DependencyGroup[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

export interface NpmPackageInfo {
  /** The package name */
  name: string;
  /** All available versions */
  versions: string[];
  /** dist-tags (e.g., latest, next) */
  distTags: Record<string, string>;
  /** Publish timestamps per version */
  time: Record<string, string>;
  /** Description of the package */
  description?: string;
  /** Homepage URL */
  homepage?: string;
  /** npm page URL */
  npmUrl: string;
}

export interface CachedPackageInfo {
  data: NpmPackageInfo;
  fetchedAt: number;
}

export interface VersionAnalysis {
  /** The current range from package.json */
  currentRange: string;
  /** The highest version satisfying the current range */
  maxSatisfying: string | null;
  /** The absolute latest version (from dist-tags.latest) */
  latest: string;
  /** Whether the current range already covers the latest */
  isUpToDate: boolean;
  /** What type of update is available */
  updateType: 'major' | 'minor' | 'patch' | 'prerelease' | 'none';
  /** Last publish date of the latest version */
  latestPublishDate?: string;
}

export interface TrawlDiagnostic extends vscode.Diagnostic {
  _depName: string
  _suggestedVersion: string | undefined
  _latestVersion: string
  _maxSatisfying: string | undefined
}

const HttpStatusCode = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
}


export { HttpStatusCode }
