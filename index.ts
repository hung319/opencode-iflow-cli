import type { Plugin, Hooks } from '@opencode-ai/plugin'

export { createIFlowPlugin, IFLOW_PROVIDER_ID } from './src/plugin.js'
export { authorizeIFlowOAuth } from './src/iflow/oauth.js'
export { validateApiKey } from './src/iflow/apikey.js'
export type { IFlowAuthDetails, IFlowAuthMethod, ManagedAccount } from './src/plugin/types.js'
export type { IFlowConfig } from './src/plugin/config/index.js'

const plugin: Plugin = async (input) => {
  const { createIFlowPlugin, IFLOW_PROVIDER_ID } = await import('./src/plugin.js')
  const result = await createIFlowPlugin(IFLOW_PROVIDER_ID)(input)
  return result as Hooks
}

export default plugin
export { plugin as iflow, plugin as 'iflow-oauth' }
