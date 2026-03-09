/**
 * OpenAI 性能优化测试
 *
 * 验证 P0/P1 优化：
 * - _computeRateLimitInfo 纯函数（消除 N+1 查询）
 * - isAccountRateLimited 传入 existingAccount 时不查 Redis
 * - _getAllAvailableAccounts 使用批量 tempUnavailable
 */

jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  security: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  client: { hgetall: jest.fn(), hset: jest.fn(), keys: jest.fn(), pipeline: jest.fn() },
  getClient: jest.fn()
}))

jest.mock('../src/utils/commonHelper', () => ({
  createEncryptor: () => ({
    encrypt: (v) => `enc_${v}`,
    decrypt: (v) => v.replace('enc_', ''),
    isEncrypted: (v) => v?.startsWith?.('enc_')
  })
}))

// ────────────────────────────────────────────────────
// P0-1: _computeRateLimitInfo 纯函数测试
// ────────────────────────────────────────────────────
describe('_computeRateLimitInfo', () => {
  let _computeRateLimitInfo

  beforeEach(() => {
    jest.resetModules()
    const service = require('../src/services/account/openaiAccountService')
    _computeRateLimitInfo = service._computeRateLimitInfo
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('normal 状态返回 isRateLimited: false', () => {
    const result = _computeRateLimitInfo({
      rateLimitStatus: 'normal'
    })
    expect(result).toEqual({
      status: 'normal',
      isRateLimited: false,
      rateLimitedAt: null,
      rateLimitResetAt: null,
      minutesRemaining: 0
    })
  })

  test('无 rateLimitStatus 字段默认 normal', () => {
    const result = _computeRateLimitInfo({})
    expect(result.status).toBe('normal')
    expect(result.isRateLimited).toBe(false)
    expect(result.minutesRemaining).toBe(0)
  })

  test('limited + 未过期 resetAt 返回 isRateLimited: true', () => {
    const futureTime = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30分钟后
    const result = _computeRateLimitInfo({
      rateLimitStatus: 'limited',
      rateLimitResetAt: futureTime
    })
    expect(result.status).toBe('limited')
    expect(result.isRateLimited).toBe(true)
    expect(result.minutesRemaining).toBeGreaterThan(0)
    expect(result.minutesRemaining).toBeLessThanOrEqual(30)
  })

  test('limited + 已过期 resetAt 返回 isRateLimited: false', () => {
    const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1小时前
    const result = _computeRateLimitInfo({
      rateLimitStatus: 'limited',
      rateLimitResetAt: pastTime
    })
    expect(result.status).toBe('limited')
    expect(result.isRateLimited).toBe(false)
    expect(result.minutesRemaining).toBe(0)
  })

  test('limited + 仅 rateLimitedAt（无 resetAt）使用默认1小时', () => {
    // 30分钟前被限流 → 还剩约30分钟
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const result = _computeRateLimitInfo({
      rateLimitStatus: 'limited',
      rateLimitedAt: thirtyMinAgo
    })
    expect(result.isRateLimited).toBe(true)
    expect(result.minutesRemaining).toBeGreaterThanOrEqual(29)
    expect(result.minutesRemaining).toBeLessThanOrEqual(31)
  })

  test('limited + rateLimitedAt 超过1小时 → 已恢复', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const result = _computeRateLimitInfo({
      rateLimitStatus: 'limited',
      rateLimitedAt: twoHoursAgo
    })
    expect(result.isRateLimited).toBe(false)
    expect(result.minutesRemaining).toBe(0)
  })

  test('不查 Redis（纯函数验证）', () => {
    const redis = require('../src/models/redis')
    _computeRateLimitInfo({ rateLimitStatus: 'normal' })
    expect(redis.client.hgetall).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────
// P0-2: isAccountRateLimited 传入 existingAccount 测试
// ────────────────────────────────────────────────────
describe('isAccountRateLimited with existingAccount', () => {
  let scheduler
  let openaiAccountService

  beforeEach(() => {
    jest.resetModules()

    // Mock 所有 scheduler 依赖
    jest.mock('../src/services/account/openaiAccountService', () => ({
      getAccount: jest.fn(),
      setAccountRateLimited: jest.fn()
    }))
    jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
      getAccount: jest.fn(),
      getAllAccounts: jest.fn()
    }))
    jest.mock('../src/services/accountGroupService', () => ({
      getGroup: jest.fn(),
      getAllGroups: jest.fn()
    }))
    jest.mock('../src/utils/upstreamErrorHelper', () => ({
      isTempUnavailable: jest.fn(),
      getAllTempUnavailable: jest.fn()
    }))
    jest.mock('../src/utils/commonHelper', () => ({
      isSchedulable: (v) => v !== false && v !== 'false',
      sortAccountsByPriority: (arr) => arr,
      createEncryptor: () => ({
        encrypt: (v) => v,
        decrypt: (v) => v,
        isEncrypted: () => false
      })
    }))

    openaiAccountService = require('../src/services/account/openaiAccountService')
    scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('传入 existingAccount 时不调用 getAccount', async () => {
    const account = {
      id: 'test-123',
      rateLimitStatus: 'normal'
    }

    await scheduler.isAccountRateLimited('test-123', account)

    expect(openaiAccountService.getAccount).not.toHaveBeenCalled()
  })

  test('不传 existingAccount 时调用 getAccount', async () => {
    openaiAccountService.getAccount.mockResolvedValue({
      id: 'test-123',
      rateLimitStatus: 'normal'
    })

    await scheduler.isAccountRateLimited('test-123')

    expect(openaiAccountService.getAccount).toHaveBeenCalledWith('test-123')
  })

  test('existingAccount 有未过期限流返回 true', async () => {
    const futureTime = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const account = {
      id: 'test-123',
      rateLimitStatus: 'limited',
      rateLimitResetAt: futureTime
    }

    const result = await scheduler.isAccountRateLimited('test-123', account)

    expect(result).toBe(true)
    expect(openaiAccountService.getAccount).not.toHaveBeenCalled()
  })
})
