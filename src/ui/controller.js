import { poolService } from '../services/poolService.js';
import { contextService } from '../services/contextService.js';
import { renderPoolList, renderDeletedLogs, renderAnchorLogs } from './render.js';
import { getApiSettings, saveApiSettings } from '../services/apiSettingsService.js';
import { addAnchorLog, getAnchorLogs, subscribeAnchorLogs } from '../services/runtimeLogService.js';

const refs = {
  wrapper: null,
  drawerToggle: null,
  toolbarIcon: null,
  contentPanel: null,
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
  modelOptions: null,
  modelFetchStatus: null,
  anchorLogs: null,
};

let modelFetchTimer = null;

function resolveRefs() {
  refs.wrapper = document.getElementById('revt-wrapper');
  refs.drawerToggle = refs.wrapper?.querySelector('.drawer-toggle') || null;
  refs.toolbarIcon = document.getElementById('revt-toolbar-icon');
  refs.contentPanel = document.getElementById('revt-content-panel');
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
  refs.modelOptions = document.getElementById('revt-model-options');
  refs.modelFetchStatus = document.getElementById('revt-model-fetch-status');
  refs.anchorLogs = document.getElementById('revt-anchor-log-list');
}

function bindDrawerToggle() {
  if (!refs.drawerToggle || !refs.contentPanel) return;

  refs.drawerToggle.onclick = () => {
    const isOpen = refs.contentPanel.classList.contains('openDrawer');

    refs.contentPanel.classList.toggle('openDrawer', !isOpen);
    refs.contentPanel.classList.toggle('closedDrawer', isOpen);

    if (refs.toolbarIcon) {
      refs.toolbarIcon.classList.toggle('openIcon', !isOpen);
      refs.toolbarIcon.classList.toggle('closedIcon', isOpen);
    }
  };
}

function renderModelCandidates(candidates, currentModel) {
  if (!refs.modelOptions) return;
  const list = Array.isArray(candidates) ? candidates : [];
  refs.modelOptions.innerHTML = '';
  for (const name of list) {
    const opt = document.createElement('option');
    opt.value = name;
    refs.modelOptions.appendChild(opt);
  }

  if (refs.modelName && !refs.modelName.value && list.length > 0) {
    refs.modelName.value = currentModel || list[0];
  }
}

function setModelFetchStatus(text, level = 'muted') {
  if (!refs.modelFetchStatus) return;
  refs.modelFetchStatus.textContent = text || '';
  refs.modelFetchStatus.className = `revt-muted revt-status-${level}`;
}

function saveApiForm() {
  const current = getApiSettings();
  const next = {
    ...current,
    apiProvider: String(refs.apiProvider?.value || 'sillytavern_preset').trim(),
    apiUrl: String(refs.apiUrl?.value || '').trim(),
    apiKey: String(refs.apiKey?.value || '').trim(),
    modelName: String(refs.modelName?.value || '').trim(),
  };
  return saveApiSettings(next);
}

async function fetchModelsAndBind(onFetchModels) {
  const api = saveApiForm();
  if (api.apiProvider !== 'direct_openai') {
    addAnchorLog('MODEL_FETCH_SKIP', 'provider!=direct_openai');
    setModelFetchStatus('当前提供商无需自动拉取模型', 'muted');
    return;
  }
  if (!api.apiUrl || !api.apiKey) {
    addAnchorLog('MODEL_FETCH_SKIP', 'url/key missing');
    setModelFetchStatus('填写 URL + Key 后会自动拉取模型', 'muted');
    return;
  }

  addAnchorLog('MODEL_FETCH_START', api.apiUrl);
  setModelFetchStatus('正在拉取模型列表...', 'loading');
  try {
    const models = await onFetchModels();
    const next = saveApiSettings({
      ...getApiSettings(),
      modelCandidates: models,
      modelName: String(refs.modelName?.value || '').trim() || models[0] || '',
    });
    renderModelCandidates(next.modelCandidates, next.modelName);
    addAnchorLog('MODEL_FETCH_OK', `count=${models.length}`);
    setModelFetchStatus(`已获取 ${models.length} 个模型`, 'ok');
  } catch (error) {
    addAnchorLog('MODEL_FETCH_FAIL', error?.message || 'unknown');
    setModelFetchStatus(error?.message || '拉取模型失败，请手动填写', 'warn');
  }
}

function scheduleFetchModels(onFetchModels, delayMs = 700) {
  if (modelFetchTimer) clearTimeout(modelFetchTimer);
  modelFetchTimer = setTimeout(() => {
    fetchModelsAndBind(onFetchModels);
  }, delayMs);
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
  renderModelCandidates(api.modelCandidates || [], api.modelName || '');
  if ((api.modelCandidates || []).length > 0) {
    setModelFetchStatus(`已缓存 ${(api.modelCandidates || []).length} 个模型`, 'ok');
  } else {
    setModelFetchStatus('填写 URL + Key 后会自动拉取模型', 'muted');
  }

  renderPoolList(refs.list, refs.empty, pool);
  renderDeletedLogs(refs.logs, logs);
  renderAnchorLogs(refs.anchorLogs, getAnchorLogs());
}

export function mountUiHandlers({ onDeleteEvent, onGenerateIfEmpty, onApiTest, onFetchModels }) {
  resolveRefs();
  bindDrawerToggle();
  refreshUi();
  subscribeAnchorLogs(() => {
    renderAnchorLogs(refs.anchorLogs, getAnchorLogs());
  });

  document.getElementById('revt-refresh')?.addEventListener('click', () => refreshUi());

  document.getElementById('revt-save-pref')?.addEventListener('click', () => {
    const chatId = contextService.getChatId();
    poolService.savePreference(chatId, refs.preference?.value || '');
    if (typeof toastr !== 'undefined') toastr.success('偏好已保存', '随机事件池');
  });

  document.getElementById('revt-save-api')?.addEventListener('click', () => {
    saveApiForm();
    if (typeof toastr !== 'undefined') toastr.success('API设置已保存', '随机事件池');
  });

  document.getElementById('revt-fetch-models')?.addEventListener('click', async () => {
    await fetchModelsAndBind(onFetchModels);
  });

  refs.apiProvider?.addEventListener('change', () => {
    saveApiForm();
    scheduleFetchModels(onFetchModels, 100);
  });

  refs.apiUrl?.addEventListener('blur', () => scheduleFetchModels(onFetchModels));
  refs.apiKey?.addEventListener('blur', () => scheduleFetchModels(onFetchModels));

  refs.modelName?.addEventListener('change', () => saveApiForm());

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
