jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  security: jest.fn()
}))

const ClientValidator = require('../src/validators/clientValidator')
const { CLIENT_IDS, isPathAllowedForClient } = require('../src/validators/clientDefinitions')

function createReq({ userAgent, path, body = {}, headers = {} }) {
  return {
    path,
    originalUrl: path,
    body,
    headers: {
      'user-agent': userAgent,
      ...headers
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' }
  }
}

describe('Client validators', () => {
  test('validates OpenCode requests by UA and path', () => {
    const req = createReq({
      userAgent: 'opencode/1.2.24 ai-sdk/provider-utils/3.0.20 runtime/bun/1.3.10',
      path: '/openai/v1/chat/completions'
    })

    const result = ClientValidator.validateRequest([CLIENT_IDS.OPENCODE], req)

    expect(result.allowed).toBe(true)
    expect(result.matchedClient).toBe(CLIENT_IDS.OPENCODE)
  })

  test('validates Codex Desktop requests by UA and path', () => {
    const req = createReq({
      userAgent:
        'Codex Desktop/0.115.0-alpha.4 (Mac OS 26.3.1; arm64) unknown (Codex Desktop; 26.309.31024)',
      path: '/openai/v1/responses'
    })

    const result = ClientValidator.validateRequest([CLIENT_IDS.CODEX_APP], req)

    expect(result.allowed).toBe(true)
    expect(result.matchedClient).toBe(CLIENT_IDS.CODEX_APP)
  })

  test('keeps official codex_vscode traffic under codex_cli', () => {
    const req = createReq({
      userAgent:
        'codex_vscode/0.115.0-alpha.4 (Windows 10.0.19045; x86_64) unknown (VS Code; 26.309.31024)',
      path: '/openai/v1/responses',
      headers: {
        originator: 'codex_vscode',
        session_id: 'session_123456789012345678901234567890'
      },
      body: {
        instructions:
          "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.",
        model: 'gpt-5-codex'
      }
    })

    const result = ClientValidator.validateRequest([CLIENT_IDS.CODEX_CLI], req)

    expect(result.allowed).toBe(true)
    expect(result.matchedClient).toBe(CLIENT_IDS.CODEX_CLI)
  })

  test('rejects generic script user agents even on allowed paths', () => {
    const req = createReq({
      userAgent: 'curl/8.0',
      path: '/openai/v1/responses'
    })

    const result = ClientValidator.validateRequest(
      [CLIENT_IDS.CODEX_CLI, CLIENT_IDS.CODEX_APP, CLIENT_IDS.OPENCODE],
      req
    )

    expect(result.allowed).toBe(false)
  })

  test('Go-http-client does not match formal whitelist validators', () => {
    const req = createReq({
      userAgent: 'Go-http-client/1.1',
      path: '/openai/v1/responses'
    })

    const result = ClientValidator.validateRequest(
      [CLIENT_IDS.CODEX_CLI, CLIENT_IDS.CODEX_APP, CLIENT_IDS.OPENCODE],
      req
    )

    expect(result.allowed).toBe(false)
  })

  test('restricts opencode to configured OpenAI-compatible paths', () => {
    expect(isPathAllowedForClient(CLIENT_IDS.OPENCODE, '/openai/v1/chat/completions')).toBe(true)
    expect(isPathAllowedForClient(CLIENT_IDS.OPENCODE, '/openai/v1/responses')).toBe(true)
    expect(isPathAllowedForClient(CLIENT_IDS.OPENCODE, '/claude/v1/messages')).toBe(false)
  })
})
