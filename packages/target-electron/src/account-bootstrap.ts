import { access, readFile } from 'fs/promises'
import { constants } from 'fs'
import { dirname, join } from 'path'
import { parse } from 'yaml'

import { getLogger } from '@deltachat-desktop/shared/logger.js'
import type { AccountBootstrapConfig } from '@deltachat-desktop/shared/shared-types.js'
import { getConfigPath } from './application-constants.js'

const log = getLogger('main/account-bootstrap')

const ACCOUNT_BOOTSTRAP_FILENAME = 'account.yaml'
const MAX_PARENT_DIR_WALK = 15

const REQUIRED_STRING_FIELDS = [
  ['email', 'email'],
  ['password', 'password'],
  ['imap_server', 'imapServer'],
  ['smtp_server', 'smtpServer'],
  ['group', 'group'],
  ['invite', 'invite'],
] as const

function requireNonEmptyString(
  data: Record<string, unknown>,
  yamlKey: string,
  label: string
): string {
  const value = data[yamlKey]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `account.yaml: "${yamlKey}" (${label}) must be a non-empty string`
    )
  }
  return value.trim()
}

function requirePort(data: Record<string, unknown>, yamlKey: string): number {
  const value = data[yamlKey]
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < 1 || value > 65535) {
      throw new Error(`account.yaml: "${yamlKey}" must be between 1 and 65535`)
    }
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value.trim(), 10)
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed
    }
  }
  throw new Error(`account.yaml: "${yamlKey}" must be a valid port number`)
}

export function parseAccountBootstrapYaml(
  yamlText: string
): AccountBootstrapConfig {
  const parsed = parse(yamlText)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('account.yaml: root must be a mapping')
  }
  const data = parsed as Record<string, unknown>

  const strings: Record<string, string> = {}
  for (const [yamlKey, _prop] of REQUIRED_STRING_FIELDS) {
    strings[yamlKey] = requireNonEmptyString(data, yamlKey, yamlKey)
  }

  return {
    email: strings.email!,
    password: strings.password!,
    imapServer: strings.imap_server!,
    imapPort: requirePort(data, 'imap_port'),
    smtpServer: strings.smtp_server!,
    smtpPort: requirePort(data, 'smtp_port'),
    group: strings.group!,
    invite: strings.invite!,
  }
}

/** Directories to check for `account.yaml`, in order. */
export function accountBootstrapSearchDirs(): string[] {
  const dirs: string[] = []
  let dir = process.cwd()
  for (let i = 0; i < MAX_PARENT_DIR_WALK; i++) {
    dirs.push(dir)
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  try {
    dirs.push(getConfigPath())
  } catch (error) {
    log.debug('Skipping config dir for account.yaml search', error)
  }
  return [...new Set(dirs)]
}

async function findAccountBootstrapFile(): Promise<string | null> {
  for (const dir of accountBootstrapSearchDirs()) {
    const filePath = join(dir, ACCOUNT_BOOTSTRAP_FILENAME)
    try {
      await access(filePath, constants.R_OK)
      return filePath
    } catch {
      continue
    }
  }
  return null
}

export async function readAccountBootstrapFromCwd(): Promise<AccountBootstrapConfig | null> {
  const filePath = await findAccountBootstrapFile()
  if (filePath === null) {
    log.info(
      'No account.yaml found (searched cwd, parent folders, and app config dir)'
    )
    return null
  }
  log.info(`Loading account bootstrap from ${filePath}`)
  const yamlText = await readFile(filePath, 'utf-8')
  return parseAccountBootstrapYaml(yamlText)
}
