const redis = require('../../models/redis')

const EMPTY_USAGE = {
  daily: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0, allTokens: 0, cost: 0 },
  total: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0, allTokens: 0, cost: 0 },
  monthly: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0, allTokens: 0, cost: 0 },
  averages: { rpm: 0, tpm: 0, dailyRequests: 0, dailyTokens: 0 }
}

function parseUsage(data = {}) {
  const requests = parseInt(data.totalRequests || data.requests) || 0
  const tokens = parseInt(data.totalTokens || data.tokens) || 0
  const inputTokens = parseInt(data.totalInputTokens || data.inputTokens) || 0
  const outputTokens = parseInt(data.totalOutputTokens || data.outputTokens) || 0
  const cacheCreateTokens = parseInt(data.totalCacheCreateTokens || data.cacheCreateTokens) || 0
  const cacheReadTokens = parseInt(data.totalCacheReadTokens || data.cacheReadTokens) || 0
  const allTokens =
    parseInt(data.totalAllTokens || data.allTokens) ||
    inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

  let cost = 0
  if (Object.prototype.hasOwnProperty.call(data, 'cost')) {
    cost = parseFloat(data.cost) || 0
  } else if (Object.prototype.hasOwnProperty.call(data, 'totalCost')) {
    cost = parseFloat(data.totalCost) || 0
  }

  return {
    requests,
    tokens,
    inputTokens,
    outputTokens,
    cacheCreateTokens,
    cacheReadTokens,
    allTokens,
    cost
  }
}

function buildAverages(account, totalUsage) {
  const createdAt = account?.createdAt ? new Date(account.createdAt) : new Date()
  const now = new Date()
  const daysSinceCreated = Math.max(1, Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24)))
  const totalMinutes = Math.max(1, daysSinceCreated * 24 * 60)
  const totalRequests = totalUsage.requests || 0
  const totalTokens = totalUsage.tokens || 0

  return {
    rpm: Math.round((totalRequests / totalMinutes) * 100) / 100,
    tpm: Math.round((totalTokens / totalMinutes) * 100) / 100,
    dailyRequests: Math.round((totalRequests / daysSinceCreated) * 100) / 100,
    dailyTokens: Math.round((totalTokens / daysSinceCreated) * 100) / 100
  }
}

async function buildAccountUsageMap(accounts) {
  if (!accounts || accounts.length === 0) {
    return new Map()
  }

  const client = redis.getClientSafe()
  const today = redis.getDateStringInTimezone()
  const tzDate = redis.getDateInTimezone()
  const currentMonth = `${tzDate.getUTCFullYear()}-${String(tzDate.getUTCMonth() + 1).padStart(2, '0')}`

  const pipeline = client.pipeline()
  for (const account of accounts) {
    pipeline.hgetall(`account_usage:${account.id}`)
    pipeline.hgetall(`account_usage:daily:${account.id}:${today}`)
    pipeline.hgetall(`account_usage:monthly:${account.id}:${currentMonth}`)
  }

  const results = await pipeline.exec()
  const usageMap = new Map()

  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index]
    const total = results[index * 3]?.[1] || {}
    const daily = results[index * 3 + 1]?.[1] || {}
    const monthly = results[index * 3 + 2]?.[1] || {}

    const totalUsage = parseUsage(total)
    usageMap.set(account.id, {
      total: totalUsage,
      daily: parseUsage(daily),
      monthly: parseUsage(monthly),
      averages: buildAverages(account, totalUsage)
    })
  }

  return usageMap
}

async function buildAccountGroupInfoMap(accountGroupService, accounts, platform) {
  if (!accounts || accounts.length === 0) {
    return new Map()
  }

  return await accountGroupService.batchGetAccountGroupsByIndex(
    accounts.map((account) => account.id),
    platform
  )
}

function filterAccountsByGroupInfos(accounts, groupInfosMap, groupId) {
  if (!groupId || groupId === 'all') {
    return accounts
  }

  return accounts.filter((account) => {
    const groups = groupInfosMap.get(account.id) || []
    if (groupId === 'ungrouped') {
      return groups.length === 0
    }
    return groups.some((group) => group.id === groupId)
  })
}

function getEmptyUsage() {
  return JSON.parse(JSON.stringify(EMPTY_USAGE))
}

module.exports = {
  buildAccountUsageMap,
  buildAccountGroupInfoMap,
  filterAccountsByGroupInfos,
  getEmptyUsage
}
