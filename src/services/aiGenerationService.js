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
      .slice(0, RULES.GENERATE_MAX);

    if (events.length < RULES.GENERATE_MIN) {
      return {
        ok: false,
        events: [],
        error: `AI生成事件数量不足，需${RULES.GENERATE_MIN}-${RULES.GENERATE_MAX}条，实际${events.length}条`,
      };
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
    '任务：根据输入生成3-5条“角色行为驱动”的随机事件（明确是谁做了什么）。',
    '要求：',
    '1) 输出必须是JSON数组，不要输出代码块，不要输出额外文字。',
    '2) 必须生成3-5条事件。',
    '3) 每条事件字段必须包含: id,title,event,when,impact,characters,location,requirements,evidence,compatibility_note。',
    '4) when只能是: now|soon|tonight|tomorrow|unknown。impact只能是: low|mid|high。',
    '5) evidence至少2条，且仅允许type: preference|worldbook|outline|last_turn|common_sense。',
    '6) 每条事件必须明确主体：具体人物/身份（世界书人物、路人、或场景对应的可能出现的人：学校-老师、服装店-店员、小区-保安等）。',
    '7) 禁止“主体不明”的事件：不要写“窗外传来争吵声/突然有敲门声/出现异响”这类没有做事者的描述。必须写明谁在做什么（例如：店员听到异响过来询问）。',
    '8) characters必须至少1人，且不得包含玩家/我/主角/你（事件主体不能是玩家本人）。',
    '9) event用一句或两句写清楚：',
    '   - 角色（姓名或身份）+ 动作 + 目的/动机 + 对当前场景的直接影响（轻量、不强制玩家行动）。',
    '10) 玩家意图优先，冲突事件不要生成；不要强制推进或替玩家做决定。',
    '11) evidence的snippet要尽量引用输入里的具体信息（世界书/大纲/上一轮），不要写“更有悬念/常见套路”等空泛理由；只有在输入缺失时才用common_sense。',
    '',
    '输出JSON格式示例（仅作格式参考，内容请按当前上下文生成）:',
    '[',
    '  {',
    '    "id": "evt_xxx",',
    '    "title": "母亲推开房门打断谈话",',
    '    "event": "母亲轻轻推开房间的门，皱眉询问你们刚才的动静是什么。她停在门口观察屋内情况，让当前对话被迫暂停。",',
    '    "when": "now",',
    '    "impact": "mid",',
    '    "characters": ["母亲"],',
    '    "location": "卧室门口",',
    '    "requirements": ["当前场景在室内", "母亲在附近"],',
    '    "evidence": [',
    '      { "type": "last_turn", "snippet": "上一轮母亲在屋外听到了你们的谈话" },',
    '      { "type": "worldbook", "snippet": "母亲性格谨慎，遇到异常会先确认情况" }',
    '    ],',
    '    "compatibility_note": "事件仅制造短暂打断与压力，不替玩家做选择，可由玩家决定如何回应。"',
    '  }',
    ']',
    '',
    `玩家偏好: ${source.preference || '（缺失）'}`,
    `世界书: ${source.worldbook || '（缺失）'}`,
    `剧情大纲: ${source.outline || '（缺失）'}`,
    `玩家上一条: ${source.lastUser || '（缺失）'}`,
    `AI上一条: ${source.lastAi || '（缺失）'}`,
  ];
  return lines.join('\n');
}

function isPlayerLikeName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return (
    n === '我' ||
    n === '玩家' ||
    n === '主角' ||
    n === '你' ||
    n === 'user' ||
    n === 'player' ||
    n === 'protagonist'
  );
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const text = String(raw).trim();
  const candidates = [];

  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    candidates.push(codeBlockMatch[1].trim());
  }

  candidates.push(text);

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (const candidate of uniqueCandidates) {
    const parsed = repairAndParseJsonArray(candidate);
    if (Array.isArray(parsed)) return parsed;
  }

  return null;
}

function repairAndParseJsonArray(jsonString) {
  let repaired = String(jsonString || '').trim();
  if (!repaired) return null;

  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      if (!(error instanceof SyntaxError)) return null;

      const cleaned = repaired
        .replace(/^\uFEFF/, '')
        .replace(/,\s*([}\]])/g, '$1');

      if (cleaned !== repaired) {
        repaired = cleaned;
        continue;
      }

      const match = String(error.message || '').match(/position (\d+)|at position (\d+)/i);
      const errorPos = match ? parseInt(match[1] || match[2], 10) : -1;
      if (Number.isFinite(errorPos) && errorPos > 0) {
        const quotePos = repaired.lastIndexOf('"', errorPos - 1);
        if (quotePos !== -1) {
          repaired = repaired.slice(0, quotePos) + '\\' + repaired.slice(quotePos);
          continue;
        }
      }

      return null;
    }
  }

  return null;
}

function normalizeEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (!evt.title || !evt.event) return null;

  const rawCharacters = Array.isArray(evt.characters) ? evt.characters : [];
  const characters = rawCharacters
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .filter((c) => !isPlayerLikeName(c))
    .slice(0, 6);

  if (characters.length === 0) return null;

  const allowedEvidenceTypes = new Set([
    'preference',
    'worldbook',
    'outline',
    'last_turn',
    'common_sense',
  ]);

  const evidence = (Array.isArray(evt.evidence) ? evt.evidence : [])
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const type = String(e.type || '').trim();
      const snippet = String(e.snippet || '').trim();
      if (!allowedEvidenceTypes.has(type)) return null;
      if (!snippet) return null;
      return { type, snippet: snippet.slice(0, 160) };
    })
    .filter(Boolean)
    .slice(0, 4);

  const event = {
    id: evt.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(evt.title).slice(0, 60),
    event: String(evt.event).slice(0, 400),
    when: evt.when || 'soon',
    impact: ['low', 'mid', 'high'].includes(evt.impact) ? evt.impact : 'low',
    characters,
    location: evt.location || 'unknown',
    requirements: Array.isArray(evt.requirements) ? evt.requirements.slice(0, 6) : [],
    evidence,
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
