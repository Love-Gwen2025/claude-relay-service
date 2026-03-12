const logger = require('../../utils/logger')
const { CLIENT_DEFINITIONS } = require('../clientDefinitions')

class OpencodeValidator {
  static getId() {
    return CLIENT_DEFINITIONS.OPENCODE.id
  }

  static getName() {
    return CLIENT_DEFINITIONS.OPENCODE.name
  }

  static getDescription() {
    return CLIENT_DEFINITIONS.OPENCODE.description
  }

  static validate(req) {
    try {
      const userAgent = req.headers['user-agent'] || ''
      const opencodePattern = /^opencode\/[\d.]+/i
      const hasSdkMarker =
        userAgent.includes('ai-sdk/provider-utils/') || userAgent.includes('runtime/')

      if (!opencodePattern.test(userAgent) || !hasSdkMarker) {
        logger.debug(`OpenCode validation failed - UA mismatch: ${userAgent}`)
        return false
      }

      logger.debug(`OpenCode validation passed for UA: ${userAgent}`)
      return true
    } catch (error) {
      logger.error('Error in OpencodeValidator:', error)
      return false
    }
  }

  static getInfo() {
    return {
      id: this.getId(),
      name: this.getName(),
      description: this.getDescription(),
      icon: CLIENT_DEFINITIONS.OPENCODE.icon
    }
  }
}

module.exports = OpencodeValidator
