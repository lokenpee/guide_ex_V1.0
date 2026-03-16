import { poolService } from '../services/poolService.js';
import { contextService } from '../services/contextService.js';
import { renderPoolList, renderDeletedLogs } from './render.js';
import { getApiSettings, saveApiSettings } from '../services/apiSettingsService.js';

const refs = {
  enabled: null,
  preference: null,
  list: null,
  empty: null,
  chatHint: null,
  logs: null,
  apiProvider: null,
  apiUrl: null,
  apiKey: null,
  modelName: null,
};

function resolveRefs() {
  refs.enabled = document.getElementById('revt-enabled');
  refs.preference = document.getElementById('revt-preference');
  refs.list = document.getElementById('revt-list');
  refs.empty = document.getElementById('revt-empty');
  refs.chatHint = document.getElementById('revt-chat-hint');
  refs.logs = document.getElementById('revt-log-list');
  refs.apiProvider = document.getElementById('revt-api-provider');
  refs.apiUrl = document.getElementById('revt-api-url');
  refs.apiKey = document.getElementById('revt-api-key');
  refs.modelName = document.getElementById('revt-model-name');
}

export function refreshUi() {
  const chatId = contextService.getChatId();
  const pool = poolService.loadPool(chatId);
  const logs = poolService.loadDeletedHistory(chatId);

  if (refs.enabled) refs.enabled.checked = poolService.loadEnabled();
  if (refs.preference) refs.preference.value = poolService.loadPreference(chatId);
  if (refs.chatHint) refs.chatHint.textContent = `chat: ${chatId}`;

  const api = getApiSettings();
  if (refs.apiProvider) refs.apiProvider.value = api.apiProvider || 'sillytavern_preset';
  if (refs.apiUrl) refs.apiUrl.value = api.apiUrl || '';
  if (refs.apiKey) refs.apiKey.value = api.apiKey || '';
  if (refs.modelName) refs.modelName.value = api.modelName || '';

  renderPoolList(refs.list, refs.empty, pool);
  renderDeletedLogs(refs.logs, logs);
}

export function mountUiHandlers({ onDeleteEvent, onGenerateIfEmpty, onApiTest }) {
  resolveRefs();
  refreshUi();

  document.getElementById('revt-refresh')?.addEventListener('click', () => refreshUi());

  document.getElementById('revt-save-pref')?.addEventListener('click', () => {
    const chatId = contextService.getChatId();
    poolService.savePreference(chatId, refs.preference?.value || '');
    if (typeof toastr !== 'undefined') toastr.success('偏好已保存', '随机事件池');
  });

  document.getElementById('revt-save-api')?.addEventListener('click', () => {
    const current = getApiSettings();
    const next = {
      ...current,
      apiProvider: String(refs.apiProvider?.value || 'sillytavern_preset').trim(),
      apiUrl: String(refs.apiUrl?.value || '').trim(),
      apiKey: String(refs.apiKey?.value || '').trim(),
      modelName: String(refs.modelName?.value || '').trim(),
    };
    saveApiSettings(next);
    if (typeof toastr !== 'undefined') toastr.success('API设置已保存', '随机事件池');
  });

  document.getElementById('revt-test-api')?.addEventListener('click', async () => {
    try {
      document.getElementById('revt-save-api')?.click();
      const msg = await onApiTest();
      if (typeof toastr !== 'undefined') toastr.success(msg || '连接成功', '随机事件池');
    } catch (error) {
      if (typeof toastr !== 'undefined') {
        toastr.error(error?.message || String(error), '随机事件池 API 测试失败');
      }
    }
  });

  refs.enabled?.addEventListener('change', (e) => {
    poolService.saveEnabled(Boolean(e.target?.checked));
  });

  document.getElementById('revt-generate')?.addEventListener('click', async () => {
    await onGenerateIfEmpty();
    refreshUi();
  });

  refs.list?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('revt-delete')) return;
    const eventId = target.dataset.id;
    if (!eventId) return;
    onDeleteEvent(eventId);
    refreshUi();
  });
}
