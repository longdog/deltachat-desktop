import { getLogger } from '@deltachat-desktop/shared/logger'
import { runtime } from '@deltachat-desktop/runtime-interface'

import { BackendRemote } from '../backend-com'
import { useEffect, useState } from 'react'

const log = getLogger('renderer/accountBootstrapRestriction')

export const BOOTSTRAP_GROUP_CHAT_ID_CONFIG_KEY = 'ui.bootstrap_group_chat_id'

export async function persistBootstrapGroupChatId(
  accountId: number,
  chatId: number
): Promise<void> {
  await BackendRemote.rpc.setConfig(
    accountId,
    BOOTSTRAP_GROUP_CHAT_ID_CONFIG_KEY,
    `${chatId}`
  )
}

async function findGroupChatIdByName(
  accountId: number,
  groupName: string
): Promise<number | null> {
  const chatListIds = await BackendRemote.rpc.getChatlistEntries(
    accountId,
    null,
    null,
    null
  )
  for (const chatId of chatListIds) {
    const chat = await BackendRemote.rpc.getBasicChatInfo(accountId, chatId)
    if (chat.name === groupName && chat.chatType === 'Group') {
      return chatId
    }
  }
  return null
}

async function accountMatchesBootstrapEmail(
  accountId: number,
  bootstrapEmail: string
): Promise<boolean> {
  const transports = await BackendRemote.rpc.listTransports(accountId)
  return transports.some(
    transport => transport.addr.toLowerCase() === bootstrapEmail.toLowerCase()
  )
}

export async function resolveBootstrapRestrictedChatId(
  accountId: number
): Promise<number | null> {
  const stored = await BackendRemote.rpc.getConfig(
    accountId,
    BOOTSTRAP_GROUP_CHAT_ID_CONFIG_KEY
  )
  if (typeof stored === 'string' && stored !== '') {
    const parsed = Number.parseInt(stored, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  let config
  try {
    config = await runtime.readAccountBootstrap()
  } catch (error) {
    log.error('Failed to read account.yaml for chat list restriction', error)
    return null
  }
  if (config === null) {
    return null
  }

  if (!(await accountMatchesBootstrapEmail(accountId, config.email))) {
    return null
  }

  const chatId = await findGroupChatIdByName(accountId, config.group)
  if (chatId !== null) {
    await persistBootstrapGroupChatId(accountId, chatId)
  }
  return chatId
}

export type BootstrapChatListRestriction =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'singleChat'; chatId: number }

export function useBootstrapChatListRestriction(
  accountId: number | undefined
): BootstrapChatListRestriction {
  const [restriction, setRestriction] =
    useState<BootstrapChatListRestriction>({ status: 'loading' })

  useEffect(() => {
    if (accountId === undefined) {
      setRestriction({ status: 'none' })
      return
    }
    let cancelled = false
    setRestriction({ status: 'loading' })
    resolveBootstrapRestrictedChatId(accountId)
      .then(chatId => {
        if (cancelled) {
          return
        }
        if (chatId === null) {
          setRestriction({ status: 'none' })
        } else {
          setRestriction({ status: 'singleChat', chatId })
        }
      })
      .catch(error => {
        log.error('Failed to resolve bootstrap chat list restriction', error)
        if (!cancelled) {
          setRestriction({ status: 'none' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  return restriction
}

export function filterChatListIdsForBootstrap(
  chatListIds: number[],
  restriction: BootstrapChatListRestriction
): number[] {
  if (restriction.status !== 'singleChat') {
    return chatListIds
  }
  return chatListIds.filter(chatId => chatId === restriction.chatId)
}
