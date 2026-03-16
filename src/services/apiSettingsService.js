import { STORAGE_KEYS } from '../constants.js';
import { storage } from '../utils/storage.js';

const defaultApiSettings = {
  apiProvider: 'sillytavern_preset',
  apiUrl: '',
  apiKey: '',
  modelName: '',
  tavernProfile: '',
  temperature: 0.8,
  maxTokens: 1500,
};

let cached = null;

export function loadApiSettings() {
  if (cached) return cached;
  const raw = storage.readJson(STORAGE_KEYS.API_SETTINGS, {});
  cached = { ...defaultApiSettings, ...(raw || {}) };
  return cached;
}

export function saveApiSettings(settings) {
  cached = { ...defaultApiSettings, ...(settings || {}) };
  storage.writeJson(STORAGE_KEYS.API_SETTINGS, cached);
  return cached;
}

export function getApiSettings() {
  return loadApiSettings();
}

export function getDefaultApiSettings() {
  return { ...defaultApiSettings };
}
