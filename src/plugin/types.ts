export type IFlowAuthMethod = 'oauth' | 'apikey'

export interface IFlowAuthDetails {
  refresh: string
  access: string
  expires: number
  authMethod: IFlowAuthMethod
  apiKey: string
  email?: string
}

export interface RefreshParts {
  refreshToken?: string
  authMethod: IFlowAuthMethod
}

export interface ManagedAccount {
  id: string
  email: string
  authMethod: IFlowAuthMethod
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
  apiKey: string
  rateLimitResetTime: number
  isHealthy: boolean
  unhealthyReason?: string
  recoveryTime?: number
  lastUsed?: number
}

export interface AccountMetadata {
  id: string
  email: string
  authMethod: IFlowAuthMethod
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
  apiKey: string
  rateLimitResetTime: number
  isHealthy: boolean
  unhealthyReason?: string
  recoveryTime?: number
}

export interface AccountStorage {
  version: 1
  accounts: AccountMetadata[]
  activeIndex: number
}

export type AccountSelectionStrategy = 'sticky' | 'round-robin'

export interface IFlowPluginConfig {
  default_auth_method: IFlowAuthMethod
  account_selection_strategy: AccountSelectionStrategy
  auth_server_port_start: number
  auth_server_port_range: number
  max_request_iterations: number
  request_timeout_ms: number
  enable_log_api_request: boolean
}
