import { DELETE_REASON, RULES, STORAGE_KEYS } from '../constants.js';
import { storage } from '../utils/storage.js';

function keyOf(prefix, chatId) {
  return `${prefix}${chatId}`;
}

function loadPool(chatId) {
  const list = storage.readJson(keyOf(STORAGE_KEYS.POOL_PREFIX, chatId), []);
  return Array.isArray(list) ? list : [];
}

function savePool(chatId, pool) {
  storage.writeJson(keyOf(STORAGE_KEYS.POOL_PREFIX, chatId), Array.isArray(pool) ? pool : []);
}

function loadPreference(chatId) {
  return storage.readText(keyOf(STORAGE_KEYS.PREFERENCE_PREFIX, chatId), '');
}

function savePreference(chatId, text) {
  storage.writeText(keyOf(STORAGE_KEYS.PREFERENCE_PREFIX, chatId), text || '');
}

function loadEnabled() {
  return storage.readText(STORAGE_KEYS.ENABLED, 'true') !== 'false';
}

function saveEnabled(enabled) {
  storage.writeText(STORAGE_KEYS.ENABLED, String(Boolean(enabled)));
}

function loadDeletedHistory(chatId) {
  const list = storage.readJson(keyOf(STORAGE_KEYS.DELETED_HISTORY_PREFIX, chatId), []);
  return Array.isArray(list) ? list : [];
}

function saveDeletedHistory(chatId, list) {
  storage.writeJson(keyOf(STORAGE_KEYS.DELETED_HISTORY_PREFIX, chatId), Array.isArray(list) ? list : []);
}

function appendDeletedHistory(chatId, rows) {
  const old = loadDeletedHistory(chatId);
  const merged = [...old, ...rows].slice(-RULES.MAX_DELETED_HISTORY);
  saveDeletedHistory(chatId, merged);
}

function dedupeByTitle(pool) {
  const seen = new Set();
  const output = [];
  const removed = [];

  for (const evt of Array.isArray(pool) ? pool : []) {
    const title = String(evt?.title || '').trim();
    if (!title) {
      removed.push({ id: evt?.id || 'unknown', title: '(空标题)', reason: DELETE_REASON.INVALID });
      continue;
    }
    if (seen.has(title)) {
      removed.push({ id: evt?.id || 'unknown', title, reason: DELETE_REASON.DUPLICATE });
      continue;
    }
    seen.add(title);
    output.push(evt);
  }

  return { output: output.slice(0, RULES.POOL_MAX), removed };
}

export const poolService = {
  loadPool,
  savePool,
  loadPreference,
  savePreference,
  loadEnabled,
  saveEnabled,
  loadDeletedHistory,
  appendDeletedHistory,
  dedupeByTitle,
};
