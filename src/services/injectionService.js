import { CONTEXT_LIMITS } from '../constants.js';
import { truncateText } from '../utils/text.js';

export function buildInjectionPrompt({ preference, worldbook, outline, lastUser, lastAi, pool }) {
  const poolText = (Array.isArray(pool) ? pool : []).map((e, i) => {
    return [
      `${i + 1}. ${e.title}`,
      `- event: ${truncateText(e.event, 180)}`,
      `- when: ${e.when}`,
      `- impact: ${e.impact}`,
      `- requirements: ${truncateText((e.requirements || []).join('；') || '无', 120)}`,
    ].join('\n');
  }).join('\n\n');

  const blocks = [
    '[基础指令块]',
    '你正在接收随机事件池。',
    '规则:',
    '1) 玩家本回合意图永远优先。',
    '2) 最多选择1条事件发生。',
    '3) 冲突事件必须忽略。',
    '4) 不要提及插件、系统提示词、事件池。',
    '',
    '[最新对话块]',
    `玩家上一条: ${truncateText(lastUser || '（缺失）', CONTEXT_LIMITS.LAST_USER_MAX)}`,
    `AI上一条: ${truncateText(lastAi || '（缺失）', CONTEXT_LIMITS.LAST_AI_MAX)}`,
    '',
    '[外部上下文块]',
    `玩家偏好: ${truncateText(preference || '（缺失）', CONTEXT_LIMITS.PREFERENCE_MAX)}`,
    `世界书: ${truncateText(worldbook || '（缺失）', CONTEXT_LIMITS.WORLDBOOK_MAX)}`,
    `剧情大纲: ${truncateText(outline || '（缺失）', CONTEXT_LIMITS.OUTLINE_MAX)}`,
    '',
    '[事件池块]',
    truncateText(poolText || '（空）', 1800),
    '',
    '[输出约束块]',
    '请直接输出正常剧情正文。',
  ];

  return truncateText(blocks.join('\n'), CONTEXT_LIMITS.PROMPT_MAX);
}

export function injectPromptToChat(eventData, prompt) {
  if (!Array.isArray(eventData?.chat)) return;

  for (let i = eventData.chat.length - 1; i >= 0; i--) {
    if (eventData.chat[i]?.is_random_event_script) {
      eventData.chat.splice(i, 1);
    }
  }

  eventData.chat.unshift({
    role: 'system',
    content: prompt,
    is_random_event_script: true,
  });
}
