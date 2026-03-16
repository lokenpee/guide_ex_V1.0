import { loadWorldInfo, world_info } from '/scripts/world-info.js';
import { getCharaFilename, onlyUnique } from '/scripts/utils.js';
import { CONTEXT_LIMITS } from '../constants.js';
import { appManager } from '../core/appManager.js';
import { normalizeText, truncateText } from '../utils/text.js';

const contextCache = {
  chatId: '',
  ts: 0,
  value: null,
};
const CONTEXT_CACHE_TTL_MS = 3000;

function getRootWindow() {
  if (typeof window === 'undefined') return null;
  try {
    return window.parent || window;
  } catch {
    return window;
  }
}

function getAutoCardUpdaterApi() {
  const root = getRootWindow();
  return root?.AutoCardUpdaterAPI || null;
}

function findTableByName(data, targetName) {
  if (!data || typeof data !== 'object') return null;
  const keys = Object.keys(data).filter((key) => key.startsWith('sheet_'));
  for (const key of keys) {
    const table = data[key];
    const name = typeof table?.name === 'string' ? table.name.trim() : '';
    if (name === targetName) return table;
  }
  return null;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function tableToText(table, label, limit = null, tail = false) {
  if (!table || !Array.isArray(table.content) || table.content.length < 2) {
    return `## ${label}\n未找到/无数据`;
  }

  const header = Array.isArray(table.content[0]) ? table.content[0] : [];
  const cols = header.slice(1).map((x, i) => normalizeCell(x) || `列${i + 1}`);
  const rowsRaw = table.content.slice(1);
  let rows = rowsRaw;

  if (Number.isFinite(limit) && limit > 0) {
    rows = tail ? rowsRaw.slice(-limit) : rowsRaw.slice(0, limit);
  }

  const lines = [`## ${label}`, `Columns: ${cols.join(', ')}`];
  rows.forEach((row, idx) => {
    const cells = cols.map((c, i) => `${c}: ${normalizeCell(Array.isArray(row) ? row[i + 1] : '') || '（空）'}`);
    lines.push(`- [${idx + 1}] ${cells.join(' | ')}`);
  });

  return lines.join('\n');
}

function getCharacterLorebookNames() {
  const context = appManager.getContext();
  const characters = context?.characters;
  const characterId = context?.characterId;

  if (!characters || characterId === null || characterId === undefined) return [];

  const character = Array.isArray(characters) ? characters[characterId] : characters[characterId];
  if (!character) return [];

  const names = [];
  const primary = character?.data?.extensions?.world;
  if (primary) names.push(String(primary));

  if (Array.isArray(characters)) {
    const idx = characters.indexOf(character);
    if (idx >= 0) {
      const fileName = getCharaFilename(idx);
      const extra = world_info?.charLore?.find((entry) => entry?.name === fileName);
      if (extra && Array.isArray(extra.extraBooks)) {
        names.push(...extra.extraBooks);
      }
    }
  }

  return names.filter(onlyUnique).filter(Boolean);
}

async function buildWorldbookText() {
  try {
    const names = getCharacterLorebookNames();
    if (!names.length) return '';

    const blocks = [];
    for (const name of names) {
      blocks.push(`## 世界书: ${name}`);
      const content = await loadWorldInfo(name);
      const entriesObj = content?.entries || {};
      const entries = Object.entries(entriesObj)
        .map(([id, raw]) => ({
          id,
          enabled: !raw?.disable,
          comment: raw?.comment || '',
          keys: Array.isArray(raw?.key) ? raw.key : [],
          content: raw?.content || '',
        }))
        .filter((e) => e.enabled);

      if (!entries.length) {
        blocks.push('未找到/无数据');
        blocks.push('');
        continue;
      }

      entries.slice(0, CONTEXT_LIMITS.WORLD_ENTRIES_MAX).forEach((e) => {
        const keys = e.keys.length ? ` | Keys: ${e.keys.join(', ')}` : '';
        blocks.push(`- [${e.id}] ${e.comment || '未命名条目'}${keys}`);
        blocks.push(e.content ? e.content.trim() : '（空）');
        blocks.push('');
      });
    }

    return truncateText(blocks.join('\n').trim(), CONTEXT_LIMITS.WORLDBOOK_MAX);
  } catch (error) {
    console.warn('[REVT] 世界书读取失败，回退空文本。', error);
    return '';
  }
}

function buildOutlineFromDatabase() {
  try {
    const api = getAutoCardUpdaterApi();
    if (!api || typeof api.exportTableAsJson !== 'function') return '';

    const data = api.exportTableAsJson();
    if (!data) return '';

    const outlineTable = findTableByName(data, '总体大纲');
    const summaryTable = findTableByName(data, '总结表');

    const outlineText = tableToText(outlineTable, '总体大纲', CONTEXT_LIMITS.DB_OUTLINE_ROWS_MAX);
    const summaryText = tableToText(summaryTable, '总结表（最新）', CONTEXT_LIMITS.DB_SUMMARY_ROWS_MAX, true);

    return truncateText([outlineText, summaryText].join('\n\n'), CONTEXT_LIMITS.OUTLINE_MAX);
  } catch (error) {
    console.warn('[REVT] 数据库大纲读取失败，回退空文本。', error);
    return '';
  }
}

function buildOutlineFromLeader() {
  const context = appManager.getContext();
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const piece = [...chat].reverse().find((m) => m && m.leader);
  if (!piece) return '';

  const leader = piece.leader;
  if (typeof leader === 'string') {
    return normalizeText(leader).slice(0, 1500);
  }

  if (typeof leader === 'object') {
    const summary = leader?.meta?.longTermStorySummary || leader?.meta?.story_summary || '';
    const blueprint = leader?.chapterBlueprint || leader?.blueprint || null;

    const lines = [];
    if (summary) lines.push(`故事摘要: ${summary}`);
    if (blueprint?.title) lines.push(`章节标题: ${blueprint.title}`);
    if (Array.isArray(blueprint?.plot_beats) && blueprint.plot_beats.length) {
      lines.push(`章节节拍: ${blueprint.plot_beats.slice(0, 8).map((b) => b?.physical_event || b?.description || '').filter(Boolean).join('；')}`);
    }

    return normalizeText(lines.join('\n'));
  }

  return '';
}

export async function getPreciseExternalContext() {
  const context = appManager.getContext();
  const chatId = String(context?.chatId || 'no-chat');
  const now = Date.now();

  if (contextCache.value && contextCache.chatId === chatId && (now - contextCache.ts) < CONTEXT_CACHE_TTL_MS) {
    return contextCache.value;
  }

  const chatMetadataOutline = truncateText(
    normalizeText(context?.chatMetadata?.story_outline || context?.chatMetadata?.outline || ''),
    CONTEXT_LIMITS.OUTLINE_MAX,
  );

  const worldbook = await buildWorldbookText();
  const dbOutline = buildOutlineFromDatabase();
  const leaderOutline = buildOutlineFromLeader();

  const outline = truncateText(
    [dbOutline, leaderOutline, chatMetadataOutline].filter(Boolean).join('\n\n'),
    CONTEXT_LIMITS.OUTLINE_MAX,
  );

  const result = {
    worldbook: truncateText(worldbook, CONTEXT_LIMITS.WORLDBOOK_MAX),
    outline,
  };

  contextCache.chatId = chatId;
  contextCache.ts = now;
  contextCache.value = result;
  return result;
}
