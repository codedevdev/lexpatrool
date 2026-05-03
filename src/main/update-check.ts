/**
 * Обновления: реэкспорт публичного API (реализация в ./updater/).
 */
export {
  checkForUpdates,
  getUpdateRepoLabel,
  isRemoteVersionNewer,
  scheduleStartupUpdateCheck,
  type UpdateCheckResult,
  type UpdateAvailablePayload
} from './updater/checker'
