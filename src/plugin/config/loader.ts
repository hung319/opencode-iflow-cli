import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import {
  AccountSelectionStrategySchema,
  IFlowAuthMethodSchema,
  IFlowConfigSchema,
  DEFAULT_CONFIG,
  type IFlowConfig
} from './schema.js'
import * as logger from '../logger.js'

function getConfigDir(): string {
  const platform = process.platform
  if (platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'opencode')
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdgConfig, 'opencode')
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'iflow.json')
}

function ensureUserConfigTemplate(): void {
  const path = getConfigPath()
  if (!existsSync(path)) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
      logger.log(`Created default config template at ${path}`)
    } catch (error) {
      logger.warn(`Failed to create config template at ${path}: ${String(error)}`)
    }
  }
}

function loadConfigFile(path: string): Partial<IFlowConfig> | null {
  try {
    if (!existsSync(path)) {
      return null
    }

    const content = readFileSync(path, 'utf-8')
    const rawConfig = JSON.parse(content)

    const result = IFlowConfigSchema.partial().safeParse(rawConfig)

    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      logger.warn(`Config validation error at ${path}: ${issues}`)
      return null
    }

    return result.data
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn(`Invalid JSON in config file ${path}: ${error.message}`)
    } else {
      logger.warn(`Failed to load config file ${path}: ${String(error)}`)
    }
    return null
  }
}

function mergeConfigs(base: IFlowConfig, override: Partial<IFlowConfig>): IFlowConfig {
  return {
    ...base,
    ...override
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }
  if (value === '1' || value === 'true') {
    return true
  }
  if (value === '0' || value === 'false') {
    return false
  }
  return fallback
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (isNaN(parsed)) {
    return fallback
  }
  return parsed
}

function applyEnvOverrides(config: IFlowConfig): IFlowConfig {
  const env = process.env

  return {
    ...config,

    default_auth_method: env.IFLOW_DEFAULT_AUTH_METHOD
      ? IFlowAuthMethodSchema.catch('oauth').parse(env.IFLOW_DEFAULT_AUTH_METHOD)
      : config.default_auth_method,

    account_selection_strategy: env.IFLOW_ACCOUNT_SELECTION_STRATEGY
      ? AccountSelectionStrategySchema.catch('round-robin').parse(
          env.IFLOW_ACCOUNT_SELECTION_STRATEGY
        )
      : config.account_selection_strategy,

    auth_server_port_start: parseNumberEnv(
      env.IFLOW_AUTH_SERVER_PORT_START,
      config.auth_server_port_start
    ),

    auth_server_port_range: parseNumberEnv(
      env.IFLOW_AUTH_SERVER_PORT_RANGE,
      config.auth_server_port_range
    ),

    max_request_iterations: parseNumberEnv(
      env.IFLOW_MAX_REQUEST_ITERATIONS,
      config.max_request_iterations
    ),

    request_timeout_ms: parseNumberEnv(env.IFLOW_REQUEST_TIMEOUT_MS, config.request_timeout_ms),

    enable_log_api_request: parseBooleanEnv(
      env.IFLOW_ENABLE_LOG_API_REQUEST,
      config.enable_log_api_request
    )
  }
}

export function loadConfig(): IFlowConfig {
  ensureUserConfigTemplate()
  let config: IFlowConfig = { ...DEFAULT_CONFIG }

  const userConfigPath = getConfigPath()
  const userConfig = loadConfigFile(userConfigPath)
  if (userConfig) {
    config = mergeConfigs(config, userConfig)
  }

  config = applyEnvOverrides(config)

  return config
}
