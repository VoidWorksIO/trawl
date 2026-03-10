/**
 * npm registry client with intelligent caching and background refresh.
 * Uses the npm registry API to fetch package version info.
 */

import * as http from 'http'
import * as https from 'https'

import { version } from '../package.json'

import { NpmPackageInfo, CachedPackageInfo } from './types'
import { HttpStatusCode } from './types'


interface NpmRegistryResponse {
  versions?: Record<string, unknown>;
  'dist-tags'?: Record<string, string>;
  time?: Record<string, string>;
  description?: string;
  homepage?: string;
}


const REGISTRY_URL = 'https://registry.npmjs.org'

const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1_000
const DEFAULT_TTL_MINUTES = 30
const BACKGROUND_REFRESH_THRESHOLD = 0.8
const BACKGROUND_REFRESH_CONCURRENCY = 3
const REQUEST_TIMEOUT_MS = 10_000
const MAX_CACHE_ENTRIES = 500

/** In-memory cache of package info */
const cache = new Map<string, CachedPackageInfo>()

/** Set of packages currently being fetched (dedup inflight requests) */
const inflight = new Map<string, Promise<NpmPackageInfo>>()

/** Default TTL in milliseconds (30 min) */
let cacheTTL = DEFAULT_TTL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND

/**
 * Update the cache TTL (called when config changes) to 5 minutes.
 */
export function setCacheTTL(minutes: number): void {
  cacheTTL = minutes * SECONDS_PER_MINUTE * MS_PER_SECOND
}

/**
 * Clear the entire cache (used by the refresh command).
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Fetch package info from the npm registry.
 * Returns cached data if available and not expired.
 * Deduplicates concurrent requests for the same package.
 */
export async function getPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
  // Check cache first
  const cached = cache.get(packageName)
  if (cached && Date.now() - cached.fetchedAt < cacheTTL) {
    return cached.data
  }

  // If there's an inflight request, wait for it
  const existing = inflight.get(packageName)
  if (existing) {
    return existing
  }

  // Fetch from registry
  const promise = fetchFromRegistry(packageName)
  inflight.set(packageName, promise)

  try {
    const result = await promise
    cache.set(packageName, { data: result, fetchedAt: Date.now() })
    evictIfOverCapacity()
    return result
  }
  catch {
    // If we have stale cache data, return it on error
    if (cached) {
      return cached.data
    }
    return null
  }
  finally {
    inflight.delete(packageName)
  }
}

/**
 * Pre-fetch multiple packages concurrently with a concurrency limit.
 */
export async function prefetchPackages(
  packageNames: string[],
  concurrency: number = 6
): Promise<Map<string, NpmPackageInfo>> {
  const results = new Map<string, NpmPackageInfo>()
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < packageNames.length) {
      const index = nextIndex++
      const name = packageNames[index]
      const info = await getPackageInfo(name)
      if (info) results.set(name, info)
    }
  }

  const workerCount = Math.min(concurrency, packageNames.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Background refresh: re-fetch packages that are near expiration.
 */
export function scheduleBackgroundRefresh(packageNames: string[]): void {
  const nearExpiry = packageNames.filter((name) => {
    const cached = cache.get(name)
    if (!cached) return true
    // Refresh if more than 80% of TTL has elapsed
    return Date.now() - cached.fetchedAt > cacheTTL * BACKGROUND_REFRESH_THRESHOLD
  })

  if (nearExpiry.length > 0) {
    // Fire and forget - don't block the caller
    prefetchPackages(nearExpiry, BACKGROUND_REFRESH_CONCURRENCY).catch(() => {
      // Silently ignore background refresh failures
    })
  }
}

/**
 * Evict the oldest cache entry when the cache exceeds MAX_CACHE_ENTRIES.
 */
function evictIfOverCapacity(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return

  let oldestKey: string | undefined
  let oldestTime = Infinity
  for (const [key, entry] of cache) {
    if (entry.fetchedAt < oldestTime) {
      oldestTime = entry.fetchedAt
      oldestKey = key
    }
  }
  if (oldestKey) cache.delete(oldestKey)
}

/**
 * Fetch raw package data from the npm registry.
 * Uses the abbreviated metadata endpoint with Accept header for smaller payloads,
 * but falls back to full metadata for the `time` field.
 */
function fetchFromRegistry(packageName: string): Promise<NpmPackageInfo> {
  return new Promise((resolve, reject) => {
    const url = `${REGISTRY_URL}/${encodeURIComponent(packageName)}`
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': `trawl-vscode/${version}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res: http.IncomingMessage) => {
        if (res.statusCode === HttpStatusCode.NOT_FOUND) {
          reject(new Error(`Package not found: ${packageName}`))
          return
        }

        if (res.statusCode && res.statusCode >= HttpStatusCode.BAD_REQUEST) {
          reject(new Error(`Registry returned ${res.statusCode} for ${packageName}`))
          return
        }

        let data = ''
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as NpmRegistryResponse
            resolve(parseRegistryResponse(packageName, json))
          }
          catch {
            reject(new Error(`Failed to parse registry response for ${packageName}`))
          }
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Timeout fetching ${packageName}`))
    })
  })
}

/**
 * Parse the raw npm registry JSON into our NpmPackageInfo type.
 */
function parseRegistryResponse(packageName: string, json: NpmRegistryResponse): NpmPackageInfo {
  const versions = json.versions ? Object.keys(json.versions) : []
  const distTags = json['dist-tags'] ?? {}
  const time = json.time ?? {}
  const description = json.description ?? ''
  const homepage = json.homepage ?? ''

  return {
    name: packageName,
    versions,
    distTags,
    time,
    description,
    homepage,
    npmUrl: `https://www.npmjs.com/package/${packageName}`,
  }
}
