import { RULES } from './src/constants.js';
import { appManager } from './src/core/appManager.js';
import { consumeUserSendFlag, markUserSend, runtimeState } from './src/core/runtimeState.js';
import { contextService } from './src/services/contextService.js';
import { fetchAIGenerationModels, generateEventsByAI, generateEventsByAIWithStatus, testAIGenerationConnection } from './src/services/aiGenerationService.js';
import { getPreciseExternalContext } from './src/services/dataSourceService.js';
import { generateRuleBasedEvents } from './src/services/eventGeneratorService.js';
import { buildInjectionPrompt, injectPromptToChat } from './src/services/injectionService.js';
import { poolService } from './src/services/poolService.js';
import { addAnchorLog } from './src/services/runtimeLogService.js';
import { validatePool } from './src/services/validatorService.js';
import { refreshUi, mountUiHandlers } from './src/ui/controller.js';

function getExtensionFolderName() {
  const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(import.meta.url);
  return match?.[1] ? decodeURIComponent(match[1]) : 'guide_ex_V1.0';
}

const RUNTIME_KEY = '__REVT_RUNTIME_SINGLETON__';

function withTimeout(promise, ms, label = 'timeout') {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function recordFailOpen(reason) {
  runtimeState.failOpenStreak += 1;
  addAnchorLog('FAIL_OPEN', reason);

  if (runtimeState.failOpenStreak >= RULES.FAIL_OPEN_AUTO_PAUSE_THRESHOLD) {
    runtimeState.autoPausedUntil = Date.now() + RULES.FAIL_OPEN_AUTO_PAUSE_MS;
    runtimeState.failOpenStreak = 0;
    addAnchorLog('AUTO_PAUSE', `插件临时熔断 ${Math.round(RULES.FAIL_OPEN_AUTO_PAUSE_MS / 1000)} 秒`);
    if (typeof toastr !== 'undefined') {
      toastr.warning('插件异常过于频繁，已临时停用60秒以保护页面稳定', '随机事件池');
    }
  }
}

function clearFailOpenStreak() {
  runtimeState.failOpenStreak = 0;
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
  addAnchorLog('EVENT_DELETE_CLICK', eventId);
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
  addAnchorLog('POOL_CHECK', '开始检查是否空池生成');
  const chatId = contextService.getChatId();
  const pool = poolService.loadPool(chatId);
  if (pool.length > 0) {
    addAnchorLog('POOL_SKIP_GENERATE', `pool=${pool.length}`);
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
  addAnchorLog('POOL_GENERATED', `count=${generated.length}`);

  const deduped = poolService.dedupeByTitle(generated);
  poolService.savePool(chatId, deduped.output);
  if (deduped.removed.length) {
    poolService.appendDeletedHistory(chatId, deduped.removed);
  }
  if (typeof toastr !== 'undefined') toastr.success(`已生成 ${deduped.output.length} 条事件`, '随机事件池');
}

async function onPromptReady(eventData) {
  try {
    if (Date.now() < runtimeState.autoPausedUntil) {
      addAnchorLog('PROMPT_SKIP', '插件处于临时熔断期');
      return;
    }

    const now = Date.now();
    if (runtimeState.isPromptHandling) {
      addAnchorLog('PROMPT_SKIP', '已有处理进行中');
      return;
    }
    if ((now - runtimeState.lastPromptHandledAt) < RULES.PROMPT_COOLDOWN_MS) {
      addAnchorLog('PROMPT_SKIP', '短时间重复触发');
      return;
    }

    runtimeState.isPromptHandling = true;
    runtimeState.lastPromptHandledAt = now;

    addAnchorLog('PROMPT_READY', '收到生成前回调');
    if (!poolService.loadEnabled()) return;
    if (shouldSkipPromptReady(eventData)) {
      addAnchorLog('PROMPT_SKIP', '事件被判定跳过');
      return;
    }
    consumeUserSendFlag();

    const chatId = contextService.getChatId();
    let pool = poolService.loadPool(chatId);
    const { userText, aiText } = contextService.getLastExchange();
    const external = await withTimeout(
      getPreciseExternalContext(),
      RULES.PROMPT_HANDLER_TIMEOUT_MS,
      `读取上下文超时(${RULES.PROMPT_HANDLER_TIMEOUT_MS}ms)`,
    );

    const validated = validatePool(pool, { lastUser: userText, lastAi: aiText });
    pool = validated.keep;
    if (validated.removed.length > 0) {
      addAnchorLog('POOL_CLEANUP', `removed=${validated.removed.length}`);
      poolService.appendDeletedHistory(chatId, validated.removed);
      console.info('[REVT] 自动清理事件:', validated.removed);
    }

    const deduped = poolService.dedupeByTitle(pool);
    pool = deduped.output;
    if (deduped.removed.length > 0) {
      poolService.appendDeletedHistory(chatId, deduped.removed);
    }

    if (pool.length === 0) {
      addAnchorLog('POOL_EMPTY', '准备生成新事件');
      const source = {
        preference: poolService.loadPreference(chatId),
        outline: external.outline,
        worldbook: external.worldbook,
        lastUser: userText,
        lastAi: aiText,
      };

      let aiResult = { ok: false, events: [], error: '未执行AI生成' };
      try {
        aiResult = await withTimeout(
          generateEventsByAIWithStatus(source),
          RULES.PROMPT_HANDLER_TIMEOUT_MS,
          `AI生成超时(${RULES.PROMPT_HANDLER_TIMEOUT_MS}ms)`,
        );
      } catch (error) {
        aiResult = { ok: false, events: [], error: error?.message || String(error) };
      }

      if (!aiResult.ok) {
        addAnchorLog('AI_FALLBACK', `AI失败，改用规则生成: ${aiResult.error}`);
      }

      const generatedByAi = aiResult.events;
      const generated = generatedByAi.length > 0 ? generatedByAi : generateRuleBasedEvents(source);
      pool = poolService.dedupeByTitle(generated).output;
      addAnchorLog('POOL_FILLED', `count=${pool.length}`);
    }

    poolService.savePool(chatId, pool);
    refreshUi();

    if (!Array.isArray(pool) || pool.length === 0) {
      addAnchorLog('PROMPT_SKIP', '事件池为空，不注入系统提示词');
      return;
    }

    const prompt = buildInjectionPrompt({
      preference: poolService.loadPreference(chatId),
      worldbook: external.worldbook,
      outline: external.outline,
      lastUser: userText,
      lastAi: aiText,
      pool,
    });

    injectPromptToChat(eventData, prompt);
    addAnchorLog('PROMPT_INJECTED', `pool=${pool.length}`);
    clearFailOpenStreak();
  } catch (error) {
    recordFailOpen(`插件异常放行: ${error?.message || String(error)}`);
    console.warn('[REVT] onPromptReady 异常，已放行主流程。', error);
  } finally {
    runtimeState.isPromptHandling = false;
  }
}

async function setupUi() {
  const extensionFolder = getExtensionFolderName();
  addAnchorLog('UI_TEMPLATE_LOAD', extensionFolder);
  const html = await appManager.renderExtensionTemplateAsync(`third-party/${extensionFolder}`, 'drawer-component');
  const topbarAnchor = $('#extensions-settings-button');
  if (topbarAnchor.length > 0) {
    topbarAnchor.after(html);
    addAnchorLog('UI_MOUNTED', 'topbar');
  } else {
    $('#extensions_settings2').append(html);
    addAnchorLog('UI_MOUNTED', 'settings-panel-fallback');
  }

  mountUiHandlers({
    onDeleteEvent: removeEventById,
    onGenerateIfEmpty: generateIfPoolEmpty,
    onApiTest: testAIGenerationConnection,
    onFetchModels: fetchAIGenerationModels,
  });
}

function onGenerationStarted(type, params) {
  if (type === 'regenerate' || type === 'swipe' || params?.regenerate || params?.swipe) {
    markUserSend();
    addAnchorLog('GENERATION_RETRY', type || 'regen');
  }
}

async function onAppReady() {
  addAnchorLog('APP_READY', '插件开始初始化');
  await setupUi();

  appManager.eventSource.off?.(appManager.event_types.MESSAGE_SENT, onMessageSent);
  appManager.eventSource.off?.(appManager.event_types.GENERATION_STARTED, onGenerationStarted);
  appManager.eventSource.off?.(appManager.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  appManager.eventSource.off?.(appManager.event_types.CHAT_CHANGED, onChatChanged);

  appManager.eventSource.on(appManager.event_types.MESSAGE_SENT, onMessageSent);
  appManager.eventSource.on(appManager.event_types.GENERATION_STARTED, onGenerationStarted);
  appManager.eventSource.on(appManager.event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  appManager.eventSource.on(appManager.event_types.CHAT_CHANGED, onChatChanged);

  console.info('[REVT] 随机事件池插件已启动');
  addAnchorLog('READY_DONE', '插件初始化完成');
}

function onMessageSent() {
  markUserSend();
  addAnchorLog('MESSAGE_SENT', '用户发送消息');
}

function onChatChanged() {
  addAnchorLog('CHAT_CHANGED', contextService.getChatId());
  if (runtimeState.chatChangedDebounceTimer) {
    clearTimeout(runtimeState.chatChangedDebounceTimer);
  }
  runtimeState.chatChangedDebounceTimer = setTimeout(() => {
    refreshUi();
  }, RULES.CHAT_CHANGED_DEBOUNCE_MS);
}

const runtime = window[RUNTIME_KEY] || {};
if (runtime.initialized) {
  addAnchorLog('INIT_SKIP', '检测到重复加载，跳过二次初始化');
} else {
  runtime.initialized = true;
  window[RUNTIME_KEY] = runtime;
  appManager.eventSource.off?.(appManager.event_types.APP_READY, onAppReady);
  appManager.eventSource.on(appManager.event_types.APP_READY, onAppReady);
}
