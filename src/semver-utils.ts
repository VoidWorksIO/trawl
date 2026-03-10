/**
 * Semver analysis utilities.
 * Determines what kind of update is available for a dependency.
 */

import * as semver from 'semver'

import { NpmPackageInfo, VersionAnalysis } from './types'

/**
 * Analyze a dependency's version range against the available versions
 * from the npm registry.
 */
export function analyzeVersion(
  versionRange: string,
  packageInfo: NpmPackageInfo
): VersionAnalysis {
  const latest = packageInfo.distTags.latest || ''

  // Clean versions — filter out pre-releases for max-satisfying unless the range itself includes pre-release
  const stableVersions = packageInfo.versions.filter((v) => {
    const parsed = semver.parse(v)
    return parsed && parsed.prerelease.length === 0
  })

  const rangeIncludesPrerelease = /[-]/.test(
    versionRange.replace(/^[~^>=<\s]+/, '')
  )
  const versionsToCheck = rangeIncludesPrerelease
    ? packageInfo.versions
    : stableVersions

  // Find the max version satisfying the current range
  const maxSatisfying = semver.maxSatisfying(versionsToCheck, versionRange)

  // Check if the range already includes the latest
  const isUpToDate = latest ? semver.satisfies(latest, versionRange) : true

  // Determine update type
  const updateType = getUpdateType(maxSatisfying || versionRange.replace(/^[~^>=<\s]+/, ''), latest)

  // Get the publish date of the latest version
  const latestPublishDate = packageInfo.time[latest] || undefined

  return {
    currentRange: versionRange,
    maxSatisfying,
    latest,
    isUpToDate,
    updateType,
    latestPublishDate,
  }
}

/**
 * Determine the type of update between two versions.
 */
function getUpdateType(
  current: string,
  latest: string
): VersionAnalysis['updateType'] {
  const currentParsed = semver.coerce(current)
  const latestParsed = semver.parse(latest)

  if (!currentParsed || !latestParsed) {
    return 'none'
  }

  if (semver.gte(currentParsed, latestParsed)) {
    return 'none'
  }

  if (latestParsed.prerelease.length > 0) {
    return 'prerelease'
  }

  const diff = semver.diff(currentParsed, latestParsed)

  switch (diff) {
  case 'major':
  case 'premajor':
    return 'major'
  case 'minor':
  case 'preminor':
    return 'minor'
  case 'patch':
  case 'prepatch':
    return 'patch'
  case 'prerelease':
    return 'prerelease'
  default:
    return 'none'
  }
}

/**
 * Format a suggested version update string.
 * E.g., if current is "^2.0.0" and latest is "3.1.0", suggest "^3.1.0".
 */
export function suggestVersionUpdate(
  currentRange: string,
  targetVersion: string
): string {
  // Detect the prefix used
  const prefixMatch = currentRange.match(/^([~^>=<]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : '^'

  // For complex ranges (||, -, etc.) just return with caret
  if (/[|]/.test(currentRange) || /\s-\s/.test(currentRange)) {
    return `^${targetVersion}`
  }

  return `${prefix}${targetVersion}`
}
