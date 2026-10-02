import type { AccountBootstrapConfig } from '@deltachat-desktop/shared/shared-types'
import { getLogger } from '@deltachat-desktop/shared/logger'
import { runtime } from '@deltachat-desktop/runtime-interface'

import { BackendRemote } from '../backend-com'
import { defaultCredentials, type Credentials } from '../components/Settings/DefaultCredentials'
import { saveLastChatId } from './chat'
import { persistBootstrapGroupChatId } from './accountBootstrapRestriction'
import { updateDeviceChat } from '../deviceMessages'

const log = getLogger('renderer/accountBootstrap')

export type AccountBootstrapSuccess = {
  ok: true
  accountId: number
}

export type AccountBootstrapResult =
  | AccountBootstrapSuccess
  | { ok: false }

function credentialsFromConfig(config: AccountBootstrapConfig): Credentials {
  return {
    ...defaultCredentials(),
    addr: config.email,
    password: config.password,
    imapServer: config.imapServer,
    imapPort: config.imapPort,
    smtpServer: config.smtpServer,
    smtpPort: config.smtpPort,
  }
}

async function findUnconfiguredAccountId(): Promise<number | null> {
  const accounts = await BackendRemote.rpc.getAllAccounts()
  const unconfigured = accounts.find(account => account.kind === 'Unconfigured')
  return unconfigured?.id ?? null
}

export async function tryAccountBootstrapFromYaml(): Promise<AccountBootstrapResult> {
  let config: AccountBootstrapConfig | null
  try {
    config = await runtime.readAccountBootstrap()
  } catch (error) {
    log.error('Failed to read account.yaml', error)
    return { ok: false }
  }

  if (config === null) {
    log.info('No account.yaml found, skipping bootstrap')
    return { ok: false }
  }

  log.info('Starting account bootstrap from account.yaml')

  let accountId: number | undefined
  let createdAccount = false

  try {
    const existingUnconfiguredId = await findUnconfiguredAccountId()
    if (existingUnconfiguredId !== null) {
      accountId = existingUnconfiguredId
    } else {
      accountId = await BackendRemote.rpc.addAccount()
      createdAccount = true
      updateDeviceChat(accountId, true)
    }

    await BackendRemote.rpc.addOrUpdateTransport(
      accountId,
      credentialsFromConfig(config)
    )

    await BackendRemote.rpc.startIo(accountId)

    const qr = await BackendRemote.rpc.checkQr(accountId, config.invite)
    if (qr.kind !== 'askVerifyContact') {
      throw new Error(
        `account.yaml invite must be a contact invite, got QR kind "${qr.kind}"`
      )
    }
    const contactId = qr.contact_id

    await BackendRemote.rpc.secureJoin(accountId, config.invite)

    const groupChatId = await BackendRemote.rpc.createGroupChat(
      accountId,
      config.group,
      false
    )
    await BackendRemote.rpc.addContactToChat(
      accountId,
      groupChatId,
      contactId
    )

    await saveLastChatId(accountId, groupChatId)
    await persistBootstrapGroupChatId(accountId, groupChatId)

    log.info('Account bootstrap from account.yaml completed')
    return { ok: true, accountId }
  } catch (error) {
    log.error('Account bootstrap from account.yaml failed', error)
    if (createdAccount && accountId !== undefined) {
      try {
        await BackendRemote.rpc.removeAccount(accountId)
        runtime.deleteWebxdcAccountData(accountId)
      } catch (removeError) {
        log.error('Failed to remove account after bootstrap failure', removeError)
      }
    }
    return { ok: false }
  }
}
