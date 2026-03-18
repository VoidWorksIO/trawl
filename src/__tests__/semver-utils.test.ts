import { analyzeVersion, suggestVersionUpdate } from '../semver-utils'
import { NpmPackageInfo } from '../types'


function makePackageInfo(versions: string[], latest: string, time: Record<string, string> = {}): NpmPackageInfo {
  return {
    name: 'test-pkg',
    versions,
    distTags: { latest },
    time,
    npmUrl: 'https://www.npmjs.com/package/test-pkg',
  }
}

describe('analyzeVersion', () => {
  it('returns updateType none when current range satisfies latest', () => {
    const info = makePackageInfo(['1.0.0', '1.2.0'], '1.2.0')
    const result = analyzeVersion('^1.0.0', info)
    expect(result.updateType).toBe('none')
    expect(result.isUpToDate).toBe(true)
  })

  it('returns major for a major version bump', () => {
    const info = makePackageInfo(['1.0.0', '2.0.0'], '2.0.0')
    const result = analyzeVersion('^1.0.0', info)
    expect(result.updateType).toBe('major')
    expect(result.isUpToDate).toBe(false)
  })

  it('returns minor for a minor version bump', () => {
    // ~ (patch-only) range does not satisfy a newer minor version
    const info = makePackageInfo(['1.0.0', '1.1.0'], '1.1.0')
    const result = analyzeVersion('~1.0.0', info)
    expect(result.updateType).toBe('minor')
  })

  it('returns patch for a patch version bump', () => {
    // exact version range does not satisfy any other version
    const info = makePackageInfo(['1.0.0', '1.0.1'], '1.0.1')
    const result = analyzeVersion('1.0.0', info)
    expect(result.updateType).toBe('patch')
  })

  it('returns prerelease when latest is a prerelease version', () => {
    const info = makePackageInfo(['1.0.0', '1.1.0-alpha.1'], '1.1.0-alpha.1')
    const result = analyzeVersion('1.0.0', info)
    expect(result.updateType).toBe('prerelease')
  })

  it('maxSatisfying filters out prereleases when range does not include prerelease', () => {
    const info = makePackageInfo(['1.0.0', '1.1.0', '1.2.0-beta.1'], '1.1.0')
    const result = analyzeVersion('^1.0.0', info)
    expect(result.maxSatisfying).toBe('1.1.0')
  })

  it('maxSatisfying includes prereleases when range specifies a prerelease', () => {
    // ^1.2.0-0 allows all prereleases of 1.2.x since 'beta' > '0' in prerelease comparison
    const info = makePackageInfo(['1.0.0', '1.1.0', '1.2.0-beta.1'], '1.1.0')
    const result = analyzeVersion('^1.2.0-0', info)
    expect(result.maxSatisfying).toBe('1.2.0-beta.1')
  })

  it('handles missing latest gracefully', () => {
    const info: NpmPackageInfo = {
      name: 'test-pkg',
      versions: ['1.0.0'],
      distTags: {},
      time: {},
      npmUrl: 'https://www.npmjs.com/package/test-pkg',
    }
    const result = analyzeVersion('^1.0.0', info)
    expect(result.updateType).toBe('none')
    expect(result.isUpToDate).toBe(true)
  })

  it('includes latestPublishDate from time map', () => {
    const publishDate = '2024-01-15T00:00:00.000Z'
    const info = makePackageInfo(['1.0.0', '2.0.0'], '2.0.0', { '2.0.0': publishDate })
    const result = analyzeVersion('1.0.0', info)
    expect(result.latestPublishDate).toBe(publishDate)
  })

  it('sets maxSatisfying to null when no versions satisfy the range', () => {
    const info = makePackageInfo(['2.0.0', '3.0.0'], '3.0.0')
    const result = analyzeVersion('^1.0.0', info)
    expect(result.maxSatisfying).toBeNull()
  })
})

describe('suggestVersionUpdate', () => {
  it('preserves ^ prefix', () => {
    expect(suggestVersionUpdate('^1.0.0', '2.0.0')).toBe('^2.0.0')
  })

  it('preserves ~ prefix', () => {
    expect(suggestVersionUpdate('~1.0.0', '2.0.0')).toBe('~2.0.0')
  })

  it('preserves >= prefix', () => {
    expect(suggestVersionUpdate('>=1.0.0', '2.0.0')).toBe('>=2.0.0')
  })

  it('defaults to ^ when no prefix is present', () => {
    expect(suggestVersionUpdate('1.0.0', '2.0.0')).toBe('^2.0.0')
  })

  it('uses ^ for complex || ranges', () => {
    expect(suggestVersionUpdate('^1.0.0 || ^2.0.0', '3.0.0')).toBe('^3.0.0')
  })

  it('uses ^ for hyphen ranges', () => {
    expect(suggestVersionUpdate('1.0.0 - 2.0.0', '3.0.0')).toBe('^3.0.0')
  })

  it('returns caret version when target has no prefix range', () => {
    expect(suggestVersionUpdate('1.2.3', '1.2.4')).toBe('^1.2.4')
  })
})
