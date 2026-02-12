import { loadConfig } from './plugin/config'
import { exec } from 'node:child_process'
import { AccountManager, generateAccountId } from './plugin/accounts'
import { accessTokenExpired } from './plugin/token'
import { refreshAccessToken } from './plugin/token'
import { authorizeIFlowOAuth, exchangeOAuthCode } from './iflow/oauth'
import { validateApiKey } from './iflow/apikey'
import { getModels } from './iflow/models'
import { startOAuthServer } from './plugin/server'
import { IFlowTokenRefreshError } from './plugin/errors'
import {
  promptAddAnotherAccount,
  promptLoginMode,
  promptAuthMethod,
  promptApiKey,
  promptEmail,
  promptOAuthCallback
} from './plugin/cli'
import type { ManagedAccount } from './plugin/types'
import type { IFlowOAuthTokenResult } from './iflow/oauth'
import { IFLOW_CONSTANTS, applyThinkingConfig, SUPPORTED_MODELS } from './constants'
import * as logger from './plugin/logger'

export const IFLOW_PROVIDER_ID = 'iflow'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isNetworkError = (e: any) =>
  e instanceof Error && /econnreset|etimedout|enotfound|network|fetch failed/i.test(e.message)

const openBrowser = (url: string) => {
  const escapedUrl = url.replace(/"/g, '\\"')
  const platform = process.platform
  const command =
    platform === 'win32'
      ? `cmd /c start "" "${escapedUrl}"`
      : platform === 'darwin'
        ? `open "${escapedUrl}"`
        : `xdg-open "${escapedUrl}"`

  exec(command, (error) => {
    if (error) logger.warn(`Failed to open browser automatically: ${error.message}`, error)
  })
}

/**
 * Detect if running in headless environment (SSH, container, CI, etc.)
 */
function isHeadlessEnvironment(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.OPENCODE_HEADLESS ||
    process.env.CI ||
    process.env.CONTAINER ||
    (!process.env.DISPLAY && process.platform !== 'darwin' && process.platform !== 'win32')
  )
}

/**
 * Parse OAuth callback input - can be full URL or just the code
 */
function parseOAuthCallbackInput(input: string): { code?: string; state?: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return {}
  }

  // If it's a URL, extract code and state from query params
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return {
        code: url.searchParams.get('code') || undefined,
        state: url.searchParams.get('state') || undefined,
      }
    } catch {
      return {}
    }
  }

  // If it looks like query params (code=...&state=...)
  const candidate = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  if (candidate.includes('=')) {
    const params = new URLSearchParams(candidate)
    const code = params.get('code') || undefined
    const state = params.get('state') || undefined
    if (code || state) {
      return { code, state }
    }
  }

  // Assume it's just the code
  return { code: trimmed }
}

/**
 * Default model configurations for iFlow
 */
const DEFAULT_MODELS: Record<string, any> = {
  'iflow-rome-30ba3b': {
    name: 'iFlow ROME 30B',
    limit: { context: 256000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'qwen3-coder-plus': {
    name: 'Qwen3 Coder Plus',
    limit: { context: 1000000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'qwen3-max': {
    name: 'Qwen3 Max',
    limit: { context: 256000, output: 32000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'qwen3-vl-plus': {
    name: 'Qwen3 VL Plus',
    limit: { context: 256000, output: 32000 },
    modalities: { input: ['text', 'image'], output: ['text'] }
  },
  'qwen3-235b-a22b-thinking-2507': {
    name: 'Qwen3 235B Thinking',
    limit: { context: 256000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'kimi-k2': {
    name: 'Kimi K2',
    limit: { context: 128000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'kimi-k2-0905': {
    name: 'Kimi K2 0905',
    limit: { context: 256000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'glm-4.6': {
    name: 'GLM-4.6 Thinking',
    limit: { context: 200000, output: 128000 },
    modalities: { input: ['text', 'image'], output: ['text'] },
    variants: {
      low: { thinkingConfig: { thinkingBudget: 1024 } },
      medium: { thinkingConfig: { thinkingBudget: 8192 } },
      max: { thinkingConfig: { thinkingBudget: 32768 } }
    }
  },
  'deepseek-v3': {
    name: 'DeepSeek V3',
    limit: { context: 128000, output: 32000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'deepseek-v3.2': {
    name: 'DeepSeek V3.2',
    limit: { context: 128000, output: 64000 },
    modalities: { input: ['text'], output: ['text'] }
  },
  'deepseek-r1': {
    name: 'DeepSeek R1',
    limit: { context: 128000, output: 32000 },
    modalities: { input: ['text'], output: ['text'] },
    variants: {
      low: { thinkingConfig: { thinkingBudget: 1024 } },
      medium: { thinkingConfig: { thinkingBudget: 8192 } },
      max: { thinkingConfig: { thinkingBudget: 32768 } }
    }
  },
  'qwen3-32b': {
    name: 'Qwen3 32B',
    limit: { context: 128000, output: 32000 },
    modalities: { input: ['text'], output: ['text'] }
  }
}

export const createIFlowPlugin =
  (id: string) =>
  async ({ client, directory }: any) => {
    const config = loadConfig()
    const showToast = (message: string, variant: 'info' | 'warning' | 'success' | 'error') => {
      client.tui.showToast({ body: { message, variant } }).catch(() => {})
    }

    return {
      config: async (config: any) => {
        // Register iflow provider with models
        config.provider = config.provider || {}
        config.provider[id] = config.provider[id] || {}
        
        // Try to fetch models from API
        let fetchedModels: Record<string, any> = {}
        try {
          const am = await AccountManager.loadFromDisk(config.account_selection_strategy)
          const accounts = am.getAccounts()
          
          if (accounts.length > 0) {
            // Use first available account to fetch models
            const firstAccount = accounts[0]
            if (firstAccount) {
              const authType: 'oauth' | 'apikey' = firstAccount.authMethod === 'oauth' ? 'oauth' : 'apikey'
              const token = firstAccount.authMethod === 'oauth' 
                ? firstAccount.accessToken 
                : firstAccount.apiKey
                
              if (token) {
                logger.log('Fetching models from iFlow API...')
                fetchedModels = await getModels(token, authType)
                logger.log(`Fetched ${Object.keys(fetchedModels).length} models from API`)
              }
            }
          }
        } catch (error: any) {
          logger.warn(`Failed to fetch models from API: ${error.message}`)
        }
        
        // Merge: fetched models > default models > existing config
        config.provider[id].models = {
          ...DEFAULT_MODELS,
          ...fetchedModels,
          ...(config.provider[id].models || {})
        }
      },
      auth: {
        provider: id,
        loader: async (getAuth: any, provider: any) => {
          await getAuth()
          const am = await AccountManager.loadFromDisk(config.account_selection_strategy)

          // Auto-configure models if not already configured
          const configuredModels = provider?.models || {}
          const mergedModels = { ...DEFAULT_MODELS, ...configuredModels }

          return {
            apiKey: '',
            baseURL: IFLOW_CONSTANTS.BASE_URL,
            models: mergedModels,
            async fetch(input: any, init?: any): Promise<Response> {
              const url = typeof input === 'string' ? input : input.url

              let retry = 0
              let iterations = 0
              const startTime = Date.now()
              const maxIterations = config.max_request_iterations
              const timeoutMs = config.request_timeout_ms

              while (true) {
                iterations++
                const elapsed = Date.now() - startTime

                if (iterations > maxIterations) {
                  throw new Error(
                    `Request exceeded max iterations (${maxIterations}). All accounts may be unhealthy or rate-limited.`
                  )
                }

                if (elapsed > timeoutMs) {
                  throw new Error(
                    `Request timeout after ${Math.ceil(elapsed / 1000)}s. Max timeout: ${Math.ceil(timeoutMs / 1000)}s.`
                  )
                }

                const count = am.getAccountCount()
                if (count === 0) throw new Error('No accounts. Login first.')
                const acc = am.getCurrentOrNext()

                if (!acc) {
                  const minWait = am.getMinWaitTime()
                  if (minWait > 0) {
                    showToast(
                      `All accounts rate-limited. Waiting ${Math.ceil(minWait / 1000)}s...`,
                      'warning'
                    )
                    await sleep(Math.min(minWait, 5000))
                    continue
                  }
                  throw new Error('No healthy accounts available')
                }

                if (count > 1 && am.shouldShowToast()) {
                  showToast(
                    `Using ${acc.email} (${am.getAccounts().indexOf(acc) + 1}/${count})`,
                    'info'
                  )
                }

                if (
                  acc.authMethod === 'oauth' &&
                  acc.expiresAt &&
                  accessTokenExpired(acc.expiresAt)
                ) {
                  try {
                    const authDetails = am.toAuthDetails(acc)
                    const refreshed = await refreshAccessToken(authDetails)
                    am.updateFromAuth(acc, refreshed)
                    await am.saveToDisk()
                  } catch (error: any) {
                    logger.error(`Token refresh failed for account ${acc.id}`, error)
                    am.markUnhealthy(acc, 'Token refresh failed', Date.now() + 300000)
                    continue
                  }
                }

                const body = init?.body ? JSON.parse(init.body) : {}
                const model = body.model || 'qwen3-max'
                let processedBody = applyThinkingConfig(body, model)

                if (processedBody.stream === false && processedBody.stream_options) {
                  const { stream_options, ...rest } = processedBody
                  processedBody = rest
                }

                const apiTimestamp = config.enable_log_api_request ? logger.getTimestamp() : null

                const incomingHeaders = init?.headers || {}
                const cleanedHeaders: Record<string, string> = {}
                for (const [key, value] of Object.entries(incomingHeaders)) {
                  const lowerKey = key.toLowerCase()
                  if (
                    lowerKey !== 'authorization' &&
                    lowerKey !== 'user-agent' &&
                    lowerKey !== 'content-type'
                  ) {
                    cleanedHeaders[key] = value as string
                  }
                }

                const headers = {
                  Authorization: `Bearer ${acc.apiKey}`,
                  'User-Agent': IFLOW_CONSTANTS.USER_AGENT,
                  'Content-Type': 'application/json',
                  ...cleanedHeaders
                }

                if (apiTimestamp) {
                  const sanitizedHeaders = {
                    ...headers,
                    Authorization: `Bearer ${acc.apiKey.substring(0, 10)}...`
                  }
                  const requestData = {
                    url: typeof input === 'string' ? input : input.url,
                    method: init?.method || 'POST',
                    headers: sanitizedHeaders,
                    body: processedBody,
                    account: acc.email
                  }
                  logger.logApiRequest(requestData, apiTimestamp)
                }

                try {
                  const response = await fetch(input, {
                    ...init,
                    headers,
                    body: JSON.stringify(processedBody),
                    method: init?.method || 'POST'
                  })

                  if (response.ok) {
                    if (apiTimestamp) {
                      const responseData = {
                        status: response.status,
                        statusText: response.statusText,
                        headers: {}
                      }
                      logger.logApiResponse(responseData, apiTimestamp)
                    }
                    return response
                  }

                  const errorText = await response.text().catch(() => '')
                  const responseData = {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorText,
                    account: acc.email
                  }

                  const sanitizedHeaders = {
                    ...headers,
                    Authorization: `Bearer ${acc.apiKey.substring(0, 10)}...`
                  }

                  const requestData = {
                    url: typeof input === 'string' ? input : input.url,
                    method: init?.method || 'POST',
                    headers: sanitizedHeaders,
                    body: processedBody,
                    account: acc.email
                  }

                  if (config.enable_log_api_request && apiTimestamp) {
                    logger.logApiResponse(responseData, apiTimestamp)
                  } else {
                    const errorTimestamp = logger.getTimestamp()
                    logger.logApiError(requestData, responseData, errorTimestamp)
                  }

                  if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10)
                    logger.warn(`Rate limited on account ${acc.email}, retry after ${retryAfter}s`)
                    am.markRateLimited(acc, retryAfter * 1000)
                    await sleep(1000)
                    continue
                  }

                  if (response.status === 401 || response.status === 403) {
                    logger.warn(`Authentication failed for ${acc.email}: ${response.status}`)
                    am.markUnhealthy(acc, 'Authentication failed', Date.now() + 300000)
                    continue
                  }

                  if (response.status >= 500) {
                    if (retry < 3) {
                      retry++
                      logger.warn(`Server error ${response.status}, retry ${retry}/3`)
                      await sleep(1000 * Math.pow(2, retry))
                      continue
                    }
                    logger.error(`Server error ${response.status} after ${retry} retries`)
                    am.markUnhealthy(acc, 'Server error', Date.now() + 300000)
                    continue
                  }

                  throw new Error(`iFlow Error: ${response.status} - ${errorText}`)
                } catch (error: any) {
                  if (isNetworkError(error) && retry < 3) {
                    retry++
                    logger.warn(`Network error, retry ${retry}/3: ${error.message}`)
                    await sleep(1000 * Math.pow(2, retry))
                    continue
                  }

                  const sanitizedHeaders = {
                    ...headers,
                    Authorization: `Bearer ${acc.apiKey.substring(0, 10)}...`
                  }
                  const requestData = {
                    url: typeof input === 'string' ? input : input.url,
                    method: init?.method || 'POST',
                    headers: sanitizedHeaders,
                    body: processedBody,
                    account: acc.email
                  }
                  const networkErrorData = {
                    status: 0,
                    statusText: 'Network Error',
                    body: error.message,
                    account: acc.email
                  }

                  if (config.enable_log_api_request && apiTimestamp) {
                    logger.logApiResponse(networkErrorData, apiTimestamp)
                  } else {
                    const errorTimestamp = logger.getTimestamp()
                    logger.logApiError(requestData, networkErrorData, errorTimestamp)
                  }

                  logger.error(`Request failed after ${retry} retries: ${error.message}`, error)
                  throw error
                }
              }
            }
          }
        },
        methods: [
          {
            id: 'oauth',
            label: 'iFlow OAuth 2.0',
            type: 'oauth' as const,
            authorize: async (inputs?: any) =>
              new Promise(async (resolve) => {
                const isHeadless = isHeadlessEnvironment()

                /**
                 * Perform OAuth with local server + manual code input fallback
                 * Always starts server, always shows URL, always allows manual input
                 */
                const performOAuth = async (): Promise<IFlowOAuthTokenResult | { type: 'failed'; error: string }> => {
                  try {
                    const authData = await authorizeIFlowOAuth(config.auth_server_port_start)

                    // Start local OAuth server (always)
                    const server = await startOAuthServer(
                      authData.authUrl,
                      authData.state,
                      authData.redirectUri,
                      config.auth_server_port_start,
                      config.auth_server_port_range
                    )

                    console.log('\n=== iFlow OAuth Authentication ===\n')
                    console.log('OAuth URL:')
                    console.log(authData.authUrl)
                    console.log('')

                    // Open browser automatically if not headless
                    if (!isHeadless) {
                      console.log('Opening browser automatically...')
                      openBrowser(authData.authUrl)
                    }

                    console.log(`\nLocal callback server running on port ${server.actualPort}`)
                    console.log('Waiting for authentication...')
                    console.log('\n(If the browser does not open automatically, open the URL above manually)')
                    console.log('(You can also paste the callback URL or authorization code below)\n')

                    // Race between server callback and manual code input
                    const manualInputPromise = (async (): Promise<IFlowOAuthTokenResult> => {
                      const callbackInput = await promptOAuthCallback()
                      const { code, state } = parseOAuthCallbackInput(callbackInput)

                      if (!code) {
                        throw new Error('No authorization code provided')
                      }

                      if (state && state !== authData.state) {
                        throw new Error('State mismatch - possible CSRF attempt')
                      }

                      // Close server since we got manual input
                      server.close()
                      return await server.exchangeCode(code)
                    })()

                    const result = await Promise.race([
                      server.waitForAuth(),
                      manualInputPromise
                    ])

                    return result
                  } catch (e: any) {
                    logger.error(`OAuth authorization failed: ${e.message}`, e)
                    return { type: 'failed' as const, error: e.message }
                  }
                }

                if (inputs) {
                  const accounts: IFlowOAuthTokenResult[] = []
                  let startFresh = true

                  const existingAm = await AccountManager.loadFromDisk(
                    config.account_selection_strategy
                  )
                  if (existingAm.getAccountCount() > 0) {
                    const existingAccounts = existingAm.getAccounts().map((acc, idx) => ({
                      email: acc.email,
                      index: idx
                    }))

                    const loginMode = await promptLoginMode(existingAccounts)
                    startFresh = loginMode === 'fresh'

                    console.log(
                      startFresh
                        ? '\nStarting fresh - existing accounts will be replaced.\n'
                        : '\nAdding to existing accounts.\n'
                    )
                  }

                  while (true) {
                    console.log(`\n=== iFlow OAuth (Account ${accounts.length + 1}) ===\n`)

                    const result = await performOAuth()

                    if ('type' in result && result.type === 'failed') {
                      if (accounts.length === 0) {
                        return resolve({
                          url: '',
                          instructions: `Authentication failed: ${result.error}`,
                          method: 'code',
                          callback: async () => ({ type: 'failed' })
                        })
                      }

                      console.warn(
                        `[opencode-iflow-auth] Skipping failed account ${accounts.length + 1}: ${result.error}`
                      )
                      break
                    }

                    const successResult = result as IFlowOAuthTokenResult
                    accounts.push(successResult)

                    const isFirstAccount = accounts.length === 1
                    const am = await AccountManager.loadFromDisk(config.account_selection_strategy)

                    if (isFirstAccount && startFresh) {
                      am.getAccounts().forEach((acc) => am.removeAccount(acc))
                    }

                    const acc: ManagedAccount = {
                      id: generateAccountId(),
                      email: successResult.email,
                      authMethod: 'oauth',
                      refreshToken: successResult.refreshToken,
                      accessToken: successResult.accessToken,
                      expiresAt: successResult.expiresAt,
                      apiKey: successResult.apiKey,
                      rateLimitResetTime: 0,
                      isHealthy: true
                    }

                    am.addAccount(acc)
                    await am.saveToDisk()

                    showToast(
                      `Account ${accounts.length} authenticated${successResult.email ? ` (${successResult.email})` : ''}`,
                      'success'
                    )

                    let currentAccountCount = accounts.length
                    try {
                      const currentStorage = await AccountManager.loadFromDisk(
                        config.account_selection_strategy
                      )
                      currentAccountCount = currentStorage.getAccountCount()
                    } catch (e: any) {
                      logger.warn(`Failed to load account count: ${e.message}`)
                    }

                    const addAnother = await promptAddAnotherAccount(currentAccountCount)
                    if (!addAnother) {
                      break
                    }
                  }

                  const primary = accounts[0]
                  if (!primary) {
                    return resolve({
                      url: '',
                      instructions: 'Authentication cancelled',
                      method: 'code',
                      callback: async () => ({ type: 'failed' })
                    })
                  }

                  let actualAccountCount = accounts.length
                  try {
                    const finalStorage = await AccountManager.loadFromDisk(
                      config.account_selection_strategy
                    )
                    actualAccountCount = finalStorage.getAccountCount()
                  } catch (e: any) {
                    logger.warn(`Failed to load account count: ${e.message}`)
                  }

                  return resolve({
                    url: '',
                    instructions: `Multi-account setup complete (${actualAccountCount} account(s)).`,
                    method: 'code',
                    callback: async () => ({ type: 'success', key: primary.apiKey })
                  })
                }

                // TUI mode (no inputs) - return code-based auth that works for both headless and non-headless
                try {
                  const authData = await authorizeIFlowOAuth(config.auth_server_port_start)

                  // Start server in background
                  const server = await startOAuthServer(
                    authData.authUrl,
                    authData.state,
                    authData.redirectUri,
                    config.auth_server_port_start,
                    config.auth_server_port_range
                  )

                  // Open browser if not headless
                  if (!isHeadless) {
                    openBrowser(authData.authUrl)
                  }

                  resolve({
                    url: authData.authUrl,
                    instructions: `Open this URL to authenticate:\n${authData.authUrl}\n\nA local callback server is running on port ${server.actualPort}.\nYou can either wait for automatic redirect (if browser opened) or paste the callback URL/code below.`,
                    method: 'code',
                    callback: async (callbackInput: string) => {
                      try {
                        const { code, state } = parseOAuthCallbackInput(callbackInput)

                        if (!code) {
                          return { type: 'failed', error: 'Missing authorization code' }
                        }

                        if (state && state !== authData.state) {
                          return { type: 'failed', error: 'State mismatch - possible CSRF attempt' }
                        }

                        const res = await server.exchangeCode(code)
                        const am = await AccountManager.loadFromDisk(
                          config.account_selection_strategy
                        )
                        const acc: ManagedAccount = {
                          id: generateAccountId(),
                          email: res.email,
                          authMethod: 'oauth',
                          refreshToken: res.refreshToken,
                          accessToken: res.accessToken,
                          expiresAt: res.expiresAt,
                          apiKey: res.apiKey,
                          rateLimitResetTime: 0,
                          isHealthy: true
                        }
                        am.addAccount(acc)
                        await am.saveToDisk()
                        showToast(`Successfully logged in as ${res.email}`, 'success')
                        return { type: 'success', key: res.apiKey }
                      } catch (e: any) {
                        logger.error(`Login failed: ${e.message}`, e)
                        showToast(`Login failed: ${e.message}`, 'error')
                        return { type: 'failed', error: e.message }
                      }
                    }
                  })
                } catch (e: any) {
                  logger.error(`Authorization failed: ${e.message}`, e)
                  showToast(`Authorization failed: ${e.message}`, 'error')
                  resolve({
                    url: '',
                    instructions: 'Authorization failed',
                    method: 'code',
                    callback: async () => ({ type: 'failed' })
                  })
                }
              })
          },
          {
            id: 'api',
            label: 'iFlow API Key',
            type: 'api' as const,
            authorize: async (inputs?: any) =>
              new Promise(async (resolve) => {
                if (inputs) {
                  const accounts: Array<{ apiKey: string; email: string }> = []
                  let startFresh = true

                  const existingAm = await AccountManager.loadFromDisk(
                    config.account_selection_strategy
                  )
                  if (existingAm.getAccountCount() > 0) {
                    const existingAccounts = existingAm.getAccounts().map((acc, idx) => ({
                      email: acc.email,
                      index: idx
                    }))

                    const loginMode = await promptLoginMode(existingAccounts)
                    startFresh = loginMode === 'fresh'

                    console.log(
                      startFresh
                        ? '\nStarting fresh - existing accounts will be replaced.\n'
                        : '\nAdding to existing accounts.\n'
                    )
                  }

                  while (true) {
                    console.log(`\n=== iFlow API Key (Account ${accounts.length + 1}) ===\n`)

                    const apiKey = await promptApiKey()
                    if (!apiKey) {
                      if (accounts.length === 0) {
                        return resolve({
                          url: '',
                          instructions: 'API key required',
                          method: 'auto',
                          callback: async () => ({ type: 'failed' })
                        })
                      }
                      break
                    }

                    try {
                      await validateApiKey(apiKey)
                      const email = await promptEmail()

                      accounts.push({ apiKey, email })

                      const isFirstAccount = accounts.length === 1
                      const am = await AccountManager.loadFromDisk(
                        config.account_selection_strategy
                      )

                      if (isFirstAccount && startFresh) {
                        am.getAccounts().forEach((acc) => am.removeAccount(acc))
                      }

                      const acc: ManagedAccount = {
                        id: generateAccountId(),
                        email,
                        authMethod: 'apikey',
                        apiKey,
                        rateLimitResetTime: 0,
                        isHealthy: true
                      }

                      am.addAccount(acc)
                      await am.saveToDisk()

                      showToast(`Account ${accounts.length} added (${email})`, 'success')

                      let currentAccountCount = accounts.length
                      try {
                        const currentStorage = await AccountManager.loadFromDisk(
                          config.account_selection_strategy
                        )
                        currentAccountCount = currentStorage.getAccountCount()
                      } catch (e: any) {
                        logger.warn(`Failed to load account count: ${e.message}`)
                      }

                      const addAnother = await promptAddAnotherAccount(currentAccountCount)
                      if (!addAnother) {
                        break
                      }
                    } catch (error: any) {
                      console.error(`API key validation failed: ${error.message}`)
                      if (accounts.length === 0) {
                        return resolve({
                          url: '',
                          instructions: `API key validation failed: ${error.message}`,
                          method: 'auto',
                          callback: async () => ({ type: 'failed' })
                        })
                      }
                      break
                    }
                  }

                  const primary = accounts[0]
                  if (!primary) {
                    return resolve({
                      url: '',
                      instructions: 'Authentication cancelled',
                      method: 'auto',
                      callback: async () => ({ type: 'failed' })
                    })
                  }

                  let actualAccountCount = accounts.length
                  try {
                    const finalStorage = await AccountManager.loadFromDisk(
                      config.account_selection_strategy
                    )
                    actualAccountCount = finalStorage.getAccountCount()
                  } catch (e: any) {
                    logger.warn(`Failed to load account count: ${e.message}`)
                  }

                  return resolve({
                    url: '',
                    instructions: `Multi-account setup complete (${actualAccountCount} account(s)).`,
                    method: 'auto',
                    callback: async () => ({ type: 'success', key: primary.apiKey })
                  })
                }

                resolve({
                  url: '',
                  instructions:
                    'API Key authentication not supported in TUI mode. Use CLI: opencode auth login',
                  method: 'auto',
                  callback: async () => ({ type: 'failed' })
                })
              })
          }
        ]
      }
    }
  }

export const IFlowOAuthPlugin = createIFlowPlugin(IFLOW_PROVIDER_ID)
