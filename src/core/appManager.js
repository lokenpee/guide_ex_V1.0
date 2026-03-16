import { eventSource, event_types, generateRaw } from '/script.js';
import { getContext, renderExtensionTemplateAsync } from '/scripts/extensions.js';

export const appManager = {
  eventSource,
  event_types,
  generateRaw,
  getContext,
  renderExtensionTemplateAsync,
};
