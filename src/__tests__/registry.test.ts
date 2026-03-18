import * as http from 'http'
import * as https from 'https'

import { getPackageInfo, clearCache, setCacheTTL, prefetchPackages, scheduleBackgroundRefresh } from '../registry'


jest.mock('https')

const HTTP_STATUS_OK = 200
const HTTP_STATUS_NOT_FOUND = 404
const DEFAULT_TTL_MINUTES = 30
const MS_PER_SECOND = 1000
const LRU_MAX_ENTRIES = 500

const MOCK_REGISTRY_RESPONSE = {
  versions: { '1.0.0': {}, '1.1.0': {}, '2.0.0': {} },
  'dist-tags': { latest: '2.0.0' },
  time: { '1.0.0': '2020-01-01T00:00:00.000Z', '2.0.0': '2023-06-15T00:00:00.000Z' },
  description: 'A test package',
  homepage: 'https://example.com',
}

function makeMockResponse(statusCode: number, body: string): http.IncomingMessage {
  return {
    statusCode,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'data') handler(Buffer.from(body))
      if (event === 'end') handler()
    }),
  } as unknown as http.IncomingMessage
}

function makeMockRequest(options: { timeout?: boolean; networkError?: Error } = {}): { on: jest.Mock; destroy: jest.Mock } {
  return {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (options.timeout && event === 'timeout') handler()
      if (options.networkError && event === 'error') handler(options.networkError)
    }),
    destroy: jest.fn(),
  }
}

function setupSuccessfulFetch(body = JSON.stringify(MOCK_REGISTRY_RESPONSE)): void {
  const mockResponse = makeMockResponse(HTTP_STATUS_OK, body)
  const mockRequest = makeMockRequest()
  ;(https.get as jest.Mock).mockImplementation(
    (_url: string, _options: unknown, callback: (res: http.IncomingMessage) => void) => {
      callback(mockResponse)
      return mockRequest
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  clearCache()
  setCacheTTL(DEFAULT_TTL_MINUTES)
})

describe('getPackageInfo', () => {
  it('returns parsed NpmPackageInfo on successful fetch', async () => {
    setupSuccessfulFetch()
    const result = await getPackageInfo('test-pkg')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('test-pkg')
    expect(result?.versions).toEqual(['1.0.0', '1.1.0', '2.0.0'])
    expect(result?.distTags.latest).toBe('2.0.0')
    expect(result?.description).toBe('A test package')
    expect(result?.homepage).toBe('https://example.com')
    expect(result?.npmUrl).toBe('https://www.npmjs.com/package/test-pkg')
  })

  it('returns null when npm returns 404', async () => {
    const mockResponse = makeMockResponse(HTTP_STATUS_NOT_FOUND, 'Not Found')
    const mockRequest = makeMockRequest()
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, callback: (res: http.IncomingMessage) => void) => {
        callback(mockResponse)
        return mockRequest
      }
    )
    const result = await getPackageInfo('nonexistent-pkg')
    expect(result).toBeNull()
  })

  it('returns null on network error with no cached entry', async () => {
    const mockRequest = makeMockRequest({ networkError: new Error('ECONNREFUSED') })
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, _callback: unknown) => {
        return mockRequest
      }
    )
    const result = await getPackageInfo('test-pkg')
    expect(result).toBeNull()
  })

  it('returns stale cached entry when network error occurs', async () => {
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')

    const originalDateNow = Date.now
    const expiredOffset = (DEFAULT_TTL_MINUTES + 1) * 60 * MS_PER_SECOND
    Date.now = jest.fn(() => originalDateNow() + expiredOffset)

    try {
      const mockRequest = makeMockRequest({ networkError: new Error('ECONNREFUSED') })
      ;(https.get as jest.Mock).mockImplementation(
        (_url: string, _options: unknown, _callback: unknown) => {
          return mockRequest
        }
      )

      const result = await getPackageInfo('test-pkg')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('test-pkg')
    } finally {
      Date.now = originalDateNow
    }
  })

  it('does not issue duplicate HTTP requests for inflight packages', async () => {
    setupSuccessfulFetch()

    const promise1 = getPackageInfo('test-pkg')
    const promise2 = getPackageInfo('test-pkg')

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(https.get).toHaveBeenCalledTimes(1)
    expect(result1).toEqual(result2)
  })

  it('returns cached result within TTL without re-fetching', async () => {
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')
    await getPackageInfo('test-pkg')
    expect(https.get).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when cache is expired', async () => {
    setCacheTTL(0)
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')
    await getPackageInfo('test-pkg')
    expect(https.get).toHaveBeenCalledTimes(2)
  })

  it('handles malformed JSON in response body', async () => {
    const mockResponse = makeMockResponse(HTTP_STATUS_OK, 'this is not json {{{')
    const mockRequest = makeMockRequest()
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, callback: (res: http.IncomingMessage) => void) => {
        callback(mockResponse)
        return mockRequest
      }
    )
    const result = await getPackageInfo('test-pkg')
    expect(result).toBeNull()
  })

  it('handles request timeout by rejecting', async () => {
    const mockRequest = makeMockRequest({ timeout: true })
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, _callback: unknown) => {
        return mockRequest
      }
    )
    const result = await getPackageInfo('test-pkg')
    expect(result).toBeNull()
    expect(mockRequest.destroy).toHaveBeenCalled()
  })

  it('handles chunked HTTP responses across multiple data events', async () => {
    const fullBody = JSON.stringify(MOCK_REGISTRY_RESPONSE)
    const midpoint = Math.floor(fullBody.length / 2)
    const chunk1 = fullBody.slice(0, midpoint)
    const chunk2 = fullBody.slice(midpoint)

    const mockChunkedResponse: http.IncomingMessage = {
      statusCode: HTTP_STATUS_OK,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'data') {
          handler(Buffer.from(chunk1))
          handler(Buffer.from(chunk2))
        }
        if (event === 'end') handler()
      }),
    } as unknown as http.IncomingMessage
    const mockRequest = makeMockRequest()
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, callback: (res: unknown) => void) => {
        callback(mockChunkedResponse)
        return mockRequest
      }
    )

    const result = await getPackageInfo('test-pkg')
    expect(result).not.toBeNull()
    expect(result?.versions).toEqual(['1.0.0', '1.1.0', '2.0.0'])
  })
})

describe('clearCache', () => {
  it('removes all cached entries', async () => {
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')

    clearCache()

    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')
    expect(https.get).toHaveBeenCalledTimes(2)
  })
})

describe('setCacheTTL', () => {
  it('changes the effective cache TTL', async () => {
    setCacheTTL(0)
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')
    await getPackageInfo('test-pkg')
    expect(https.get).toHaveBeenCalledTimes(2)
  })
})

describe('prefetchPackages', () => {
  it('fetches multiple packages and returns a map of results', async () => {
    setupSuccessfulFetch()
    const results = await prefetchPackages(['pkg-a', 'pkg-b', 'pkg-c'])
    expect(results.size).toBe(3)
    expect(results.has('pkg-a')).toBe(true)
    expect(results.has('pkg-b')).toBe(true)
    expect(results.has('pkg-c')).toBe(true)
  })

  it('omits packages that fail to fetch', async () => {
    const mockRequest = makeMockRequest({ networkError: new Error('ECONNREFUSED') })
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, _callback: unknown) => {
        return mockRequest
      }
    )
    const results = await prefetchPackages(['failing-pkg'])
    expect(results.size).toBe(0)
  })

  it('fetches all packages up to the concurrency limit', async () => {
    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, callback: (res: unknown) => void) => {
        const body = JSON.stringify(MOCK_REGISTRY_RESPONSE)
        const concurrencyResponse: http.IncomingMessage = {
          statusCode: HTTP_STATUS_OK,
          on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') handler(Buffer.from(body))
            if (event === 'end') handler()
          }),
        } as unknown as http.IncomingMessage
        callback(concurrencyResponse)
        return makeMockRequest()
      }
    )

    const packages = ['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3', 'pkg-4']
    await prefetchPackages(packages, 2)
    expect(https.get).toHaveBeenCalledTimes(5)
  })
})

describe('scheduleBackgroundRefresh', () => {
  it('does not throw when called', () => {
    expect(() => {
      scheduleBackgroundRefresh(['test-pkg'])
    }).not.toThrow()
  })

  it('triggers re-fetch for packages past the 80% TTL threshold', async () => {
    setupSuccessfulFetch()
    await getPackageInfo('test-pkg')

    // Advance past full TTL so both scheduleBackgroundRefresh identifies the package
    // as near-expiry AND getPackageInfo treats the cache as expired.
    const originalDateNow = Date.now
    const fetchTime = Date.now()
    const pastTtlOffset = DEFAULT_TTL_MINUTES * 60 * MS_PER_SECOND + 1
    Date.now = jest.fn(() => fetchTime + pastTtlOffset)

    jest.clearAllMocks()
    setupSuccessfulFetch()
    scheduleBackgroundRefresh(['test-pkg'])

    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })

    expect(https.get).toHaveBeenCalled()
    Date.now = originalDateNow
  })
})

describe('LRU eviction', () => {
  it('evicts the oldest entry when cache exceeds 500 entries', async () => {
    const body = JSON.stringify(MOCK_REGISTRY_RESPONSE)
    let fetchTime = 1000
    const originalDateNow = Date.now
    Date.now = jest.fn(() => fetchTime++)

    ;(https.get as jest.Mock).mockImplementation(
      (_url: string, _options: unknown, callback: (res: unknown) => void) => {
        const lruResponse: http.IncomingMessage = {
          statusCode: HTTP_STATUS_OK,
          on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') handler(Buffer.from(body))
            if (event === 'end') handler()
          }),
        } as unknown as http.IncomingMessage
        callback(lruResponse)
        return makeMockRequest()
      }
    )

    // Fill cache with LRU_MAX_ENTRIES packages; pkg-0 gets the smallest fetchedAt
    await Promise.all(
      Array.from({ length: LRU_MAX_ENTRIES }, (_, i) => getPackageInfo(`pkg-${i}`))
    )

    expect(https.get).toHaveBeenCalledTimes(LRU_MAX_ENTRIES)

    // 501st fetch triggers eviction of pkg-0 (smallest fetchedAt)
    await getPackageInfo('pkg-500')

    // pkg-0 should have been evicted — re-fetching causes a new HTTP request
    await getPackageInfo('pkg-0')
    expect(https.get).toHaveBeenCalledTimes(LRU_MAX_ENTRIES + 2)

    Date.now = originalDateNow
  })
})
