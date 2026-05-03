import { existsSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { app } from '../../test-utils/stubs/electron'
import {
  clearUpdateSessionState,
  parseUpdatedFromArgv,
  readUpdateSessionState,
  saveUpdateSessionState
} from './state'

describe('parseUpdatedFromArgv', () => {
  it('читает версию из флага --updated-from=', () => {
    expect(parseUpdatedFromArgv(['LexPatrol.exe', '--updated-from=1.6.0'])).toBe('1.6.0')
  })

  it('возвращает null если флага нет', () => {
    expect(parseUpdatedFromArgv(['LexPatrol.exe'])).toBeNull()
  })

  it('возвращает null для пустого значения после флага', () => {
    expect(parseUpdatedFromArgv(['--updated-from='])).toBeNull()
  })
})

describe('update session state file', () => {
  const ud = app.getPath('userData')
  const statePath = join(ud, 'update-session-state.json')

  afterEach(() => {
    clearUpdateSessionState()
  })

  it('сохраняет и читает состояние сессии обновления', () => {
    saveUpdateSessionState({
      oldVersion: '1.0.0',
      targetVersion: '2.0.0',
      releaseUrl: 'https://releases',
      route: '/settings'
    })

    const j = readUpdateSessionState()
    expect(j?.oldVersion).toBe('1.0.0')
    expect(j?.targetVersion).toBe('2.0.0')
    expect(j?.version).toBe(1)
  })

  it('возвращает null для битого JSON', () => {
    clearUpdateSessionState()
    writeFileSync(statePath, '{ not json', 'utf-8')
    expect(readUpdateSessionState()).toBeNull()
  })

  it('clearUpdateSessionState удаляет файл', () => {
    saveUpdateSessionState({
      oldVersion: '1',
      targetVersion: '2',
      releaseUrl: 'u'
    })
    expect(existsSync(statePath)).toBe(true)
    clearUpdateSessionState()
    expect(existsSync(statePath)).toBe(false)
  })
})
