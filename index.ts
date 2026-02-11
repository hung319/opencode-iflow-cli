export { createIFlowPlugin, IFLOW_PROVIDER_ID } from './src/plugin.js'
export { authorizeIFlowOAuth } from './src/iflow/oauth.js'
export { validateApiKey } from './src/iflow/apikey.js'
export type { IFlowAuthDetails, IFlowAuthMethod, ManagedAccount } from './src/plugin/types.js'
export type { IFlowConfig } from './src/plugin/config/index.js'

// Export plugin directly like Gemini auth - using iflow-oauth as provider ID
export { IFlowOAuthPlugin as default } from './src/plugin.js'
