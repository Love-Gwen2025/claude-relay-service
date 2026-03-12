jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  security: jest.fn()
}))

jest.mock('../src/validators/clientValidator', () => ({
  validateRequest: jest.fn()
}))

const ClientValidator = require('../src/validators/clientValidator')
const {
  normalizeTagList,
  resolveAccessChannel,
  isOfficialClientRequest,
  keyAllowsChannel,
  isGoHttpClientRequest
} = require('../src/middleware/auth')

function createReq(headers = {}) {
  return {
    headers,
    path: '/openai/v1/responses',
    originalUrl: '/openai/v1/responses'
  }
}

describe('access channel auth helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('normalizes tag arrays from JSON strings', () => {
    expect(normalizeTagList('["source:official","source:third_party"]')).toEqual([
      'source:official',
      'source:third_party'
    ])
  })

  test('resolves access channel from request headers', () => {
    expect(resolveAccessChannel(createReq({ 'x-access-channel': 'third_party' }))).toBe(
      'third_party'
    )
    expect(resolveAccessChannel(createReq())).toBe('official')
  })

  test('checks channel permission from tags', () => {
    expect(keyAllowsChannel(['source:official'], 'official')).toBe(true)
    expect(keyAllowsChannel(['source:official'], 'third_party')).toBe(false)
  })

  test('defaults untagged keys to official only', () => {
    expect(keyAllowsChannel([], 'official')).toBe(true)
    expect(keyAllowsChannel([], 'third_party')).toBe(false)
    expect(keyAllowsChannel(['vip'], 'official')).toBe(true)
    expect(keyAllowsChannel(['vip'], 'third_party')).toBe(false)
  })

  test('detects go http client passthrough requests', () => {
    expect(isGoHttpClientRequest(createReq({ 'user-agent': 'Go-http-client/1.1' }))).toBe(true)
    expect(isGoHttpClientRequest(createReq({ 'user-agent': 'node' }))).toBe(false)
  })

  test('treats claude-cli as official directly', () => {
    expect(isOfficialClientRequest(createReq({ 'user-agent': 'claude-cli/1.0.110' }))).toBe(true)
    expect(ClientValidator.validateRequest).not.toHaveBeenCalled()
  })

  test('falls back to client validator for other official clients', () => {
    ClientValidator.validateRequest.mockReturnValue({ allowed: true })

    const req = createReq({
      'user-agent': 'opencode/1.2.24 ai-sdk/provider-utils/3.0.20 runtime/bun/1.3.10'
    })

    expect(isOfficialClientRequest(req)).toBe(true)
    expect(ClientValidator.validateRequest).toHaveBeenCalledWith(
      ['codex_cli', 'codex_app', 'opencode', 'claude_code'],
      req
    )
  })
})
