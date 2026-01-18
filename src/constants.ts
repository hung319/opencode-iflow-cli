export type IFlowAuthMethod = 'oauth' | 'apikey'

export function isValidAuthMethod(method: string): method is IFlowAuthMethod {
  return method === 'oauth' || method === 'apikey'
}

export const IFLOW_CONSTANTS = {
  BASE_URL: 'https://apis.iflow.cn/v1',
  OAUTH_TOKEN_URL: 'https://iflow.cn/oauth/token',
  OAUTH_AUTHORIZE_URL: 'https://iflow.cn/oauth',
  USER_INFO_URL: 'https://iflow.cn/api/oauth/getUserInfo',
  SUCCESS_REDIRECT: 'https://iflow.cn/oauth/success',
  CLIENT_ID: '10009311001',
  CLIENT_SECRET: '4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW',
  AXIOS_TIMEOUT: 120000,
  USER_AGENT: 'OpenCode-iFlow',
  CALLBACK_PORT_START: 8087,
  CALLBACK_PORT_RANGE: 10
}

export const SUPPORTED_MODELS = [
  'iflow-rome-30ba3b',
  'qwen3-coder-plus',
  'qwen3-max',
  'qwen3-vl-plus',
  'qwen3-max-preview',
  'qwen3-32b',
  'qwen3-235b-a22b-thinking-2507',
  'qwen3-235b-a22b-instruct',
  'qwen3-235b',
  'kimi-k2-0905',
  'kimi-k2',
  'glm-4.6',
  'deepseek-v3.2',
  'deepseek-r1',
  'deepseek-v3'
]

export const THINKING_MODELS = ['glm-4.6', 'qwen3-235b-a22b-thinking-2507', 'deepseek-r1']

export function isThinkingModel(model: string): boolean {
  return THINKING_MODELS.some((m) => model.startsWith(m))
}

export function applyThinkingConfig(body: any, model: string): any {
  if (model.startsWith('glm-4')) {
    return {
      ...body,
      chat_template_kwargs: {
        enable_thinking: true,
        clear_thinking: false
      }
    }
  }
  return body
}
