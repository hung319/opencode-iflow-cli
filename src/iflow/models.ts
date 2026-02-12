/**
 * Auto-update models from iFlow API
 * Fetches available models from https://apis.iflow.cn/v1/models
 */

import * as logger from '../plugin/logger.js'

export interface IFlowModel {
  id: string
  name: string
  context_window: number
  max_tokens: number
  modalities: {
    input: string[]
    output: string[]
  }
  supports_thinking?: boolean
  variants?: Record<string, any>
}

export interface IFlowModelsResponse {
  data: IFlowModel[]
  last_updated: string
}

/**
 * Fetch models from iFlow API
 * @param apiKey - API key or OAuth token
 * @param authType - 'oauth' | 'apikey'
 */
export async function fetchModelsFromAPI(
  apiKey: string,
  authType: 'oauth' | 'apikey' = 'apikey'
): Promise<IFlowModel[] | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (authType === 'oauth') {
      headers['Authorization'] = `Bearer ${apiKey}`
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch('https://apis.iflow.cn/v1/models', {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      logger.warn(`Failed to fetch models: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json() as IFlowModelsResponse
    return data.data || null
  } catch (error: any) {
    logger.warn(`Error fetching models from API: ${error.message}`)
    return null
  }
}

/**
 * Fetch models from web scraping (fallback)
 * Note: This is a fallback method if API fails
 */
export async function fetchModelsFromWeb(): Promise<IFlowModel[] | null> {
  try {
    const response = await fetch('https://platform.iflow.cn/en/models', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      return null
    }

    const html = await response.text()
    
    // Parse models from HTML (basic implementation)
    // In production, this would use a proper HTML parser
    
    // Try to extract model data from JSON-LD or script tags
    const scriptMatch = html.match(/window\.__MODELS__\s*=\s*(\[.*?\]);/s)
    if (scriptMatch && scriptMatch[1]) {
      try {
        const parsed = JSON.parse(scriptMatch[1]) as any[]
        return parsed.map((m: any) => ({
          id: m.id,
          name: m.name,
          context_window: m.context_window || 128000,
          max_tokens: m.max_tokens || 32000,
          modalities: m.modalities || { input: ['text'], output: ['text'] },
          supports_thinking: m.supports_thinking || false,
        }))
      } catch {
        // Fall through to default
      }
    }
    
    return null
  } catch (error: any) {
    logger.warn(`Error fetching models from web: ${error.message}`)
    return null
  }
}

/**
 * Transform iFlow models to OpenCode format
 */
export function transformModelsToOpenCode(models: IFlowModel[]): Record<string, any> {
  const result: Record<string, any> = {}
  
  for (const model of models) {
    result[model.id] = {
      name: model.name,
      limit: {
        context: model.context_window,
        output: model.max_tokens,
      },
      modalities: model.modalities,
      ...(model.variants && { variants: model.variants }),
    }
  }
  
  return result
}

/**
 * Get cached models or fetch new ones
 */
export async function getModels(
  apiKey: string | undefined,
  authType: 'oauth' | 'apikey' | undefined
): Promise<Record<string, any>> {
  // Try to fetch from API if credentials available
  if (apiKey && authType) {
    const apiModels = await fetchModelsFromAPI(apiKey, authType)
    if (apiModels) {
      return transformModelsToOpenCode(apiModels)
    }
  }
  
  // Fallback to web scraping
  const webModels = await fetchModelsFromWeb()
  if (webModels) {
    return transformModelsToOpenCode(webModels)
  }
  
  // Final fallback: use default models
  return {}
}
