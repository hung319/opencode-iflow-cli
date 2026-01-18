import type { IFlowAuthDetails } from './types'
import { refreshOAuthToken } from '../iflow/oauth'
import { decodeRefreshToken, encodeRefreshToken } from './accounts'

export function accessTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - 60000
}

export async function refreshAccessToken(auth: IFlowAuthDetails): Promise<IFlowAuthDetails> {
  if (auth.authMethod === 'apikey') {
    return auth
  }

  if (auth.authMethod === 'oauth') {
    const parts = decodeRefreshToken(auth.refresh)
    if (!parts.refreshToken) {
      throw new Error('No refresh token available')
    }

    const result = await refreshOAuthToken(parts.refreshToken)

    return {
      refresh: encodeRefreshToken({ refreshToken: result.refreshToken, authMethod: 'oauth' }),
      access: result.accessToken,
      expires: result.expiresAt,
      authMethod: 'oauth',
      apiKey: result.apiKey,
      email: result.email
    }
  }

  throw new Error(`Unknown auth method: ${auth.authMethod}`)
}
