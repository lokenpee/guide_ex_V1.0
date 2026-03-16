export const EXTENSION_ID = 'random-event-pool';

export const STORAGE_KEYS = {
  ENABLED: `${EXTENSION_ID}:enabled`,
  PREFERENCE_PREFIX: `${EXTENSION_ID}:preference:`,
  POOL_PREFIX: `${EXTENSION_ID}:pool:`,
  DELETED_HISTORY_PREFIX: `${EXTENSION_ID}:deleted-history:`,
  API_SETTINGS: `${EXTENSION_ID}:api-settings`,
};

export const RULES = {
  POOL_MAX: 5,
  GENERATE_MIN: 3,
  GENERATE_MAX: 5,
  OCCURRED_DETECT_KEYWORD_LIMIT: 8,
  MAX_DELETED_HISTORY: 50,
  RECENT_USER_SEND_WINDOW_MS: 45_000,
};

export const DELETE_REASON = {
  USER: '用户删除',
  INVALID: '失效',
  OCCURRED: '已发生',
  CONFLICT: '冲突',
  DUPLICATE: '重复',
};

export const EVIDENCE_TYPE = {
  PREFERENCE: 'preference',
  WORLDBOOK: 'worldbook',
  OUTLINE: 'outline',
  LAST_TURN: 'last_turn',
  COMMON_SENSE: 'common_sense',
};
