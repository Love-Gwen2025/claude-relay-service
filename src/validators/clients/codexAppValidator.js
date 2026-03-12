const logger = require('../../utils/logger')
const { CLIENT_DEFINITIONS } = require('../clientDefinitions')

class CodexAppValidator {
  static getId() {
    return CLIENT_DEFINITIONS.CODEX_APP.id
  }

  static getName() {
    return CLIENT_DEFINITIONS.CODEX_APP.name
  }

  static getDescription() {
    return CLIENT_DEFINITIONS.CODEX_APP.description
  }

  static validate(req) {
    try {
      const userAgent = req.headers['user-agent'] || ''
      const codexAppPattern = /^Codex Desktop\/[\w.-]+/i
      const hasDesktopSignature = userAgent.includes('(Codex Desktop;')

      if (!codexAppPattern.test(userAgent) || !hasDesktopSignature) {
        logger.debug(`Codex App validation failed - UA mismatch: ${userAgent}`)
        return false
      }

      logger.debug(`Codex App validation passed for UA: ${userAgent}`)
      return true
    } catch (error) {
      logger.error('Error in CodexAppValidator:', error)
      return false
    }
  }

  static getInfo() {
    return {
      id: this.getId(),
      name: this.getName(),
      description: this.getDescription(),
      icon: CLIENT_DEFINITIONS.CODEX_APP.icon
    }
  }
}

module.exports = CodexAppValidator
