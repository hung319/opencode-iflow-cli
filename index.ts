import type { Plugin, Hooks, Config } from '@opencode-ai/plugin'

export { createIFlowPlugin, IFLOW_PROVIDER_ID } from './src/plugin.js'
export { authorizeIFlowOAuth } from './src/iflow/oauth.js'
export { validateApiKey } from './src/iflow/apikey.js'
export type { IFlowAuthDetails, IFlowAuthMethod, ManagedAccount } from './src/plugin/types.js'
export type { IFlowConfig } from './src/plugin/config/index.js'

const IFLOW_PROVIDER_ID = 'iflow'

const plugin: Plugin = async (input) => {
  const { createIFlowPlugin } = await import('./src/plugin.js')
  const result = await createIFlowPlugin(IFLOW_PROVIDER_ID)(input)
  return result as Hooks
}

// Also export as default and named export
export default plugin
export { plugin as iflow }
