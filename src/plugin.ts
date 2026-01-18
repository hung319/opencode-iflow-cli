import { loadConfig } from './plugin/config'
import { exec } from 'node:child_process'
import { AccountManager, generateAccountId } from './plugin/accounts'
import { accessTokenExpired } from './plugin/token'
import { refreshAccessToken } from './plugin/token'
import { authorizeIFlowOAuth } from './iflow/oauth'
import { validateApiKey } from './iflow/apikey'
import { startOAuthServer } from './plugin/server'
import { IFlowTokenRefreshError } from './plugin/errors'
import {
  promptAddAnotherAccount,
  promptLoginMode,
  promptAuthMethod,
  promptApiKey,
  promptEmail
} from './plugin/cli'
import type { ManagedAccount } from './plugin/types'
import type { IFlowOAuthTokenResult } from './iflow/oauth'
import { IFLOW_CONSTANTS, applyThinkingConfig } from './constants'
import * as logger from './plugin/logger'

const IFLOW_PROVIDER_ID = 'iflow'

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

export const createIFlowPlugin =
  (id: string) =>
  async ({ client, directory }: any) => {
    const config = loadConfig()
    const showToast = (message: string, variant: 'info' | 'warning' | 'success' | 'error') => {
      client.tui.showToast({ body: { message, variant } }).catch(() => {})
    }

    return {
      auth: {
        provider: id,
        loader: async (getAuth: any) => {
          await getAuth()
          const am = await AccountManager.loadFromDisk(config.account_selection_strategy)
          return {
            apiKey: '',
            baseURL: IFLOW_CONSTANTS.BASE_URL,
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
                    await sleep(Math.min(minWait, 5000))
                    continue
                  }
                  throw new Error('No healthy accounts available')
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

                const headers = {
                  Authorization: `Bearer ${acc.apiKey}`,
                  'User-Agent': IFLOW_CONSTANTS.USER_AGENT,
                  'Content-Type': 'application/json',
                  ...init?.headers
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
            type: 'oauth',
            authorize: async (inputs?: any) =>
              new Promise(async (resolve) => {
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

                    const result = await (async (): Promise<
                      IFlowOAuthTokenResult | { type: 'failed'; error: string }
                    > => {
                      try {
                        const authData = await authorizeIFlowOAuth(config.auth_server_port_start)
                        const { url, redirectUri, waitForAuth } = await startOAuthServer(
                          authData.authUrl,
                          authData.state,
                          authData.redirectUri,
                          config.auth_server_port_start,
                          config.auth_server_port_range
                        )

                        console.log('OAuth URL:\n' + url + '\n')
                        openBrowser(url)

                        const res = await waitForAuth()
                        return res as IFlowOAuthTokenResult
                      } catch (e: any) {
                        logger.error(`OAuth authorization failed: ${e.message}`, e)
                        return { type: 'failed' as const, error: e.message }
                      }
                    })()

                    if ('type' in result && result.type === 'failed') {
                      if (accounts.length === 0) {
                        return resolve({
                          url: '',
                          instructions: `Authentication failed: ${result.error}`,
                          method: 'auto',
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

                try {
                  const authData = await authorizeIFlowOAuth(config.auth_server_port_start)
                  const { url, redirectUri, waitForAuth } = await startOAuthServer(
                    authData.authUrl,
                    authData.state,
                    authData.redirectUri,
                    config.auth_server_port_start,
                    config.auth_server_port_range
                  )
                  openBrowser(url)
                  resolve({
                    url,
                    instructions: `Open this URL to continue: ${url}`,
                    method: 'auto',
                    callback: async () => {
                      try {
                        const res = await waitForAuth()
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
                        return { type: 'failed' }
                      }
                    }
                  })
                } catch (e: any) {
                  logger.error(`Authorization failed: ${e.message}`, e)
                  showToast(`Authorization failed: ${e.message}`, 'error')
                  resolve({
                    url: '',
                    instructions: 'Authorization failed',
                    method: 'auto',
                    callback: async () => ({ type: 'failed' })
                  })
                }
              })
          },
          {
            id: 'apikey',
            label: 'iFlow API Key',
            type: 'apikey',
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
