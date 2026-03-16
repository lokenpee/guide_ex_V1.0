import { RULES } from './src/constants.js';
import { appManager } from './src/core/appManager.js';
import { consumeUserSendFlag, markUserSend, runtimeState } from './src/core/runtimeState.js';
import { contextService } from './src/services/contextService.js';
import { generateEventsByAI, testAIGenerationConnection } from './src/services/aiGenerationService.js';
import { getPreciseExternalContext } from './src/services/dataSourceService.js';
import { generateRuleBasedEvents } from './src/services/eventGeneratorService.js';
import { buildInjectionPrompt, injectPromptToChat } from './src/services/injectionService.js';
import { poolService } from './src/services/poolService.js';
import { validatePool } from './src/services/validatorService.js';
import { refreshUi, mountUiHandlers } from './src/ui/controller.js';

function getExtensionFolderName() {
  const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(import.meta.url);
  return match?.[1] ? decodeURIComponent(match[1]) : 'guide_ex_V1.0';
}

function shouldSkipPromptReady(eventData) {
  if (!eventData || typeof eventData !== 'object' || eventData.dryRun) return true;

  const type = eventData.type || eventData.generationType || '';
  const params = eventData.params || eventData.generationParams || {};
  const isQuiet = type === 'quiet' || params.quiet_prompt || params.quiet || params.is_quiet;
  const isAuto = params.automatic_trigger || params.background || params.is_background;
  if (isQuiet || isAuto) return true;

  const isRegen = type === 'regenerate' || type === 'swipe' || params.regenerate || params.swipe;
  const recentUserSend = runtimeState.lastUserSendAt > 0
    && (Date.now() - runtimeState.lastUserSendAt) < RULES.RECENT_USER_SEND_WINDOW_MS;

  return !runtimeState.pendingUserSend && !recentUserSend && !isRegen;
}

function removeEventById(eventId) {
  const chatId = contextService.getChatId();
  const pool = poolService.loadPool(chatId);
  const next = pool.filter((x) => x.id !== eventId);
  if (next.length !== pool.length) {
    poolService.savePool(chatId, next);
    poolService.appendDeletedHistory(chatId, [{ id: eventId, title: '用户删除', reason: '用户删除' }]);
    if (typeof toastr !== 'undefined') toastr.success('事件已删除', '随机事件池');
  }
}

async function generateIfPoolEmpty() {
  const chatId = contextService.getChatId();
  const pool = poolService.loadPool(chatId);
  if (pool.length > 0) {
    if (typeof toastr !== 'undefined') toastr.info('事件池非空，不补充', '随机事件池');
    return;
  }

  const { userText, aiText } = contextService.getLastExchange();
  const external = await getPreciseExternalContext();
  const source = {
    preference: poolService.loadPreference(chatId),
    outline: external.outline,
    worldbook: external.worldbook,
    lastUser: userText,
    lastAi: aiText,
  };

  const generatedByAi = await generateEventsByAI(source);
  const generated = generatedByAi.length > 0 ? generatedByAi : generateRuleBasedEvents(source);

  const deduped = poolService.dedupeByTitle(generated);
  poolService.savePool(chatId, deduped.output);
  if (deduped.removed.length) {
    poolService.appendDeletedHistory(chatId, deduped.removed);
  }
  if (typeof toastr !== 'undefined') toastr.success(`已生成 ${deduped.output.length} 条事件`, '随机事件池');
}

async function onPromptReady(eventData) {
  if (!poolService.loadEnabled()) return;
  if (shouldSkipPromptReady(eventData)) return;
  consumeUserSendFlag();

  const chatId = contextService.getChatId();
  let pool = poolService.loadPool(chatId);
  const { userText, aiText } = contextService.getLastExchange();
  const external = await getPreciseExternalContext();

  const validated = validatePool(pool, { lastUser: userText, lastAi: aiText });
  pool = validated.keep;
  if (validated.removed.length > 0) {
    poolService.appendDeletedHistory(chatId, validated.removed);
    console.info('[REVT] 自动清理事件:', validated.removed);
  }

  const deduped = poolService.dedupeByTitle(pool);
  pool = deduped.output;
  if (deduped.removed.length > 0) {
    poolService.appendDeletedHistory(chatId, deduped.removed);
  }

  if (pool.length === 0) {
    const source = {
      preference: poolService.loadPreference(chatId),
      outline: external.outline,
      worldbook: external.worldbook,
      lastUser: userText,
      lastAi: aiText,
    };
    const generatedByAi = await generateEventsByAI(source);
    const generated = generatedByAi.length > 0 ? generatedByAi : generateRuleBasedEvents(source);
    pool = poolService.dedupeByTitle(generated).output;
  }

  poolService.savePool(chatId, pool);
  refreshUi();

  const prompt = buildInjectionPrompt({
    preference: poolService.loadPreference(chatId),
    worldbook: external.worldbook,
    outline: external.outline,
    lastUser: userText,
    lastAi: aiText,
    pool,
  });

  injectPromptToChat(eventData, prompt);
}

async function setupUi() {
  const extensionFolder = getExtensionFolderName();
  const html = await appManager.renderExtensionTemplateAsync(`third-party/${extensionFolder}`, 'drawer-component');
  $('#extensions_settings2').append(html);

  mountUiHandlers({
    onDeleteEvent: removeEventById,
    onGenerateIfEmpty: generateIfPoolEmpty,
    onApiTest: testAIGenerationConnection,
  });
}

function onGenerationStarted(type, params) {
  if (type === 'regenerate' || type === 'swipe' || params?.regenerate || params?.swipe) {
    markUserSend();
  }
}

appManager.eventSource.on(appManager.event_types.APP_READY, async () => {
  await setupUi();

  appManager.eventSource.on(appManager.event_types.MESSAGE_SENT, () => markUserSend());
  appManager.eventSource.on(appManager.event_types.GENERATION_STARTED, onGenerationStarted);
  appManager.eventSource.on(appManager.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  appManager.eventSource.on(appManager.event_types.CHAT_CHANGED, () => setTimeout(() => refreshUi(), 0));

  console.info('[REVT] 随机事件池插件已启动');
});
