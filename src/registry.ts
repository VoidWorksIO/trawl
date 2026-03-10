/**
 * npm registry client with intelligent caching and background refresh.
 * Uses the npm registry API to fetch package version info.
 */

import * as https from 'https';
import * as http from 'http';
import { NpmPackageInfo, CachedPackageInfo } from './types';

const REGISTRY_URL = 'https://registry.npmjs.org';

/** In-memory cache of package info */
const cache = new Map<string, CachedPackageInfo>();

/** Set of packages currently being fetched (dedup inflight requests) */
const inflight = new Map<string, Promise<NpmPackageInfo>>();

/** Default TTL in milliseconds (30 min) */
let cacheTTL = 30 * 60 * 1000;

/**
 * Update the cache TTL (called when config changes).
 */
export function setCacheTTL(minutes: number): void {
  cacheTTL = minutes * 60 * 1000;
}

/**
 * Clear the entire cache (used by the refresh command).
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Fetch package info from the npm registry.
 * Returns cached data if available and not expired.
 * Deduplicates concurrent requests for the same package.
 */
export async function getPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
  // Check cache first
  const cached = cache.get(packageName);
  if (cached && Date.now() - cached.fetchedAt < cacheTTL) {
    return cached.data;
  }

  // If there's an inflight request, wait for it
  const existing = inflight.get(packageName);
  if (existing) {
    return existing;
  }

  // Fetch from registry
  const promise = fetchFromRegistry(packageName);
  inflight.set(packageName, promise);

  try {
    const result = await promise;
    cache.set(packageName, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    // If we have stale cache data, return it on error
    if (cached) {
      return cached.data;
    }
    return null;
  } finally {
    inflight.delete(packageName);
  }
}

/**
 * Pre-fetch multiple packages concurrently with a concurrency limit.
 */
export async function prefetchPackages(
  packageNames: string[],
  concurrency: number = 6
): Promise<Map<string, NpmPackageInfo>> {
  const results = new Map<string, NpmPackageInfo>();
  const queue = [...packageNames];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const name = queue.shift()!;
      const info = await getPackageInfo(name);
      if (info) {
        results.set(name, info);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

/**
 * Background refresh: re-fetch packages that are near expiration.
 */
export function scheduleBackgroundRefresh(packageNames: string[]): void {
  const nearExpiry = packageNames.filter((name) => {
    const cached = cache.get(name);
    if (!cached) return true;
    // Refresh if more than 80% of TTL has elapsed
    return Date.now() - cached.fetchedAt > cacheTTL * 0.8;
  });

  if (nearExpiry.length > 0) {
    // Fire and forget — don't block the caller
    prefetchPackages(nearExpiry, 3).catch(() => {
      // Silently ignore background refresh failures
    });
  }
}

/**
 * Fetch raw package data from the npm registry.
 * Uses the abbreviated metadata endpoint with Accept header for smaller payloads,
 * but falls back to full metadata for the `time` field.
 */
function fetchFromRegistry(packageName: string): Promise<NpmPackageInfo> {
  return new Promise((resolve, reject) => {
    const url = `${REGISTRY_URL}/${encodeURIComponent(packageName)}`;

    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'trawl-vscode/0.1.0',
        },
        timeout: 10000,
      },
      (res: http.IncomingMessage) => {
        if (res.statusCode === 404) {
          reject(new Error(`Package not found: ${packageName}`));
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Registry returned ${res.statusCode} for ${packageName}`));
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(parseRegistryResponse(packageName, json));
          } catch (err) {
            reject(new Error(`Failed to parse registry response for ${packageName}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${packageName}`));
    });
  });
}

/**
 * Parse the raw npm registry JSON into our NpmPackageInfo type.
 */
function parseRegistryResponse(packageName: string, json: any): NpmPackageInfo {
  const versions = json.versions ? Object.keys(json.versions) : [];
  const distTags = json['dist-tags'] || {};
  const time = json.time || {};
  const description = json.description || '';
  const homepage = json.homepage || '';

  return {
    name: packageName,
    versions,
    distTags,
    time,
    description,
    homepage,
    npmUrl: `https://www.npmjs.com/package/${packageName}`,
  };
}
