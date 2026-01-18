import { randomBytes } from 'node:crypto'
import { loadAccounts, saveAccounts } from './storage'
import type {
  ManagedAccount,
  AccountMetadata,
  AccountSelectionStrategy,
  IFlowAuthDetails,
  RefreshParts
} from './types'

export function generateAccountId(): string {
  return randomBytes(16).toString('hex')
}

export function encodeRefreshToken(parts: RefreshParts): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64')
}

export function decodeRefreshToken(encoded: string): RefreshParts {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
  } catch {
    return { authMethod: 'apikey' }
  }
}

export class AccountManager {
  private accounts: ManagedAccount[]
  private cursor: number
  private strategy: AccountSelectionStrategy
  private lastToastTime = 0

  constructor(accounts: ManagedAccount[], strategy: AccountSelectionStrategy = 'sticky') {
    this.accounts = accounts
    this.cursor = 0
    this.strategy = strategy
  }

  static async loadFromDisk(strategy?: AccountSelectionStrategy): Promise<AccountManager> {
    const s = await loadAccounts()
    return new AccountManager(s.accounts, strategy || 'sticky')
  }

  getAccountCount(): number {
    return this.accounts.length
  }

  getAccounts(): ManagedAccount[] {
    return [...this.accounts]
  }

  shouldShowToast(debounce = 30000): boolean {
    if (Date.now() - this.lastToastTime < debounce) return false
    this.lastToastTime = Date.now()
    return true
  }

  getMinWaitTime(): number {
    const now = Date.now()
    const waits = this.accounts.map((a) => (a.rateLimitResetTime || 0) - now).filter((t) => t > 0)
    return waits.length > 0 ? Math.min(...waits) : 0
  }

  getCurrentOrNext(): ManagedAccount | null {
    const now = Date.now()
    const available = this.accounts.filter((a) => {
      if (!a.isHealthy) {
        if (a.recoveryTime && now >= a.recoveryTime) {
          a.isHealthy = true
          delete a.unhealthyReason
          delete a.recoveryTime
          return true
        }
        return false
      }
      return !(a.rateLimitResetTime && now < a.rateLimitResetTime)
    })

    if (available.length === 0) return null

    let selected: ManagedAccount | undefined
    if (this.strategy === 'sticky') {
      selected = available.find((_, i) => i === this.cursor) || available[0]
    } else if (this.strategy === 'round-robin') {
      selected = available[this.cursor % available.length]
      this.cursor = (this.cursor + 1) % available.length
    }

    if (selected) {
      selected.lastUsed = now
      this.cursor = this.accounts.indexOf(selected)
      return selected
    }
    return null
  }

  addAccount(a: ManagedAccount): void {
    const i = this.accounts.findIndex((x) => x.id === a.id)
    if (i === -1) this.accounts.push(a)
    else this.accounts[i] = a
  }

  removeAccount(a: ManagedAccount): void {
    const removedIndex = this.accounts.findIndex((x) => x.id === a.id)
    if (removedIndex === -1) return

    this.accounts = this.accounts.filter((x) => x.id !== a.id)

    if (this.accounts.length === 0) {
      this.cursor = 0
    } else if (this.cursor >= this.accounts.length) {
      this.cursor = this.accounts.length - 1
    } else if (removedIndex <= this.cursor && this.cursor > 0) {
      this.cursor--
    }
  }

  updateFromAuth(a: ManagedAccount, auth: IFlowAuthDetails): void {
    const acc = this.accounts.find((x) => x.id === a.id)
    if (acc) {
      acc.apiKey = auth.apiKey
      if (auth.authMethod === 'oauth') {
        acc.accessToken = auth.access
        acc.expiresAt = auth.expires
        const p = decodeRefreshToken(auth.refresh)
        acc.refreshToken = p.refreshToken
      }
      acc.lastUsed = Date.now()
      if (auth.email) acc.email = auth.email
    }
  }

  markRateLimited(a: ManagedAccount, ms: number): void {
    const acc = this.accounts.find((x) => x.id === a.id)
    if (acc) acc.rateLimitResetTime = Date.now() + ms
  }

  markUnhealthy(a: ManagedAccount, reason: string, recovery?: number): void {
    const acc = this.accounts.find((x) => x.id === a.id)
    if (acc) {
      acc.isHealthy = false
      acc.unhealthyReason = reason
      acc.recoveryTime = recovery
    }
  }

  async saveToDisk(): Promise<void> {
    const metadata: AccountMetadata[] = this.accounts.map(({ lastUsed, ...rest }) => rest)
    await saveAccounts({ version: 1, accounts: metadata, activeIndex: this.cursor })
  }

  toAuthDetails(a: ManagedAccount): IFlowAuthDetails {
    const p: RefreshParts = {
      refreshToken: a.refreshToken,
      authMethod: a.authMethod
    }
    return {
      refresh: encodeRefreshToken(p),
      access: a.accessToken || '',
      expires: a.expiresAt || 0,
      authMethod: a.authMethod,
      apiKey: a.apiKey,
      email: a.email
    }
  }
}
