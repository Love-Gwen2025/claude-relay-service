jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  security: jest.fn()
}))

jest.mock('axios', () => ({
  post: jest.fn()
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: jest.fn((req, _res, next) => next && next())
}))

jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectAccountForApiKey: jest.fn(),
  isAccountRateLimited: jest.fn(),
  removeAccountRateLimit: jest.fn(),
  markAccountRateLimited: jest.fn(),
  markAccountUnauthorized: jest.fn()
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(),
  decrypt: jest.fn(),
  updateCodexUsageSnapshot: jest.fn()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))

jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({
  handleRequest: jest.fn()
}))

jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn(),
  recordUsage: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getUsageStats: jest.fn()
}))

jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(),
  getProxyDescription: jest.fn(() => 'direct')
}))

jest.mock('../src/utils/rateLimitHelper', () => ({
  updateRateLimitCounters: jest.fn()
}))

jest.mock('../src/utils/sseParser', () => ({
  IncrementalSSEParser: jest.fn().mockImplementation(() => ({
    feed: () => [],
    getRemaining: () => ''
  }))
}))

jest.mock('../src/utils/errorSanitizer', () => ({
  getSafeMessage: jest.fn((message) => message)
}))

describe('openaiRoutes rate limit recovery', () => {
  let axios
  let scheduler
  let openaiAccountService
  let apiKeyService
  let handleResponses

  beforeEach(() => {
    jest.resetModules()

    axios = require('axios')
    scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
    openaiAccountService = require('../src/services/account/openaiAccountService')
    apiKeyService = require('../src/services/apiKeyService')
    ;({ handleResponses } = require('../src/routes/openaiRoutes'))

    apiKeyService.hasPermission.mockReturnValue(true)
    scheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'acc-openai-1',
      accountType: 'openai'
    })
    openaiAccountService.getAccount.mockResolvedValue({
      id: 'acc-openai-1',
      name: 'OpenAI Test Account',
      accessToken: 'enc-token',
      accountId: 'chatgpt-account-1'
    })
    openaiAccountService.isTokenExpired.mockReturnValue(false)
    openaiAccountService.decrypt.mockReturnValue('plain-token')
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: {
        model: 'gpt-5.4',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: {
            cached_tokens: 0
          }
        }
      }
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('does not clear rate limit state after a successful non-stream request', async () => {
    const req = {
      apiKey: {
        id: 'key-1',
        name: 'key-1',
        permissions: 'openai'
      },
      headers: {
        'user-agent': 'codex_cli_rs/0.114.0',
        'x-real-ip': '127.0.0.1'
      },
      body: {
        model: 'gpt-5.4',
        stream: false
      },
      originalUrl: '/openai/responses',
      path: '/responses',
      ip: '127.0.0.1'
    }

    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      flushHeaders: jest.fn()
    }

    await handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(scheduler.isAccountRateLimited).not.toHaveBeenCalled()
    expect(scheduler.removeAccountRateLimit).not.toHaveBeenCalled()
  })
})
