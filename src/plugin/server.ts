import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { IFlowOAuthTokenResult } from '../iflow/oauth'
import { exchangeOAuthCode } from '../iflow/oauth'

export interface OAuthServerResult {
  url: string
  redirectUri: string
  actualPort: number
  waitForAuth: () => Promise<IFlowOAuthTokenResult>
  exchangeCode: (code: string) => Promise<IFlowOAuthTokenResult>
  close: () => void
}

export async function startOAuthServer(
  authUrl: string,
  state: string,
  redirectUri: string,
  portStart: number,
  portRange: number
): Promise<OAuthServerResult> {
  let resolveAuth: (result: IFlowOAuthTokenResult) => void
  let rejectAuth: (error: Error) => void
  let timeoutHandle: NodeJS.Timeout

  const authPromise = new Promise<IFlowOAuthTokenResult>((resolve, reject) => {
    resolveAuth = resolve
    rejectAuth = reject
  })

  let server: ReturnType<typeof createServer> | null = null
  let actualPort = portStart

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '', `http://localhost:${actualPort}`)

    if (url.pathname === '/oauth2callback') {
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<html><body><h1>Authorization failed: ${error}</h1></body></html>`)
        clearTimeout(timeoutHandle)
        rejectAuth(new Error(`Authorization failed: ${error}`))
        setTimeout(() => server?.close(), 1000)
        return
      }

      if (!code || !returnedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h1>Error: Missing code or state</h1></body></html>')
        clearTimeout(timeoutHandle)
        rejectAuth(new Error('Missing code or state in callback'))
        setTimeout(() => server?.close(), 1000)
        return
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h1>Error: State mismatch</h1></body></html>')
        clearTimeout(timeoutHandle)
        rejectAuth(new Error('State mismatch'))
        setTimeout(() => server?.close(), 1000)
        return
      }

      try {
        const result = await exchangeOAuthCode(code, redirectUri)

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<html><body><h1>Authentication successful!</h1><p>Account: ${result.email}</p><p>You can close this window.</p></body></html>`
        )

        clearTimeout(timeoutHandle)
        setTimeout(() => {
          resolveAuth(result)
          setTimeout(() => server?.close(), 1000)
        }, 100)
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<html><body><h1>Error: ${error.message}</h1></body></html>`)
        clearTimeout(timeoutHandle)
        rejectAuth(error)
        setTimeout(() => server?.close(), 1000)
      }
    } else {
      res.writeHead(204)
      res.end()
    }
  }

  for (let port = portStart; port < portStart + portRange; port++) {
    try {
      server = createServer(handler)
      await new Promise<void>((resolve, reject) => {
        server!.listen(port, '0.0.0.0', () => {
          actualPort = port
          resolve()
        })
        server!.on('error', reject)
      })
      break
    } catch (error: any) {
      if (error.code !== 'EADDRINUSE' || port === portStart + portRange - 1) {
        throw error
      }
    }
  }

  if (!server) {
    throw new Error('Failed to start OAuth callback server')
  }

  timeoutHandle = setTimeout(
    () => {
      if (server?.listening) {
        rejectAuth(new Error('OAuth timeout: No response after 10 minutes'))
        server.close()
      }
    },
    10 * 60 * 1000
  )

  // Function to manually exchange code (for headless/paste mode)
  const exchangeCode = async (code: string): Promise<IFlowOAuthTokenResult> => {
    try {
      const result = await exchangeOAuthCode(code, redirectUri)
      clearTimeout(timeoutHandle)
      resolveAuth(result)
      setTimeout(() => server?.close(), 1000)
      return result
    } catch (error: any) {
      clearTimeout(timeoutHandle)
      rejectAuth(error)
      setTimeout(() => server?.close(), 1000)
      throw error
    }
  }

  const close = () => {
    clearTimeout(timeoutHandle)
    server?.close()
  }

  return {
    url: authUrl,
    redirectUri,
    actualPort,
    waitForAuth: () => authPromise,
    exchangeCode,
    close
  }
}
