const axios = require('axios')
const config = require('../../config/config')
const logger = require('./logger')

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
  'host'
])

function shouldUseGateway() {
  return !!config.outboundGateway?.enabled
}

function sanitizeHeaders(headers = {}) {
  const cleaned = {}
  for (const [key, value] of Object.entries(headers || {})) {
    if (!key) {
      continue
    }
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === 'accept-encoding') {
      continue
    }
    cleaned[key] = value
  }
  return cleaned
}

function buildProxyUrl(proxyConfig) {
  if (!proxyConfig) {
    return null
  }

  try {
    const proxy = typeof proxyConfig === 'string' ? JSON.parse(proxyConfig) : proxyConfig
    if (!proxy.type || !proxy.host || !proxy.port) {
      return null
    }

    const auth = proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : ''
    if (proxy.type === 'socks5') {
      return `socks5://${auth}${proxy.host}:${proxy.port}`
    }
    if (proxy.type === 'http' || proxy.type === 'https') {
      return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`
    }
    return null
  } catch (error) {
    logger.debug('Failed to build proxy url for gateway:', error.message)
    return null
  }
}

async function forward(options) {
  if (!shouldUseGateway()) {
    return null
  }

  const {
    targetUrl,
    method = 'POST',
    headers = {},
    data = null,
    responseType = 'json',
    timeout = config.requestTimeout || 600000,
    signal = undefined,
    proxyConfig = null
  } = options || {}

  if (!targetUrl) {
    throw new Error('targetUrl is required for gateway forwarding')
  }

  const gatewayUrl = config.outboundGateway.url || 'http://127.0.0.1:8080/proxy'
  const cleanedHeaders = sanitizeHeaders(headers)
  cleanedHeaders['x-target-url'] = targetUrl

  const forwardProxyHeader = config.outboundGateway.forwardProxyHeader !== false
  const proxyUrl = buildProxyUrl(proxyConfig)
  if (forwardProxyHeader && proxyUrl) {
    cleanedHeaders['x-proxy-url'] = proxyUrl
  }

  const axiosResponse = await axios({
    method,
    url: gatewayUrl,
    headers: cleanedHeaders,
    data,
    responseType,
    timeout,
    signal,
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })

  return {
    status: axiosResponse.status,
    headers: axiosResponse.headers,
    data: axiosResponse.data,
    raw: axiosResponse,
    proxyUrl
  }
}

module.exports = {
  shouldUseGateway,
  sanitizeHeaders,
  buildProxyUrl,
  forward
}
