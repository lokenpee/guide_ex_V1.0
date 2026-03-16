import { RULES } from '../constants.js';
import { getApiSettings } from './apiSettingsService.js';
import { LLMApiService } from './llmApiService.js';

const llm = new LLMApiService(getApiSettings());

export function updateAIGenerationConfig() {
  llm.updateConfig(getApiSettings());
}

export async function testAIGenerationConnection() {
  updateAIGenerationConfig();
  return llm.testConnection();
}

export async function fetchAIGenerationModels() {
  updateAIGenerationConfig();
  return llm.fetchModelList();
}

export async function generateEventsByAIWithStatus(source) {
  updateAIGenerationConfig();

  const prompt = buildGeneratePrompt(source);
  try {
    const response = await llm.callLLM(prompt);
    const parsed = parseJsonArray(String(response || ''));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, events: [], error: 'AI返回格式无效或为空' };
    }

    const events = parsed
      .map(normalizeEvent)
      .filter(Boolean)
      .slice(0, RULES.POOL_MAX);

    if (events.length === 0) {
      return { ok: false, events: [], error: 'AI返回事件均不合法' };
    }
    return { ok: true, events, error: '' };
  } catch (err) {
    console.warn('[REVT] AI生成事件失败。', err);
    return { ok: false, events: [], error: err?.message || String(err) };
  }
}

function buildGeneratePrompt(source) {
  const lines = [
    '你是随机事件生成器。',
    '任务：根据输入生成3-5条简短、有逻辑、可融入剧情的随机事件。',
    '要求：',
    '1) 输出必须是JSON数组，不要输出代码块，不要输出额外文字。',
    '2) 每条事件字段必须包含: id,title,event,when,impact,characters,location,requirements,evidence,compatibility_note。',
    '3) evidence至少2条，且仅允许type: preference|worldbook|outline|last_turn|common_sense。',
    '4) 玩家意图优先，冲突事件不要生成。',
    '',
    `玩家偏好: ${source.preference || '（缺失）'}`,
    `世界书: ${source.worldbook || '（缺失）'}`,
    `剧情大纲: ${source.outline || '（缺失）'}`,
    `玩家上一条: ${source.lastUser || '（缺失）'}`,
    `AI上一条: ${source.lastAi || '（缺失）'}`,
  ];
  return lines.join('\n');
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== 'string') return null;

  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
  } catch (error) {
    // Fallback to slice parsing.
  }

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) return null;

  try {
    const sliced = raw.slice(start, end + 1);
    const parsed = JSON.parse(sliced);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (!evt.title || !evt.event) return null;

  const event = {
    id: evt.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(evt.title).slice(0, 60),
    event: String(evt.event).slice(0, 400),
    when: evt.when || 'soon',
    impact: ['low', 'mid', 'high'].includes(evt.impact) ? evt.impact : 'low',
    characters: Array.isArray(evt.characters) ? evt.characters.slice(0, 6) : [],
    location: evt.location || 'unknown',
    requirements: Array.isArray(evt.requirements) ? evt.requirements.slice(0, 6) : [],
    evidence: Array.isArray(evt.evidence) ? evt.evidence.slice(0, 4) : [],
    compatibility_note: evt.compatibility_note || '若与玩家意图冲突应忽略',
  };

  if (event.evidence.length < 2) {
    event.evidence.push({ type: 'common_sense', snippet: '依据不足，保守生成' });
  }
  if (event.evidence.length < 2) {
    event.evidence.push({ type: 'common_sense', snippet: '上下文缺失' });
  }

  return event;
}

export async function generateEventsByAI(source) {
  const result = await generateEventsByAIWithStatus(source);
  return result.events;
}
