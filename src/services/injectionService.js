export function buildInjectionPrompt({ preference, worldbook, outline, lastUser, lastAi, pool }) {
  const poolText = (Array.isArray(pool) ? pool : []).map((e, i) => {
    return [
      `${i + 1}. ${e.title}`,
      `- event: ${e.event}`,
      `- when: ${e.when}`,
      `- impact: ${e.impact}`,
      `- requirements: ${(e.requirements || []).join('；') || '无'}`,
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
    `玩家上一条: ${lastUser || '（缺失）'}`,
    `AI上一条: ${lastAi || '（缺失）'}`,
    '',
    '[外部上下文块]',
    `玩家偏好: ${preference || '（缺失）'}`,
    `世界书: ${worldbook || '（缺失）'}`,
    `剧情大纲: ${outline || '（缺失）'}`,
    '',
    '[事件池块]',
    poolText || '（空）',
    '',
    '[输出约束块]',
    '请直接输出正常剧情正文。',
  ];

  return blocks.join('\n');
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
