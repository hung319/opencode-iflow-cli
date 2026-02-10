import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

export async function promptAddAnotherAccount(currentCount: number): Promise<boolean> {
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`Add another account? (${currentCount} added) (y/n): `)
    const normalized = answer.trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes'
  } finally {
    rl.close()
  }
}

export type LoginMode = 'add' | 'fresh'

export interface ExistingAccountInfo {
  email?: string
  index: number
}

export async function promptLoginMode(existingAccounts: ExistingAccountInfo[]): Promise<LoginMode> {
  const rl = createInterface({ input, output })
  try {
    console.log(`\n${existingAccounts.length} account(s) saved:`)
    for (const acc of existingAccounts) {
      const label = acc.email || `Account ${acc.index + 1}`
      console.log(`  ${acc.index + 1}. ${label}`)
    }
    console.log('')

    while (true) {
      const answer = await rl.question('(a)dd new account(s) or (f)resh start? [a/f]: ')
      const normalized = answer.trim().toLowerCase()

      if (normalized === 'a' || normalized === 'add') {
        return 'add'
      }
      if (normalized === 'f' || normalized === 'fresh') {
        return 'fresh'
      }

      console.log("Please enter 'a' to add accounts or 'f' to start fresh.")
    }
  } finally {
    rl.close()
  }
}

export type AuthMethod = 'oauth' | 'apikey'

export async function promptAuthMethod(): Promise<AuthMethod> {
  const rl = createInterface({ input, output })
  try {
    while (true) {
      const answer = await rl.question('Choose auth method: (o)auth or (a)pi key? [o/a]: ')
      const normalized = answer.trim().toLowerCase()

      if (normalized === 'o' || normalized === 'oauth') {
        return 'oauth'
      }
      if (normalized === 'a' || normalized === 'apikey' || normalized === 'api') {
        return 'apikey'
      }

      console.log("Please enter 'o' for OAuth or 'a' for API Key.")
    }
  } finally {
    rl.close()
  }
}

export async function promptApiKey(): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question('Enter your iFlow API Key (sk-...): ')
    return answer.trim()
  } finally {
    rl.close()
  }
}

export async function promptEmail(): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question('Enter email (optional, for display): ')
    return answer.trim() || 'api-key-user'
  } finally {
    rl.close()
  }
}

export async function promptOAuthCallback(): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    console.log('')
    const answer = await rl.question('Paste the callback URL or authorization code: ')
    return answer.trim()
  } finally {
    rl.close()
  }
}
