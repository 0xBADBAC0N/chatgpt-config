// ==UserScript==
// @name         ChatGPT Config
// @namespace    https://tampermonkey.net/
// @version      5.30
// @description  Make life easier
// @author       0xBADBAC0N
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

const DEFAULT_MESSAGES_TO_KEEP = 20; // Default value
const LOAD_MORE_STEP = 50; // Number of messages added per click
const SHOW_BUTTON_AT_TOP_PX = 120;
const STORAGE_KEY_PREFIX = 'chatgptConfig.keep.';
const LOAD_MORE_BUTTON_ID = 'chatgpt-config-load-more-btn';
const AUTO_CLEANUP_STORAGE_KEY = 'chatgptConfig.autoCleanup';
const WIDER_CHAT_STORAGE_KEY = 'chatgptConfig.widerChat';
const WIDER_CHAT_WIDTH_STORAGE_KEY = 'chatgptConfig.widerChatWidthPercent';
const MINI_PANEL_ID = 'chatgpt-config-mini-panel';
const MINI_PANEL_TOGGLE_ID = 'chatgpt-config-autocleanup-toggle';
const MINI_PANEL_WIDER_CHAT_TOGGLE_ID = 'chatgpt-config-wider-chat-toggle';
const MINI_PANEL_WIDER_CHAT_SLIDER_ID = 'chatgpt-config-wider-chat-slider';
const MINI_PANEL_WIDER_CHAT_VALUE_ID = 'chatgpt-config-wider-chat-value';
const MINI_PANEL_STATUS_ID = 'chatgpt-config-status';
const MINI_PANEL_CLEANUP_BUTTON_ID = 'chatgpt-config-cleanup-button';
const MINI_PANEL_LIMIT_INPUT_ROLE = 'limit-editor';
const STATS_STORAGE_KEY_PREFIX = 'chatgptConfig.stats.';
const MINI_PANEL_METRICS_BOX_ID = 'chatgpt-config-metrics-box';
const MINI_PANEL_METRICS_MEMORY_ID = 'chatgpt-config-metrics-memory';
const MINI_PANEL_METRICS_TRIMMED_ID = 'chatgpt-config-metrics-trimmed';
const MINI_PANEL_HEADER_ID = 'chatgpt-config-header';
const MINI_PANEL_BODY_ID = 'chatgpt-config-body';
const MINI_PANEL_COLLAPSE_BUTTON_ID = 'chatgpt-config-collapse-button';
const PANEL_STATE_STORAGE_KEY = 'chatgptConfig.panelState';
const WIDER_CHAT_STYLE_ID = 'chatgpt-config-wider-chat-style';
const WIDER_CHAT_DEFAULT_WIDTH_PERCENT = 100;
const WIDER_CHAT_MIN_WIDTH_PERCENT = 100;
const WIDER_CHAT_MAX_WIDTH_PERCENT = 180;
const PERIODIC_STATS_REFRESH_MS = 5000;
const DEBUG_LOGS_STORAGE_KEY = 'chatgptConfig.debugLogs';
const DEBUG_LOGS_DEFAULT_ENABLED = false;
const STREAM_FALLBACK_INCREMENT_NODES = 2;

(function() {
  'use strict';

  console.log('[ChatGPT Config] Initializing...');
  let activeScrollElement = null;
  let lastScrollTop = 0;
  let hasUserScrolledUp = false;
  let isDraggingMiniPanel = false;
  let statsRefreshTimer = null;
  let statsRefreshInFlight = false;
  let statsRefreshSeriesToken = 0;
  let lastKnownConversationId = null;
  let lastPeriodicStatsRefreshAt = 0;
  let lastRenderedMetricsSignature = '';
  let snapshotUnavailableConversationId = null;

  function isDebugLogsEnabled() {
    const rawValue = getStoredValue(DEBUG_LOGS_STORAGE_KEY, null);
    return rawValue === null ? DEBUG_LOGS_DEFAULT_ENABLED : rawValue === '1';
  }

  function setDebugLogsEnabled(enabled) {
    // Ignore storage write errors for debug toggles.
    setStoredValue(DEBUG_LOGS_STORAGE_KEY, enabled ? '1' : '0');
  }

  function debugLog(message, payload) {
    if (!isDebugLogsEnabled()) {
      return;
    }

    if (typeof payload === 'undefined') {
      console.log(`[ChatGPT Config][DEBUG] ${message}`);
      return;
    }

    console.log(`[ChatGPT Config][DEBUG] ${message}`, payload);
  }

  function installDebugControls() {
    if (window.__chatgptConfigDebug) {
      return;
    }

    window.__chatgptConfigDebug = {
      enable: () => {
        setDebugLogsEnabled(true);
        console.log('[ChatGPT Config][DEBUG] enabled');
        return true;
      },
      disable: () => {
        setDebugLogsEnabled(false);
        console.log('[ChatGPT Config][DEBUG] disabled');
        return false;
      },
      status: () => {
        const enabled = isDebugLogsEnabled();
        console.log(`[ChatGPT Config][DEBUG] status=${enabled ? 'on' : 'off'}`);
        return enabled;
      }
    };
  }

  installDebugControls();
  debugLog('Debug controls installed', {
    defaultEnabled: DEBUG_LOGS_DEFAULT_ENABLED,
    periodicRefreshMs: PERIODIC_STATS_REFRESH_MS
  });

  function getStoredValue(key, fallback = null, warningMessage = '') {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      if (warningMessage) {
        console.warn(`[ChatGPT Config] ${warningMessage}`, e);
      }
      return fallback;
    }
  }

  function setStoredValue(key, value, warningMessage = '') {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (e) {
      if (warningMessage) {
        console.warn(`[ChatGPT Config] ${warningMessage}`, e);
      }
      return false;
    }
  }

  function parsePositiveInteger(value) {
    const parsedValue = Number.parseInt(String(value || ''), 10);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
    return null;
  }

  function toSafeNonNegativeInt(value) {
    return Math.max(0, Number.parseInt(String(value ?? 0), 10) || 0);
  }

  function applyStyles(element, styles) {
    Object.assign(element.style, styles);
    return element;
  }

  function createStyledElement(tagName, styles = null) {
    const element = document.createElement(tagName);
    if (styles) {
      applyStyles(element, styles);
    }
    return element;
  }

  function getDocumentScrollElement() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function isScrollableElement(element) {
    return Boolean(element && element.scrollHeight > element.clientHeight + 2);
  }

  function getCurrentScrollTop() {
    if (activeScrollElement && activeScrollElement.isConnected) {
      return activeScrollElement.scrollTop;
    }

    const fallback = getDocumentScrollElement();
    return fallback ? fallback.scrollTop : 0;
  }

  function resolveScrollElement(eventTarget) {
    if (!eventTarget || eventTarget === document || eventTarget === window) {
      return getDocumentScrollElement();
    }

    if (eventTarget === document.documentElement || eventTarget === document.body) {
      return getDocumentScrollElement();
    }

    if (eventTarget instanceof Element) {
      return eventTarget;
    }

    return getDocumentScrollElement();
  }

  function getConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  function getConversationIdFromApiUrl(url) {
    if (!url) {
      return null;
    }

    const match = String(url).match(/\/backend-api\/(?:f\/)?conversation\/([a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  function isConversationApiUrl(url) {
    if (!url) {
      return false;
    }

    return /\/backend-api\/(?:f\/)?conversation(?:\/|$|\?)/i.test(String(url));
  }

  function isValidConversationId(value) {
    return typeof value === 'string' && /^[a-z0-9-]+$/i.test(value);
  }

  function extractConversationIdFromText(text) {
    if (!text) {
      return null;
    }

    const match = String(text).match(/"(?:conversation_id|conversationId)"\s*:\s*"([a-z0-9-]+)"/i);
    return match?.[1] || null;
  }

  function getStorageKey() {
    const conversationId = getConversationId();
    return `${STORAGE_KEY_PREFIX}${conversationId || 'global'}`;
  }

  function getGlobalStorageKey() {
    return `${STORAGE_KEY_PREFIX}global`;
  }

  function getEffectiveConversationId(preferredConversationId = null) {
    if (isValidConversationId(preferredConversationId)) {
      return preferredConversationId;
    }

    const conversationIdFromPath = getConversationId();
    if (isValidConversationId(conversationIdFromPath)) {
      return conversationIdFromPath;
    }

    if (isValidConversationId(lastKnownConversationId)) {
      return lastKnownConversationId;
    }

    return null;
  }

  function getStatsStorageKey(preferredConversationId = null) {
    const conversationId = getEffectiveConversationId(preferredConversationId);
    return `${STATS_STORAGE_KEY_PREFIX}${conversationId || 'global'}`;
  }

  function getDefaultPanelState() {
    return {
      manual: false,
      x: null,
      y: null,
      collapsed: false
    };
  }

  function readPanelState() {
    const rawValue = getStoredValue(
      PANEL_STATE_STORAGE_KEY,
      null,
      'Could not read panel state:'
    );
    if (!rawValue) {
      return getDefaultPanelState();
    }

    try {
      const parsed = JSON.parse(rawValue);
      const safeX = Number.isFinite(Number(parsed?.x)) ? Number(parsed.x) : null;
      const safeY = Number.isFinite(Number(parsed?.y)) ? Number(parsed.y) : null;

      return {
        manual: Boolean(parsed?.manual),
        x: safeX,
        y: safeY,
        collapsed: Boolean(parsed?.collapsed)
      };
    } catch (e) {
      console.warn('[ChatGPT Config] Could not read panel state:', e);
      return getDefaultPanelState();
    }
  }

  function writePanelState(nextState) {
    const safeState = {
      manual: Boolean(nextState?.manual),
      x: Number.isFinite(Number(nextState?.x)) ? Number(nextState.x) : null,
      y: Number.isFinite(Number(nextState?.y)) ? Number(nextState.y) : null,
      collapsed: Boolean(nextState?.collapsed)
    };

    setStoredValue(
      PANEL_STATE_STORAGE_KEY,
      JSON.stringify(safeState),
      'Could not write panel state:'
    );
  }

  function setPanelState(patch) {
    const current = readPanelState();
    const next = { ...current, ...patch };
    writePanelState(next);
    return next;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampPanelPosition(x, y, panelElement) {
    const panelWidth = panelElement.offsetWidth || 220;
    const panelHeight = panelElement.offsetHeight || 80;
    const maxX = Math.max(0, window.innerWidth - panelWidth);
    const maxY = Math.max(0, window.innerHeight - panelHeight);

    return {
      x: clamp(Math.round(x), 0, maxX),
      y: clamp(Math.round(y), 0, maxY)
    };
  }

  function getDefaultStats() {
    return {
      trimmed: 0,
      total: 0,
      savedBytes: 0
    };
  }

  function readStats(preferredConversationId = null) {
    const globalStatsKey = `${STATS_STORAGE_KEY_PREFIX}global`;
    const primaryStatsKey = getStatsStorageKey(preferredConversationId);
    const keysToTry = primaryStatsKey === globalStatsKey
      ? [primaryStatsKey]
      : [primaryStatsKey, globalStatsKey];

    for (const storageKey of keysToTry) {
      const rawValue = getStoredValue(storageKey, null, 'Could not read stats:');
      if (!rawValue) {
        continue;
      }

      try {
        const parsed = JSON.parse(rawValue);
        return {
          trimmed: toSafeNonNegativeInt(parsed?.trimmed),
          total: toSafeNonNegativeInt(parsed?.total),
          savedBytes: toSafeNonNegativeInt(parsed?.savedBytes)
        };
      } catch (e) {
        console.warn('[ChatGPT Config] Could not read stats:', e);
      }
    }

    return getDefaultStats();
  }

  function writeStats(stats, preferredConversationId = null) {
    const safeStats = {
      trimmed: toSafeNonNegativeInt(stats?.trimmed),
      total: toSafeNonNegativeInt(stats?.total),
      savedBytes: toSafeNonNegativeInt(stats?.savedBytes)
    };

    setStoredValue(
      getStatsStorageKey(preferredConversationId),
      JSON.stringify(safeStats),
      'Could not write stats:'
    );
  }

  function setStats(trimmed, total, savedBytes, preferredConversationId = null) {
    const previousStats = readStats(preferredConversationId);
    const storageKey = getStatsStorageKey(preferredConversationId);
    debugLog('setStats()', {
      preferredConversationId,
      storageKey,
      previous: previousStats,
      next: { trimmed, total, savedBytes }
    });

    writeStats({ trimmed, total, savedBytes }, preferredConversationId);
    updateMiniPanelState();
  }

  function applyStreamTurnStatsFallback(preferredConversationId = null) {
    const conversationId = getEffectiveConversationId(preferredConversationId);
    if (!conversationId) {
      debugLog('Stream fallback stats skipped: no conversation id');
      return false;
    }

    const previousStats = readStats(conversationId);
    if (!previousStats.total || previousStats.total <= 0) {
      debugLog('Stream fallback stats skipped: no baseline total yet', {
        conversationId,
        previousStats
      });
      return false;
    }

    const increment = Math.max(1, Number(STREAM_FALLBACK_INCREMENT_NODES) || 2);
    const nextTotal = previousStats.total + increment;
    const messagesToKeep = getMessagesToKeep();
    const nextTrimmed = Math.max(0, nextTotal - (messagesToKeep + 1));

    if (nextTotal === previousStats.total && nextTrimmed === previousStats.trimmed) {
      return false;
    }

    debugLog('Applying stream fallback stats increment', {
      conversationId,
      increment,
      previousStats,
      nextStats: {
        trimmed: nextTrimmed,
        total: nextTotal,
        savedBytes: previousStats.savedBytes || 0
      }
    });
    setStats(nextTrimmed, nextTotal, previousStats.savedBytes || 0, conversationId);
    return true;
  }

  function getUtf8ByteLength(text) {
    return new TextEncoder().encode(String(text || '')).length;
  }

  function formatPercent(part, total) {
    if (!total || total <= 0) {
      return '0.0';
    }
    return ((Math.max(0, part) / total) * 100).toFixed(1);
  }

  function isAutoCleanupEnabled() {
    const rawValue = getStoredValue(
      AUTO_CLEANUP_STORAGE_KEY,
      null,
      'Could not read auto-cleanup flag:'
    );
    return rawValue === null ? true : rawValue === '1'; // Default: on
  }

  function setAutoCleanupEnabled(enabled) {
    setStoredValue(
      AUTO_CLEANUP_STORAGE_KEY,
      enabled ? '1' : '0',
      'Could not write auto-cleanup flag:'
    );
  }

  function isWiderChatEnabled() {
    return getStoredValue(
      WIDER_CHAT_STORAGE_KEY,
      '0',
      'Could not read wider-chat flag:'
    ) === '1';
  }

  function setWiderChatEnabled(enabled) {
    setStoredValue(
      WIDER_CHAT_STORAGE_KEY,
      enabled ? '1' : '0',
      'Could not write wider-chat flag:'
    );
  }

  function getWiderChatWidthPercent() {
    const rawValue = getStoredValue(
      WIDER_CHAT_WIDTH_STORAGE_KEY,
      '',
      'Could not read wider-chat width:'
    );
    const parsedValue = Number.parseInt(String(rawValue || ''), 10);
    if (Number.isFinite(parsedValue)) {
      return clamp(parsedValue, WIDER_CHAT_MIN_WIDTH_PERCENT, WIDER_CHAT_MAX_WIDTH_PERCENT);
    }

    return WIDER_CHAT_DEFAULT_WIDTH_PERCENT;
  }

  function setWiderChatWidthPercent(value) {
    const safeValue = clamp(
      Number.parseInt(String(value || ''), 10) || WIDER_CHAT_DEFAULT_WIDTH_PERCENT,
      WIDER_CHAT_MIN_WIDTH_PERCENT,
      WIDER_CHAT_MAX_WIDTH_PERCENT
    );

    setStoredValue(
      WIDER_CHAT_WIDTH_STORAGE_KEY,
      String(safeValue),
      'Could not write wider-chat width:'
    );

    return safeValue;
  }

  function getWiderChatCss() {
    const widthPercent = getWiderChatWidthPercent();
    const widthScale = (widthPercent / 100).toFixed(3);

    return `
main article > div.text-base > div.mx-auto,
main > div.composer-parent article > div.text-base > div.mx-auto {
  max-width: calc(48rem * ${widthScale}) !important;
}

.xl\\:max-w-\\[48rem\\] {
  max-width: calc(48rem * ${widthScale}) !important;
}

div.mx-auto.md\\:max-w-3xl,
div.mx-auto.flex {
  max-width: calc(48rem * ${widthScale}) !important;
}
`.trim();
  }

  function applyWiderChatMode() {
    const isEnabled = isWiderChatEnabled();
    const existingStyle = document.getElementById(WIDER_CHAT_STYLE_ID);

    if (!isEnabled) {
      if (existingStyle) {
        existingStyle.remove();
      }
      return;
    }

    const styleElement = existingStyle || document.createElement('style');
    styleElement.id = WIDER_CHAT_STYLE_ID;
    styleElement.textContent = getWiderChatCss();

    if (!existingStyle) {
      (document.head || document.documentElement).appendChild(styleElement);
    }
  }

  function setMessagesToKeep(value) {
    const safeValue = Math.max(1, Number.parseInt(String(value), 10) || DEFAULT_MESSAGES_TO_KEEP);

    setStoredValue(getGlobalStorageKey(), String(safeValue), 'Could not write message limit:');
    setStoredValue(getStorageKey(), String(safeValue), 'Could not write message limit:');

    return safeValue;
  }

  function readStoredLimit(key) {
    const rawValue = getStoredValue(key, null, 'Could not read localStorage:');
    return parsePositiveInteger(rawValue);
  }

  function getMessagesToKeep() {
    const conversationValue = readStoredLimit(getStorageKey());
    if (conversationValue !== null) {
      return conversationValue;
    }

    const globalValue = readStoredLimit(getGlobalStorageKey());
    if (globalValue !== null) {
      return globalValue;
    }

    return DEFAULT_MESSAGES_TO_KEEP;
  }

  function increaseMessagesToKeep() {
    const nextValue = getMessagesToKeep() + LOAD_MORE_STEP;
    return setMessagesToKeep(nextValue);
  }

  function updateLoadMoreButton() {
    const button = document.getElementById(LOAD_MORE_BUTTON_ID);
    if (!button) {
      return;
    }

    const isConversationPage = Boolean(getConversationId());
    const showButton = isConversationPage
      && hasUserScrolledUp
      && getCurrentScrollTop() <= SHOW_BUTTON_AT_TOP_PX;
    const currentLimit = getMessagesToKeep();

    button.style.display = showButton ? 'block' : 'none';
    button.textContent = `Load +${LOAD_MORE_STEP} messages (current: ${currentLimit})`;
    button.title = `Current limit: ${currentLimit}`;
  }

  function handleScroll(event) {
    const scrollElement = resolveScrollElement(event?.target);
    if (!scrollElement) {
      return;
    }

    const documentScrollElement = getDocumentScrollElement();
    const shouldTrackElement =
      scrollElement === documentScrollElement || isScrollableElement(scrollElement);

    if (!shouldTrackElement) {
      return;
    }

    const currentScrollTop = scrollElement.scrollTop;

    if (activeScrollElement !== scrollElement) {
      activeScrollElement = scrollElement;
      lastScrollTop = currentScrollTop;
      updateLoadMoreButton();
      return;
    }

    const isScrollingUp = currentScrollTop < lastScrollTop;
    const isScrollingDown = currentScrollTop > lastScrollTop;

    if (isScrollingDown && currentScrollTop > SHOW_BUTTON_AT_TOP_PX) {
      hasUserScrolledUp = false;
    }

    if (isScrollingUp && lastScrollTop > SHOW_BUTTON_AT_TOP_PX) {
      hasUserScrolledUp = true;
    }

    lastScrollTop = currentScrollTop;
    updateLoadMoreButton();
    updateMiniPanelPosition();
  }

  function findShareButton() {
    const preferredSelectors = [
      'button[aria-label*="Share" i]',
      'button[aria-label*="Teilen" i]',
      'button[data-testid*="share" i]',
      'button[data-testid*="teilen" i]'
    ];

    for (const selector of preferredSelectors) {
      const button = document.querySelector(selector);
      if (button) {
        return button;
      }
    }

    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(button => {
      const text = (button.textContent || '').trim().toLowerCase();
      return text === 'share' || text === 'teilen';
    }) || null;
  }

  function updateMiniPanelPosition() {
    const panel = document.getElementById(MINI_PANEL_ID);
    if (!panel) {
      return;
    }

    if (isDraggingMiniPanel) {
      return;
    }

    const panelState = readPanelState();
    if (
      panelState.manual
      && Number.isFinite(panelState.x)
      && Number.isFinite(panelState.y)
    ) {
      const clamped = clampPanelPosition(panelState.x, panelState.y, panel);
      panel.style.left = `${clamped.x}px`;
      panel.style.top = `${clamped.y}px`;
      panel.style.right = 'auto';

      if (clamped.x !== panelState.x || clamped.y !== panelState.y) {
        setPanelState({ x: clamped.x, y: clamped.y });
      }

      applyMiniPanelCollapsedState();
      return;
    }

    const shareButton = findShareButton();
    if (!shareButton) {
      const panelWidth = panel.offsetWidth || 220;
      const x = Math.max(8, window.innerWidth - panelWidth - 16);
      panel.style.left = `${x}px`;
      panel.style.top = '64px';
      panel.style.right = 'auto';
      applyMiniPanelCollapsedState();
      return;
    }

    const buttonRect = shareButton.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 220;
    const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
    const left = Math.min(maxLeft, Math.max(8, Math.round(buttonRect.right - panelWidth)));

    panel.style.left = `${left}px`;
    panel.style.top = `${Math.round(buttonRect.bottom + 8)}px`;
    panel.style.right = 'auto';
    applyMiniPanelCollapsedState();
  }

  function applyMiniPanelCollapsedState() {
    const panel = document.getElementById(MINI_PANEL_ID);
    const panelBody = document.getElementById(MINI_PANEL_BODY_ID);
    const collapseButton = document.getElementById(MINI_PANEL_COLLAPSE_BUTTON_ID);
    const panelHeader = document.getElementById(MINI_PANEL_HEADER_ID);
    if (!panel || !panelBody || !collapseButton || !panelHeader) {
      return;
    }

    const panelState = readPanelState();
    panel.style.transition = 'opacity 160ms ease';
    panel.style.transform = 'none';

    if (panelState.collapsed) {
      panelBody.style.display = 'none';
      panel.style.opacity = '0.95';
      panelHeader.style.cursor = 'grab';
      collapseButton.title = 'Expand panel';
      collapseButton.textContent = '+';
      return;
    }

    panelBody.style.display = 'flex';
    panel.style.opacity = '1';
    panelHeader.style.cursor = 'grab';
    collapseButton.textContent = '-';
    collapseButton.title = 'Collapse panel';
  }

  function toggleMiniPanelCollapsed() {
    const panel = document.getElementById(MINI_PANEL_ID);
    if (!panel) {
      return;
    }

    const panelState = readPanelState();
    setPanelState({ collapsed: !panelState.collapsed });

    applyMiniPanelCollapsedState();
  }

  function updateMiniPanelState() {
    const panel = document.getElementById(MINI_PANEL_ID);
    if (!panel) {
      return;
    }

    const isConversationPage = Boolean(getConversationId());
    panel.style.display = isConversationPage ? 'flex' : 'none';
    if (!isConversationPage) {
      return;
    }

    const toggle = document.getElementById(MINI_PANEL_TOGGLE_ID);
    const widerChatToggle = document.getElementById(MINI_PANEL_WIDER_CHAT_TOGGLE_ID);
    const widerChatSlider = document.getElementById(MINI_PANEL_WIDER_CHAT_SLIDER_ID);
    const widerChatValue = document.getElementById(MINI_PANEL_WIDER_CHAT_VALUE_ID);
    const status = document.getElementById(MINI_PANEL_STATUS_ID);
    const metricsMemory = document.getElementById(MINI_PANEL_METRICS_MEMORY_ID);
    const metricsTrimmed = document.getElementById(MINI_PANEL_METRICS_TRIMMED_ID);
    const autoCleanupEnabled = isAutoCleanupEnabled();
    const widerChatEnabled = isWiderChatEnabled();
    const widerChatWidthPercent = getWiderChatWidthPercent();
    const currentLimit = getMessagesToKeep();
    const stats = readStats();
    const activeConversationId = getEffectiveConversationId();
    const isEditingLimit = Boolean(status?.querySelector(`input[data-role="${MINI_PANEL_LIMIT_INPUT_ROLE}"]`));

    if (toggle) {
      toggle.checked = autoCleanupEnabled;
    }

    if (widerChatToggle) {
      widerChatToggle.checked = widerChatEnabled;
    }

    if (widerChatSlider) {
      widerChatSlider.value = String(widerChatWidthPercent);
      widerChatSlider.disabled = !widerChatEnabled;
    }

    if (widerChatValue) {
      widerChatValue.textContent = `${widerChatWidthPercent}%`;
      widerChatValue.style.opacity = widerChatEnabled ? '0.95' : '0.55';
    }

    if (status && !isEditingLimit) {
      status.textContent = `Current limit: ${currentLimit}`;
      status.title = 'Double-click to edit';
      status.style.cursor = 'text';
    }

    if (metricsMemory) {
      metricsMemory.textContent = `Memory saved: ${formatPercent(stats.trimmed, stats.total)}%`;
    }

    if (metricsTrimmed) {
      metricsTrimmed.textContent = `Messages trimmed: ${stats.trimmed} / ${stats.total}`;
    }

    const metricsSignature = [
      activeConversationId || 'global',
      stats.trimmed,
      stats.total,
      stats.savedBytes,
      currentLimit
    ].join('|');

    if (metricsSignature !== lastRenderedMetricsSignature) {
      lastRenderedMetricsSignature = metricsSignature;
      debugLog('Mini panel stats render', {
        conversationId: activeConversationId,
        currentLimit,
        stats
      });
    }

    updateMiniPanelPosition();
  }

  function startLimitInlineEdit() {
    const status = document.getElementById(MINI_PANEL_STATUS_ID);
    if (!status || status.querySelector(`input[data-role="${MINI_PANEL_LIMIT_INPUT_ROLE}"]`)) {
      return;
    }

    const currentLimit = getMessagesToKeep();
    const input = createStyledElement('input', {
      width: '100%',
      boxSizing: 'border-box',
      padding: '4px 6px',
      borderRadius: '6px',
      border: '1px solid rgba(255, 255, 255, 0.35)',
      background: 'rgba(17, 24, 39, 0.85)',
      color: '#ffffff',
      fontSize: '11px'
    });
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(currentLimit);
    input.setAttribute('data-role', MINI_PANEL_LIMIT_INPUT_ROLE);

    let isFinalized = false;

    const cancelEdit = () => {
      if (isFinalized) {
        return;
      }
      isFinalized = true;
      updateMiniPanelState();
    };

    const submitEdit = () => {
      if (isFinalized) {
        return;
      }

      const parsed = Number.parseInt(input.value || '', 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        cancelEdit();
        return;
      }

      isFinalized = true;

      const nextLimit = setMessagesToKeep(parsed);
      console.log(`[ChatGPT Config] Limit set to ${nextLimit} via inline edit. Reloading...`);
      status.textContent = 'Applying...';
      window.location.reload();
    };

    status.textContent = '';
    status.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    });

    input.addEventListener('blur', submitEdit);
  }

  function enableMiniPanelDragging(panel, header) {
    let dragState = null;

    function stopDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      isDraggingMiniPanel = false;
      const finalX = dragState.lastX;
      const finalY = dragState.lastY;
      dragState = null;

      if (typeof header.releasePointerCapture === 'function') {
        try {
          header.releasePointerCapture(event.pointerId);
        } catch (e) {
          // Ignore pointer-capture cleanup errors.
        }
      }

      setPanelState({
        manual: true,
        x: finalX,
        y: finalY
      });

      applyMiniPanelCollapsedState();
      updateMiniPanelPosition();
    }

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target.closest(`#${MINI_PANEL_COLLAPSE_BUTTON_ID}`)) {
        return;
      }

      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        lastX: rect.left,
        lastY: rect.top
      };

      isDraggingMiniPanel = true;
      panel.style.right = 'auto';
      panel.style.transform = 'none';
      panel.style.transition = 'none';
      header.style.cursor = 'grabbing';

      if (typeof header.setPointerCapture === 'function') {
        try {
          header.setPointerCapture(event.pointerId);
        } catch (e) {
          // Ignore pointer-capture setup errors.
        }
      }
    });

    header.addEventListener('pointermove', (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      const nextX = dragState.originX + dx;
      const nextY = dragState.originY + dy;
      const clamped = clampPanelPosition(nextX, nextY, panel);

      panel.style.left = `${clamped.x}px`;
      panel.style.top = `${clamped.y}px`;
      panel.style.right = 'auto';
      dragState.lastX = clamped.x;
      dragState.lastY = clamped.y;
    });

    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);
  }

  function createPanelSectionBox() {
    return createStyledElement('div', {
      border: '1px solid rgba(186, 230, 253, 0.22)',
      borderRadius: '8px',
      padding: '8px',
      background: 'rgba(186, 230, 253, 0.06)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });
  }

  function createLabeledCheckboxRow(labelText, inputId, checked, onChange) {
    const row = createStyledElement('label', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      cursor: 'pointer'
    });

    const text = createStyledElement('span', {
      fontWeight: '600'
    });
    text.textContent = labelText;

    const input = createStyledElement('input', {
      cursor: 'pointer'
    });
    input.id = inputId;
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', onChange);

    row.appendChild(text);
    row.appendChild(input);

    return { row, input };
  }

  function mountMiniPanel() {
    if (!document.body || document.getElementById(MINI_PANEL_ID)) {
      return;
    }

    const panel = createStyledElement('div', {
      position: 'fixed',
      zIndex: '2147483647',
      minWidth: '220px',
      maxWidth: '260px',
      padding: '10px',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.25)',
      background: 'rgba(17, 24, 39, 0.62)',
      backdropFilter: 'blur(8px)',
      color: '#ffffff',
      fontSize: '12px',
      boxShadow: '0 8px 22px rgba(0, 0, 0, 0.35)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });
    panel.id = MINI_PANEL_ID;

    const panelHeader = createStyledElement('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      cursor: 'grab',
      touchAction: 'none'
    });
    panelHeader.id = MINI_PANEL_HEADER_ID;

    const headerTitle = createStyledElement('span', {
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.02em',
      opacity: '0.9'
    });
    headerTitle.textContent = 'ChatGPT Config';

    const collapseButton = createStyledElement('button', {
      width: '20px',
      height: '20px',
      border: '1px solid rgba(255, 255, 255, 0.35)',
      borderRadius: '6px',
      background: 'rgba(31, 41, 55, 0.78)',
      color: '#ffffff',
      fontSize: '12px',
      lineHeight: '1',
      cursor: 'pointer'
    });
    collapseButton.id = MINI_PANEL_COLLAPSE_BUTTON_ID;
    collapseButton.type = 'button';
    collapseButton.textContent = '-';

    collapseButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMiniPanelCollapsed();
    });

    panelHeader.appendChild(headerTitle);
    panelHeader.appendChild(collapseButton);

    const panelBody = createStyledElement('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });
    panelBody.id = MINI_PANEL_BODY_ID;

    const controlsBox = createPanelSectionBox();

    const cleanupButton = createStyledElement('button', {
      padding: '8px 10px',
      border: '1px solid rgba(186, 230, 253, 0.3)',
      borderRadius: '8px',
      background: 'rgba(186, 230, 253, 0.1)',
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer'
    });
    cleanupButton.id = MINI_PANEL_CLEANUP_BUTTON_ID;
    cleanupButton.type = 'button';
    cleanupButton.textContent = 'Cleanup history';

    cleanupButton.addEventListener('click', () => {
      const currentLimit = getMessagesToKeep();
      console.log(`[ChatGPT Config] Cleanup requested. Keeping limit at ${currentLimit}. Reloading...`);
      cleanupButton.textContent = 'Cleaning...';
      window.location.reload();
    });

    const { row: toggleRow, input: toggle } = createLabeledCheckboxRow(
      'AutoCleanup',
      MINI_PANEL_TOGGLE_ID,
      isAutoCleanupEnabled(),
      () => {
        const enabled = Boolean(toggle.checked);
        setAutoCleanupEnabled(enabled);

        if (enabled) {
          setMessagesToKeep(DEFAULT_MESSAGES_TO_KEEP);
        }

        console.log(`[ChatGPT Config] AutoCleanup ${enabled ? 'enabled' : 'disabled'}`);
        updateMiniPanelState();
        updateLoadMoreButton();
      }
    );

    const widerChatBox = createPanelSectionBox();

    const { row: widerToggleRow, input: widerToggle } = createLabeledCheckboxRow(
      'Wider Chat',
      MINI_PANEL_WIDER_CHAT_TOGGLE_ID,
      isWiderChatEnabled(),
      () => {
        const enabled = Boolean(widerToggle.checked);
        setWiderChatEnabled(enabled);
        applyWiderChatMode();
        console.log(`[ChatGPT Config] Wider Chat ${enabled ? 'enabled' : 'disabled'}`);
        updateMiniPanelState();
      }
    );

    const widerSliderWrap = createStyledElement('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    });

    const widerSliderHeader = createStyledElement('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px'
    });

    const widerSliderLabel = createStyledElement('span', {
      fontSize: '11px',
      fontWeight: '600',
      opacity: '0.9'
    });
    widerSliderLabel.textContent = 'Width';

    const widerSliderValue = createStyledElement('span', {
      fontSize: '11px',
      opacity: '0.95'
    });
    widerSliderValue.id = MINI_PANEL_WIDER_CHAT_VALUE_ID;
    widerSliderValue.textContent = `${getWiderChatWidthPercent()}%`;

    widerSliderHeader.appendChild(widerSliderLabel);
    widerSliderHeader.appendChild(widerSliderValue);

    const widerSlider = createStyledElement('input', {
      width: '100%',
      cursor: 'pointer',
      accentColor: '#93c5fd'
    });
    widerSlider.id = MINI_PANEL_WIDER_CHAT_SLIDER_ID;
    widerSlider.type = 'range';
    widerSlider.min = String(WIDER_CHAT_MIN_WIDTH_PERCENT);
    widerSlider.max = String(WIDER_CHAT_MAX_WIDTH_PERCENT);
    widerSlider.step = '1';
    widerSlider.value = String(getWiderChatWidthPercent());

    widerSlider.addEventListener('input', () => {
      const nextWidth = setWiderChatWidthPercent(widerSlider.value);
      widerSliderValue.textContent = `${nextWidth}%`;
      applyWiderChatMode();
      console.log(`[ChatGPT Config] Wider Chat width set to ${nextWidth}%`);
    });

    widerSliderWrap.appendChild(widerSliderHeader);
    widerSliderWrap.appendChild(widerSlider);

    const status = createStyledElement('div', {
      opacity: '0.85',
      fontSize: '11px'
    });
    status.id = MINI_PANEL_STATUS_ID;
    status.addEventListener('dblclick', () => {
      startLimitInlineEdit();
    });

    const metricsBox = createStyledElement('div', {
      borderTop: '1px solid rgba(186, 230, 253, 0.2)',
      padding: '6px 0 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    });
    metricsBox.id = MINI_PANEL_METRICS_BOX_ID;

    const metricsMemory = createStyledElement('div', {
      fontSize: '11px',
      lineHeight: '1.35',
      fontWeight: '600'
    });
    metricsMemory.id = MINI_PANEL_METRICS_MEMORY_ID;
    metricsMemory.textContent = 'Memory saved: 0.0%';

    const metricsTrimmed = createStyledElement('div', {
      fontSize: '11px',
      lineHeight: '1.35'
    });
    metricsTrimmed.id = MINI_PANEL_METRICS_TRIMMED_ID;
    metricsTrimmed.textContent = 'Messages trimmed: 0 / 0';

    metricsBox.appendChild(metricsMemory);
    metricsBox.appendChild(metricsTrimmed);

    controlsBox.appendChild(cleanupButton);
    controlsBox.appendChild(toggleRow);
    controlsBox.appendChild(status);
    controlsBox.appendChild(metricsBox);

    widerChatBox.appendChild(widerToggleRow);
    widerChatBox.appendChild(widerSliderWrap);

    panelBody.appendChild(controlsBox);
    panelBody.appendChild(widerChatBox);
    panel.appendChild(panelHeader);
    panel.appendChild(panelBody);
    document.body.appendChild(panel);

    enableMiniPanelDragging(panel, panelHeader);
    updateMiniPanelState();
  }

  function mountLoadMoreButton() {
    if (!document.body || document.getElementById(LOAD_MORE_BUTTON_ID)) {
      return;
    }

    const button = createStyledElement('button', {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '8px 12px',
      border: '1px solid #374151',
      borderRadius: '999px',
      background: '#111827',
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
      display: 'none'
    });
    button.id = LOAD_MORE_BUTTON_ID;
    button.type = 'button';

    button.addEventListener('click', () => {
      const nextValue = increaseMessagesToKeep();
      console.log(`[ChatGPT Config] Increased message limit to ${nextValue}. Reloading...`);
      button.textContent = 'Reloading...';
      window.location.reload();
    });

    document.body.appendChild(button);
    updateLoadMoreButton();
  }

  function initLoadMoreUi() {
    const mount = () => {
      activeScrollElement = getDocumentScrollElement();
      lastScrollTop = getCurrentScrollTop();
      hasUserScrolledUp = false;
      lastKnownConversationId = getConversationId() || null;
      applyWiderChatMode();
      mountLoadMoreButton();
      mountMiniPanel();
      updateLoadMoreButton();
      updateMiniPanelState();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }

    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('popstate', () => {
      lastKnownConversationId = getConversationId() || null;
      snapshotUnavailableConversationId = null;
      applyWiderChatMode();
      updateLoadMoreButton();
      updateMiniPanelState();
    });
    window.addEventListener('resize', updateMiniPanelPosition);

    let lastPathname = window.location.pathname;
    setInterval(() => {
      if (window.location.pathname !== lastPathname) {
        lastPathname = window.location.pathname;
        activeScrollElement = getDocumentScrollElement();
        lastScrollTop = getCurrentScrollTop();
        hasUserScrolledUp = false;
        lastKnownConversationId = getConversationId() || null;
        snapshotUnavailableConversationId = null;
        applyWiderChatMode();
        updateLoadMoreButton();
        updateMiniPanelState();
      }

      const now = Date.now();
      const isConversationVisible =
        Boolean(getConversationId() || lastKnownConversationId)
        && document.visibilityState === 'visible';
      if (isConversationVisible && now - lastPeriodicStatsRefreshAt >= PERIODIC_STATS_REFRESH_MS) {
        lastPeriodicStatsRefreshAt = now;
        debugLog('Periodic stats refresh tick', {
          pathname: window.location.pathname,
          conversationIdFromPath: getConversationId(),
          lastKnownConversationId,
          everyMs: PERIODIC_STATS_REFRESH_MS
        });
        void refreshStatsFromConversation();
      }

      updateMiniPanelPosition();
    }, 500);
  }

  applyWiderChatMode();
  initLoadMoreUi();

  const originalFetch = window.fetch;

  function getRequestMethod(args) {
    const requestLike = args[0];
    const fallbackInit = args[1];

    if (typeof requestLike === 'object' && requestLike?.method) {
      return String(requestLike.method).toUpperCase();
    }

    if (fallbackInit?.method) {
      return String(fallbackInit.method).toUpperCase();
    }

    return 'GET';
  }

  function scheduleStatsRefreshSeries(delaysMs) {
    const delays = Array.isArray(delaysMs) && delaysMs.length ? delaysMs : [700];
    statsRefreshSeriesToken += 1;
    const currentToken = statsRefreshSeriesToken;
    debugLog('scheduleStatsRefreshSeries()', { delays, token: currentToken });

    if (statsRefreshTimer) {
      clearTimeout(statsRefreshTimer);
      statsRefreshTimer = null;
      debugLog('Existing stats refresh timer cleared', { token: currentToken });
    }

    const runAttempt = (index) => {
      if (currentToken !== statsRefreshSeriesToken) {
        debugLog('Stats refresh attempt cancelled by newer token', {
          token: currentToken,
          activeToken: statsRefreshSeriesToken,
          index
        });
        return;
      }

      if (index >= delays.length) {
        debugLog('Stats refresh series completed', { token: currentToken });
        return;
      }

      const delay = Math.max(0, Number(delays[index]) || 0);
      statsRefreshTimer = window.setTimeout(async () => {
        statsRefreshTimer = null;

        if (currentToken !== statsRefreshSeriesToken) {
          debugLog('Stats refresh timeout cancelled by newer token', {
            token: currentToken,
            activeToken: statsRefreshSeriesToken,
            index
          });
          return;
        }

        debugLog('Stats refresh attempt firing', {
          token: currentToken,
          index,
          delay
        });
        const success = await refreshStatsFromConversation();
        debugLog('Stats refresh attempt result', {
          token: currentToken,
          index,
          success
        });
        runAttempt(index + 1);
      }, delay);
    };

    runAttempt(0);
  }

  async function refreshStatsFromConversation() {
    if (statsRefreshInFlight) {
      debugLog('refreshStatsFromConversation skipped: already in flight');
      return false;
    }

    const conversationId = getConversationId() || lastKnownConversationId;
    if (!conversationId) {
      debugLog('refreshStatsFromConversation skipped: no conversation id');
      return false;
    }

    if (snapshotUnavailableConversationId === conversationId) {
      debugLog('refreshStatsFromConversation skipped: snapshot endpoint unavailable for conversation', {
        conversationId
      });
      return false;
    }

    statsRefreshInFlight = true;
    debugLog('refreshStatsFromConversation started', {
      conversationIdFromPath: getConversationId(),
      lastKnownConversationId,
      effectiveConversationId: conversationId
    });

    try {
      // Try both known conversation endpoints and compute stats directly from JSON mapping.
      const candidateUrls = [
        `/backend-api/conversation/${conversationId}`,
        `/backend-api/f/conversation/${conversationId}`
      ];

      let lastError = null;
      let allCandidates404 = true;

      for (const candidateUrl of candidateUrls) {
        try {
          debugLog('refreshStats candidate request', { candidateUrl });
          const snapshotResponse = await originalFetch.call(window, candidateUrl, {
            method: 'GET',
            cache: 'no-store'
          });

          debugLog('refreshStats candidate response', {
            candidateUrl,
            status: snapshotResponse?.status,
            ok: snapshotResponse?.ok
          });

          if (!snapshotResponse?.ok) {
            if ((snapshotResponse?.status || 0) !== 404) {
              allCandidates404 = false;
            }
            lastError = new Error(`HTTP ${snapshotResponse?.status || 'unknown'}`);
            continue;
          }

          allCandidates404 = false;

          const contentType = (snapshotResponse.headers.get('content-type') || '').toLowerCase();
          debugLog('refreshStats candidate content-type', {
            candidateUrl,
            contentType
          });

          if (!contentType.includes('application/json')) {
            lastError = new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
            continue;
          }

          const rawText = await snapshotResponse.text();
          const json = JSON.parse(rawText);
          if (!json?.mapping || typeof json.mapping !== 'object') {
            lastError = new Error('Snapshot JSON has no mapping');
            continue;
          }

          const allKeys = Object.keys(json.mapping);
          const messagesToKeep = getMessagesToKeep();
          const keptApprox = Math.min(allKeys.length, messagesToKeep + 1);
          const trimmedApprox = Math.max(0, allKeys.length - keptApprox);
          const responseConversationId = isValidConversationId(json?.conversation_id)
            ? json.conversation_id
            : conversationId;
          const previousStats = readStats(responseConversationId);

          debugLog('refreshStats mapping snapshot', {
            candidateUrl,
            responseConversationId,
            allKeys: allKeys.length,
            messagesToKeep,
            keptApprox,
            trimmedApprox,
            previousStats
          });

          if (previousStats.total !== allKeys.length || previousStats.trimmed !== trimmedApprox) {
            const previousSavedBytes = previousStats.savedBytes || 0;
            setStats(trimmedApprox, allKeys.length, previousSavedBytes, responseConversationId);
          } else {
            debugLog('refreshStats no stat change detected', {
              responseConversationId,
              total: allKeys.length,
              trimmedApprox
            });
          }

          debugLog('refreshStats succeeded', { candidateUrl, responseConversationId });
          snapshotUnavailableConversationId = null;
          return true;
        } catch (e) {
          allCandidates404 = false;
          debugLog('refreshStats candidate error', {
            candidateUrl,
            message: e?.message || String(e)
          });
          lastError = e;
        }
      }

      if (lastError) {
        if (allCandidates404) {
          snapshotUnavailableConversationId = conversationId;
          debugLog('All stats snapshot endpoints returned 404; disabling snapshot refresh for conversation', {
            conversationId
          });
        } else {
          console.warn('[ChatGPT Config] Stats refresh failed:', lastError);
        }
      }

      return false;
    } catch (e) {
      console.warn('[ChatGPT Config] Stats refresh failed:', e);
      return false;
    } finally {
      statsRefreshInFlight = false;
      debugLog('refreshStatsFromConversation finished');
    }
  }

  function watchStreamingCompletion(response) {
    debugLog('watchStreamingCompletion started', {
      status: response?.status,
      contentType: response?.headers?.get?.('content-type') || ''
    });

    // Early fallback refresh in case the stream does not close quickly.
    scheduleStatsRefreshSeries([1200, 3200, 6500]);

    const cloned = response.clone();
    const reader = cloned.body?.getReader?.();

    if (!reader) {
      debugLog('watchStreamingCompletion: no stream reader available, fallback refresh only');
      scheduleStatsRefreshSeries([900, 2200, 4500]);
      return;
    }

    (async () => {
      const decoder = new TextDecoder();
      let streamBuffer = '';
      let hasScheduledDoneRefresh = false;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (value) {
            streamBuffer += decoder.decode(value, { stream: !done });
            if (streamBuffer.length > 120000) {
              streamBuffer = streamBuffer.slice(-80000);
            }

            const conversationMatch = streamBuffer.match(
              /"(?:conversation_id|conversationId)"\s*:\s*"([a-z0-9-]+)"/i
            );
            if (conversationMatch?.[1]) {
              const previousConversationId = lastKnownConversationId;
              lastKnownConversationId = conversationMatch[1];
              if (previousConversationId !== lastKnownConversationId) {
                debugLog('watchStreamingCompletion discovered conversation id', {
                  previousConversationId,
                  lastKnownConversationId
                });
              }
            }

            if (!hasScheduledDoneRefresh && streamBuffer.includes('[DONE]')) {
              hasScheduledDoneRefresh = true;
              debugLog('watchStreamingCompletion detected [DONE], scheduling refresh series');
              applyStreamTurnStatsFallback(lastKnownConversationId);
              scheduleStatsRefreshSeries([300, 1400, 3200]);
            }
          }

          if (done) {
            break;
          }
        }
      } catch (e) {
        console.warn('[ChatGPT Config] Stream watch failed:', e);
      } finally {
        if (!hasScheduledDoneRefresh) {
          // Multiple attempts because backend state can lag shortly after stream completion.
          debugLog('watchStreamingCompletion ended without [DONE], scheduling fallback series');
          scheduleStatsRefreshSeries([450, 1800, 4200]);
        }
        debugLog('watchStreamingCompletion finished');
      }
    })();
  }

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const requestMethod = getRequestMethod(args);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isStreamingResponse = contentType.includes('text/event-stream');
    const isBackendApiRequest = Boolean(url && url.includes('/backend-api/'));
    const isConversationLikeRequest = Boolean(url && /\/backend-api\/.*conversation/i.test(String(url)));
    const isConversationRequest = isConversationApiUrl(url);
    const conversationIdFromUrl = getConversationIdFromApiUrl(url);

    if (isBackendApiRequest) {
      debugLog('fetch hook (backend-api response)', {
        url,
        requestMethod,
        status: response?.status,
        contentType,
        isStreamingResponse,
        isConversationRequest,
        isConversationLikeRequest
      });
    }

    if (conversationIdFromUrl) {
      const previousConversationId = lastKnownConversationId;
      lastKnownConversationId = conversationIdFromUrl;
      if (previousConversationId !== lastKnownConversationId) {
        debugLog('Conversation id from URL', {
          previousConversationId,
          lastKnownConversationId,
          url
        });
      }
    }

    if (!conversationIdFromUrl && isBackendApiRequest && contentType.includes('application/json')) {
      try {
        const bodyText = await response.clone().text();
        const conversationIdFromBody = extractConversationIdFromText(bodyText);
        if (isValidConversationId(conversationIdFromBody)) {
          const previousConversationId = lastKnownConversationId;
          lastKnownConversationId = conversationIdFromBody;
          if (previousConversationId !== lastKnownConversationId) {
            debugLog('Conversation id from response body', {
              previousConversationId,
              lastKnownConversationId,
              url
            });
          }
        }
      } catch (e) {
        // Ignore JSON body read failures for conversation-id discovery.
        debugLog('Conversation id body extraction failed', {
          url,
          message: e?.message || String(e)
        });
      }
    }

    if (isBackendApiRequest && isStreamingResponse) {
      console.log('[ChatGPT Config] Streaming response detected. Watching for completion.');
      watchStreamingCompletion(response);
    }

    // Some prompt/response flows do not hit /conversation directly.
    // Run a fallback refresh series after non-GET backend calls as safety net.
    if (
      isBackendApiRequest
      && isConversationLikeRequest
      && requestMethod !== 'GET'
      && !isStreamingResponse
      && !isConversationRequest
    ) {
      debugLog('Fallback refresh series scheduled for non-conversation backend call', {
        url,
        requestMethod
      });
      scheduleStatsRefreshSeries([1200, 3200, 6200]);
    }

    if (isConversationRequest) {
      const skipCleanupForRequest = requestMethod !== 'GET';
      debugLog('Conversation request detected', {
        url,
        requestMethod,
        skipCleanupForRequest,
        isStreamingResponse
      });

      if (isStreamingResponse || skipCleanupForRequest) {
        if (skipCleanupForRequest && !isStreamingResponse) {
          // For non-GET conversation requests, try a short refresh series.
          debugLog('Non-GET conversation request, scheduling stats refresh series', { url });
          scheduleStatsRefreshSeries([900, 2600]);
        }
        debugLog('Conversation request returned without cleanup', {
          url,
          reason: isStreamingResponse ? 'streaming' : 'non-get'
        });
        return response;
      }

      console.log('[ChatGPT Config] Intercepted:', url);

      try {
        const clonedResponse = response.clone();
        const text = await clonedResponse.text();
        const originalBytes = getUtf8ByteLength(text);
        const json = JSON.parse(text);
        const responseConversationId = isValidConversationId(conversationIdFromUrl)
          ? conversationIdFromUrl
          : (isValidConversationId(json?.conversation_id) ? json.conversation_id : null);

        debugLog('Conversation response parsed', {
          url,
          responseConversationId,
          currentNode: json?.current_node || null
        });

        if (responseConversationId) {
          lastKnownConversationId = responseConversationId;
        }

        if (json.mapping && typeof json.mapping === 'object') {
          const allKeys = Object.keys(json.mapping);
          const messagesToKeep = getMessagesToKeep();
          debugLog('Conversation mapping received', {
            responseConversationId,
            allKeys: allKeys.length,
            messagesToKeep
          });
          console.log('[ChatGPT Config] Original keys:', allKeys.length);
          console.log(`[ChatGPT Config] Active limit: ${messagesToKeep}`);
          setStats(0, allKeys.length, 0, responseConversationId);

          if (allKeys.length > messagesToKeep + 1) { // Root + N messages
            const mapping = json.mapping;
            const currentNodeKey = mapping[json.current_node] ? json.current_node : null;
            const pathToCurrent = [];
            let rootKey = null;

            if (currentNodeKey) {
              const visited = new Set();
              let cursor = currentNodeKey;

              // Follow parent pointers from current node up to root.
              while (cursor && mapping[cursor] && !visited.has(cursor)) {
                pathToCurrent.push(cursor);
                visited.add(cursor);
                cursor = mapping[cursor].parent;
              }

              pathToCurrent.reverse();
            }

            if (pathToCurrent.length) {
              rootKey = pathToCurrent[0];
            }

            if (!rootKey) {
              for (const key of allKeys) {
                if (!mapping[key].parent) {
                  rootKey = key;
                  break;
                }
              }
            }

            if (!rootKey) {
              console.warn('[ChatGPT Config] No root found');
              debugLog('Cleanup aborted: no root node found', {
                responseConversationId,
                allKeys: allKeys.length
              });
              return response;
            }

            // Fallback if current node path is unavailable.
            if (!pathToCurrent.length) {
              pathToCurrent.push(rootKey);

              const fallbackMessages = allKeys
                .filter(key => key !== rootKey && mapping[key]?.message)
                .sort((a, b) => {
                  const aTime = mapping[a]?.message?.create_time || 0;
                  const bTime = mapping[b]?.message?.create_time || 0;
                  return aTime - bTime;
                })
                .slice(-messagesToKeep);

              pathToCurrent.push(...fallbackMessages);
            }

            const messageKeysOnPath = pathToCurrent.filter(key => {
              if (key === rootKey) {
                return false;
              }
              const node = mapping[key];
              return Boolean(node?.message);
            });

            const lastMessageKeys = messageKeysOnPath.slice(-messagesToKeep);
            console.log(`[ChatGPT Config] Last ${messagesToKeep} messages:`, lastMessageKeys);

            let firstKeepIndex = 1;
            if (lastMessageKeys.length) {
              const index = pathToCurrent.indexOf(lastMessageKeys[0]);
              firstKeepIndex = index > 0 ? index : 1;
            } else if (pathToCurrent.length > 1) {
              firstKeepIndex = Math.max(1, pathToCurrent.length - messagesToKeep);
            }

            console.log(
              `[ChatGPT Config] Path nodes: ${pathToCurrent.length}, message nodes: ${messageKeysOnPath.length}, keepStart: ${firstKeepIndex}`
            );

            const nodesToKeepOrdered = [rootKey, ...pathToCurrent.slice(firstKeepIndex)]
              .filter((key, index, arr) => key && mapping[key] && arr.indexOf(key) === index);
            const nodesToKeepSet = new Set(nodesToKeepOrdered);

            console.log('[ChatGPT Config] Nodes to keep:', nodesToKeepOrdered.length);

            // Build new mapping while preserving a valid parent chain.
            const newMapping = {};

            nodesToKeepOrdered.forEach(key => {
              newMapping[key] = {
                ...mapping[key],
                children: []
              };
            });

            nodesToKeepOrdered.forEach((key, index) => {
              if (index === 0) {
                newMapping[key].parent = null;
                return;
              }

              let parentKey = mapping[key].parent;
              if (!parentKey || !nodesToKeepSet.has(parentKey)) {
                parentKey = rootKey;
              }

              newMapping[key].parent = parentKey;
              if (newMapping[parentKey]) {
                newMapping[parentKey].children.push(key);
              }
            });

            if (!newMapping[json.current_node]) {
              json.current_node = nodesToKeepOrdered[nodesToKeepOrdered.length - 1] || rootKey;
            }

            json.mapping = newMapping;
            const keptCount = Object.keys(newMapping).length;
            const trimmedCount = Math.max(0, allKeys.length - keptCount);
            debugLog('Conversation cleanup result', {
              responseConversationId,
              allKeys: allKeys.length,
              keptCount,
              trimmedCount
            });
            console.log('[ChatGPT Config] Trimmed from', allKeys.length, 'to', keptCount);

            const modifiedText = JSON.stringify(json);
            const savedBytes = Math.max(0, originalBytes - getUtf8ByteLength(modifiedText));
            setStats(trimmedCount, allKeys.length, savedBytes, responseConversationId);

            return new Response(modifiedText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }

          debugLog('Conversation cleanup skipped: mapping already below threshold', {
            responseConversationId,
            allKeys: allKeys.length,
            threshold: messagesToKeep + 1
          });
        }
      } catch (e) {
        console.error('[ChatGPT Config] Error:', e);
        debugLog('Conversation intercept error', {
          url,
          message: e?.message || String(e)
        });
      }
    }

    return response;
  };

  console.log('[ChatGPT Config] Installed');
})();

