jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  setAccountRateLimited: jest.fn(),
  recordUsage: jest.fn()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))

jest.mock('../src/services/accountGroupService', () => ({
  getGroup: jest.fn(),
  getGroupMembers: jest.fn()
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn()
}))

jest.mock('../src/utils/commonHelper', () => ({
  isSchedulable: (v) => v !== false && v !== 'false',
  sortAccountsByPriority: (arr) => arr
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn(),
  getDateStringInTimezone: jest.fn(() => '2026-03-13')
}))

describe('UnifiedOpenAIScheduler quota switch threshold', () => {
  let scheduler
  let redis
  let config
  let originalThreshold

  beforeEach(() => {
    jest.resetModules()
    originalThreshold = process.env.SESSION_QUOTA_SWITCH_THRESHOLD_PERCENT
    process.env.SESSION_QUOTA_SWITCH_THRESHOLD_PERCENT = '85'

    redis = require('../src/models/redis')
    config = require('../config/config')
    scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
  })

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.SESSION_QUOTA_SWITCH_THRESHOLD_PERCENT
    } else {
      process.env.SESSION_QUOTA_SWITCH_THRESHOLD_PERCENT = originalThreshold
    }
    jest.clearAllMocks()
  })

  test('uses 85% threshold when configured', () => {
    expect(config.session.quotaSwitchThresholdPercent).toBe(85)
  })

  test('treats 84% as below threshold and 85% as near limit for OpenAI accounts', async () => {
    const hmget = jest.fn()
    redis.getClientSafe.mockReturnValue({ hmget })

    hmget.mockResolvedValueOnce(['84', null, '3600', null, new Date().toISOString(), 'acc-84'])
    await expect(scheduler._isAccountQuotaNearLimit('acc-84', 'openai')).resolves.toBe(false)

    hmget.mockResolvedValueOnce(['85', null, '3600', null, new Date().toISOString(), 'acc-85'])
    await expect(scheduler._isAccountQuotaNearLimit('acc-85', 'openai')).resolves.toBe(true)
  })
})
