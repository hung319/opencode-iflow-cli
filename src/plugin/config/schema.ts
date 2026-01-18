import { z } from 'zod'

export const AccountSelectionStrategySchema = z.enum(['sticky', 'round-robin'])
export type AccountSelectionStrategy = z.infer<typeof AccountSelectionStrategySchema>

export const IFlowAuthMethodSchema = z.enum(['oauth', 'apikey'])
export type IFlowAuthMethod = z.infer<typeof IFlowAuthMethodSchema>

export const IFlowConfigSchema = z.object({
  $schema: z.string().optional(),
  default_auth_method: IFlowAuthMethodSchema.default('oauth'),
  account_selection_strategy: AccountSelectionStrategySchema.default('round-robin'),
  auth_server_port_start: z.number().min(1024).max(65535).default(8087),
  auth_server_port_range: z.number().min(1).max(100).default(10),
  max_request_iterations: z.number().min(10).max(1000).default(50),
  request_timeout_ms: z.number().min(60000).max(600000).default(300000),
  enable_debug_logging: z.boolean().default(false)
})

export type IFlowConfig = z.infer<typeof IFlowConfigSchema>

export const DEFAULT_CONFIG: IFlowConfig = {
  default_auth_method: 'oauth',
  account_selection_strategy: 'round-robin',
  auth_server_port_start: 8087,
  auth_server_port_range: 10,
  max_request_iterations: 50,
  request_timeout_ms: 300000,
  enable_debug_logging: false
}
