(function attachBackgroundStep6(root, factory) {
  root.MultiPageBackgroundStep6 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep6Module() {
  const DEFAULT_REGISTRATION_SUCCESS_WAIT_MS = 4000;
  const SESSION_EXPORT_READY_TIMEOUT_MS = 90000;
  const SESSION_EXPORT_READY_RETRY_DELAY_MS = 2500;
  const SESSION_JSON_HELPER_SAVE_ATTEMPTS = 3;
  const SESSION_JSON_HELPER_SAVE_RETRY_DELAY_MS = 1200;
  const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 180000;
  const OAUTH_CALLBACK_READY_TIMEOUT_MS = 15000;
  const OAUTH_CALLBACK_POLL_DELAY_MS = 800;
  const OAUTH_CALLBACK_CHECK_INTERVAL_MS = 1000;
  const LOCAL_CPA_JSON_NO_RT_PANEL_MODE = 'local-cpa-json-no-rt';
  const LOCAL_CPA_JSON_EXPORT_NODE_ID = 'local-cpa-json-export';
  const SAVE_SESSION_JSON_NODE_ID = 'save-session-json';
  const CHATGPT_SESSION_EXPORT_URL = 'https://chatgpt.com/';
  const STEP6_COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'paypal.com',
    'stripe.com',
    'checkout.stripe.com',
    'meiguodizhi.com',
    'mail-api.yuecheng.shop',
    'yuecheng.shop',
  ];
  const STEP6_COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://pay.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
    'https://openai.com',
    'https://www.paypal.com',
    'https://paypal.com',
    'https://checkout.stripe.com',
    'https://www.meiguodizhi.com',
    'https://meiguodizhi.com',
    'https://mail-api.yuecheng.shop',
  ];

  function normalizeStep6CookieDomain(domain) {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function shouldClearStep6Cookie(cookie) {
    const domain = normalizeStep6CookieDomain(cookie?.domain);
    if (!domain) return false;
    return STEP6_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target || domain.endsWith(`.${target}`)
    ));
  }

  function buildStep6CookieRemovalUrl(cookie) {
    const host = normalizeStep6CookieDomain(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  async function collectStep6Cookies(chromeApi) {
    if (!chromeApi.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearStep6Cookie(cookie)) continue;
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeStep6Cookie(chromeApi, cookie, getErrorMessage) {
    const details = {
      url: buildStep6CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:step6] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getErrorMessage(error),
      });
      return false;
    }
  }

  function createStep6Executor(deps = {}) {
    const {
      addLog = async () => {},
      buildLocalHelperEndpoint = null,
      chrome: chromeApi = globalThis.chrome,
      completeNodeFromBackground,
      createLocalCliProxyApi = null,
      createSub2ApiApi = null,
      ensureContentScriptReadyOnTab = async () => {},
      getErrorMessage = (error) => error?.message || String(error || '未知错误'),
      getPanelMode = (state = {}) => String(state?.panelMode || '').trim() || 'cpa',
      getTabId = async () => null,
      isLocalhostOAuthCallbackUrl = null,
      isTabAlive = async () => false,
      normalizeHotmailLocalBaseUrl = (value) => String(value || '').trim(),
      normalizeSub2ApiUrl = (value) => value,
      registerTab = async () => {},
      reuseOrCreateTab = null,
      registrationSuccessWaitMs = DEFAULT_REGISTRATION_SUCCESS_WAIT_MS,
      sessionExportInjectFiles = ['content/utils.js', 'content/operation-delay.js', 'content/plus-checkout.js'],
      signupPageInjectFiles = ['content/utils.js', 'content/operation-delay.js', 'content/auth-page-recovery.js', 'content/phone-country-utils.js', 'content/phone-auth.js', 'content/signup-page.js'],
      sendToContentScriptResilient = null,
      setState = async () => {},
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function resolveSessionAccessToken(sessionResult = {}) {
      return normalizeString(sessionResult?.accessToken || sessionResult?.session?.accessToken);
    }

    function resolveSessionEmail(state = {}, sessionResult = {}) {
      return normalizeString(
        sessionResult?.email
        || sessionResult?.session?.user?.email
        || state?.email
        || state?.registrationEmailState?.current
      );
    }

    function sanitizeSessionJsonFileSegment(value = '') {
      return normalizeString(value)
        .replace(/[^A-Za-z0-9._@+-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
    }

    function buildRegistrationSessionJsonFileName(state = {}, sessionResult = {}) {
      const email = sanitizeSessionJsonFileSegment(
        sessionResult?.email
        || sessionResult?.session?.user?.email
        || state?.email
        || state?.registrationEmailState?.current
        || 'account'
      ) || 'account';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `${timestamp}-${email}.json`;
    }

    function buildSub2ApiAccountJsonFileName(session = {}, state = {}) {
      const email = sanitizeSessionJsonFileSegment(
        session?.email
        || session?.user?.email
        || state?.email
        || state?.registrationEmailState?.current
        || 'account'
      ) || 'account';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `${timestamp}-${email}-sub2api.json`;
    }

    function isLocalCpaJsonNoRtMode(state = {}) {
      return normalizeString(getPanelMode(state)) === LOCAL_CPA_JSON_NO_RT_PANEL_MODE;
    }

    function isSub2ApiCodexSessionMode(state = {}) {
      return normalizeString(getPanelMode(state)) === 'sub2api'
        && normalizeString(state?.plusAccountAccessStrategy) === 'sub2api_codex_session';
    }

    function isOAuthInteractiveState(stateName = '') {
      return [
        'add_phone_page',
        'phone_verification_page',
        'add_email_page',
        'verification_page',
        'password_page',
        'email_page',
        'phone_entry_page',
        'entry_page',
        'login_timeout_error_page',
      ].includes(normalizeString(stateName));
    }

    function createOAuthInteractionRequiredResult(pageState = {}, visibleStep = 7, reason = '') {
      const stateName = normalizeString(pageState?.state || 'unknown');
      const urlPart = pageState?.url ? ` URL: ${pageState.url}` : '';
      return {
        deferred: true,
        pageState,
        reason: reason || `步骤 ${visibleStep}：OAuth 需要继续完成 OpenAI 登录/验证交互，已移交后续 OAuth 验证链。当前状态：${stateName || 'unknown'}。${urlPart}`.trim(),
      };
    }

    function isOAuthInteractionRequiredError(error) {
      return /^OAUTH_INTERACTION_REQUIRED::/i.test(getErrorMessage(error));
    }

    function stripOAuthInteractionRequiredPrefix(error) {
      return getErrorMessage(error).replace(/^OAUTH_INTERACTION_REQUIRED::/i, '');
    }

    function getLocalCliProxyApi() {
      const factory = createLocalCliProxyApi
        || globalThis.MultiPageBackgroundLocalCliProxyApi?.createLocalCliProxyApi
        || null;
      if (typeof factory !== 'function') {
        throw new Error('本地 CPA JSON 无RT 模块未加载，无法导出认证文件。');
      }
      return factory({
        crypto: globalThis.crypto,
        fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
        sessionToJsonConverter: globalThis.MultiPageSessionToJsonConverter,
      });
    }

    async function saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact) {
      const endpoint = typeof buildLocalHelperEndpoint === 'function'
        ? buildLocalHelperEndpoint(helperBaseUrl, '/save-auth-json')
        : new URL('/save-auth-json', `${helperBaseUrl.replace(/\/+$/, '')}/`).toString();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath: artifact.filePath,
          directoryPath: artifact.directoryPath,
          content: artifact.jsonText,
        }),
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || payload?.ok === false) {
        const helperError = normalizeString(payload?.error);
        if (/Missing email\/clientId\/refreshToken/i.test(helperError)) {
          throw new Error('本地 helper 未识别 /save-auth-json，当前运行的 hotmail_helper.py 版本过旧或不是当前项目目录。请停止旧 helper，并从当前 FlowPilot-FlowPilot1.0.2 目录重新启动本地助手。');
        }
        throw new Error(helperError || `本地 helper 写入失败（HTTP ${response.status}）。`);
      }

      return {
        ...artifact,
        filePath: normalizeString(payload?.filePath) || artifact.filePath,
      };
    }

    async function saveSessionJsonViaHelper(helperBaseUrl, fileName, jsonText, options = {}) {
      const endpoint = typeof buildLocalHelperEndpoint === 'function'
        ? buildLocalHelperEndpoint(helperBaseUrl, '/save-session-json')
        : new URL('/save-session-json', `${helperBaseUrl.replace(/\/+$/, '')}/`).toString();
      const visibleStep = Math.max(1, Math.floor(Number(options.visibleStep) || 7));
      let lastError = null;

      for (let attempt = 1; attempt <= SESSION_JSON_HELPER_SAVE_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileName,
              content: jsonText,
            }),
          });

          let payload = {};
          try {
            payload = await response.json();
          } catch {
            payload = {};
          }

          if (!response.ok || payload?.ok === false) {
            const helperError = normalizeString(payload?.error);
            if (/Missing email\/clientId\/refreshToken/i.test(helperError)) {
              throw new Error('本地 helper 未识别 /save-session-json，当前运行的 hotmail_helper.py 版本过旧或不是当前项目目录。请停止旧 helper，并从当前 GuJumpgate 目录重新启动本地助手。');
            }
            throw new Error(helperError || `本地 helper 写入 session_json 失败（HTTP ${response.status}）。`);
          }

          return normalizeString(payload?.filePath);
        } catch (error) {
          lastError = error;
          if (attempt < SESSION_JSON_HELPER_SAVE_ATTEMPTS) {
            await addLog(`步骤 ${visibleStep}：本地 helper 写入 session_json 第 ${attempt} 次失败，稍后重试：${getErrorMessage(error)}`, 'warn');
            await sleepWithStop(SESSION_JSON_HELPER_SAVE_RETRY_DELAY_MS);
          }
        }
      }

      throw lastError || new Error('本地 helper 写入 session_json 失败。');
    }

    async function openChatGptSessionExportTab(state = {}) {
      if (chromeApi?.tabs?.create) {
        const tab = await chromeApi.tabs.create({
          url: CHATGPT_SESSION_EXPORT_URL,
          active: false,
        });
        const tabId = Number(tab?.id);
        if (Number.isInteger(tabId) && tabId > 0) {
          return {
            source: 'plus-checkout',
            tabId,
            temporary: true,
          };
        }
      }

      const fallbackTabId = Number(state?.plusCheckoutTabId || await getTabId('plus-checkout') || await getTabId('signup-page'));
      if (!Number.isInteger(fallbackTabId) || fallbackTabId <= 0) {
        throw new Error('未找到可读取 ChatGPT 会话的标签页，无法导出本地 CPA JSON 无RT。');
      }
      return {
        source: 'plus-checkout',
        tabId: fallbackTabId,
        temporary: false,
      };
    }

    async function closeTemporarySessionExportTab(tabInfo = {}) {
      if (!tabInfo?.temporary || !Number.isInteger(Number(tabInfo?.tabId)) || !chromeApi?.tabs?.remove) {
        return;
      }
      await chromeApi.tabs.remove(Number(tabInfo.tabId)).catch(() => {});
    }

    function getStep8CallbackUrlFromTabUpdate(tabId, changeInfo = {}, tab = {}, expectedTabId = null) {
      const normalizedTabId = Number(tabId);
      const normalizedExpectedTabId = Number(expectedTabId);
      if (!Number.isInteger(normalizedTabId) || normalizedTabId <= 0) {
        return '';
      }
      if (Number.isInteger(normalizedExpectedTabId) && normalizedExpectedTabId > 0 && normalizedTabId !== normalizedExpectedTabId) {
        return '';
      }
      const candidateUrl = normalizeString(changeInfo?.url || tab?.url);
      if (!candidateUrl) {
        return '';
      }
      if (typeof isLocalhostOAuthCallbackUrl === 'function') {
        return isLocalhostOAuthCallbackUrl(candidateUrl) ? candidateUrl : '';
      }
      return /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/(?:auth|codex)\/callback(?:[?#]|$)/i.test(candidateUrl)
        ? candidateUrl
        : '';
    }

    function getStep8CallbackUrlFromNavigation(details = {}, expectedTabId = null) {
      const normalizedExpectedTabId = Number(expectedTabId);
      if (Number.isInteger(normalizedExpectedTabId) && normalizedExpectedTabId > 0 && Number(details?.tabId) !== normalizedExpectedTabId) {
        return '';
      }
      const candidateUrl = normalizeString(details?.url);
      if (!candidateUrl) {
        return '';
      }
      if (typeof isLocalhostOAuthCallbackUrl === 'function') {
        return isLocalhostOAuthCallbackUrl(candidateUrl) ? candidateUrl : '';
      }
      return /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/(?:auth|codex)\/callback(?:[?#]|$)/i.test(candidateUrl)
        ? candidateUrl
        : '';
    }

    async function getLocalhostCallbackUrlFromTab(tabId) {
      if (!chromeApi?.tabs?.get || !Number.isInteger(Number(tabId))) {
        return '';
      }
      const tab = await chromeApi.tabs.get(Number(tabId)).catch(() => null);
      return getStep8CallbackUrlFromTabUpdate(Number(tabId), {}, tab || {}, Number(tabId));
    }

    async function getLoginAuthStateFromContent(visibleStep, options = {}) {
      if (typeof sendToContentScriptResilient !== 'function') {
        return {};
      }
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
      const result = await sendToContentScriptResilient('signup-page', {
        type: 'GET_LOGIN_AUTH_STATE',
        source: 'background',
        payload: {},
      }, {
        timeoutMs,
        responseTimeoutMs: timeoutMs,
        retryDelayMs: 600,
        logMessage: options.logMessage || `步骤 ${visibleStep}：认证页正在切换，等待页面重新就绪...`,
        logStep: visibleStep,
        logStepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function waitForOAuthConsentPageOrBlocked(tabId, visibleStep, timeoutMs = OAUTH_CALLBACK_READY_TIMEOUT_MS) {
      const startedAt = Date.now();
      let lastState = '';
      while (Date.now() - startedAt < timeoutMs) {
        const callbackUrl = await getLocalhostCallbackUrlFromTab(tabId);
        if (callbackUrl) {
          return { callbackUrl };
        }
        const pageState = await getLoginAuthStateFromContent(visibleStep, {
          timeoutMs: Math.min(10000, Math.max(1000, timeoutMs - (Date.now() - startedAt))),
          logMessage: `步骤 ${visibleStep}：等待 OAuth 授权页就绪...`,
        });
        const currentState = normalizeString(pageState?.state || 'unknown');
        if (currentState !== lastState) {
          lastState = currentState;
          await addLog(`步骤 ${visibleStep}：OAuth 页面当前状态：${currentState || 'unknown'}。`, 'info', {
            step: visibleStep,
            stepKey: SAVE_SESSION_JSON_NODE_ID,
          });
        }
        if (currentState === 'oauth_consent_page') {
          return { pageState };
        }
        if (isOAuthInteractiveState(currentState)) {
          return createOAuthInteractionRequiredResult(pageState, visibleStep);
        }
        await sleepWithStop(OAUTH_CALLBACK_POLL_DELAY_MS);
      }
      throw new Error(`步骤 ${visibleStep}：等待 OAuth 授权页就绪超时，无法在保存 JSON 步骤获取 RT。`);
    }

    async function waitForLocalhostCallbackOnSignupTab(signupTabId, visibleStep) {
      if (!chromeApi?.tabs?.onUpdated?.addListener || !chromeApi?.webNavigation?.onBeforeNavigate?.addListener) {
        throw new Error('当前浏览器缺少监听 OAuth 回调所需 API。');
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutTimer = null;
        let checkTimer = null;
        let lastObservedState = '';

        const cleanup = () => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          if (checkTimer) {
            clearTimeout(checkTimer);
            checkTimer = null;
          }
          chromeApi.webNavigation.onBeforeNavigate.removeListener(onBeforeNavigate);
          chromeApi.webNavigation.onCommitted?.removeListener(onCommitted);
          chromeApi.tabs.onUpdated.removeListener(onTabUpdated);
        };

        const finish = (callbackUrl) => {
          if (settled || !callbackUrl) return;
          settled = true;
          cleanup();
          resolve(callbackUrl);
        };

        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const onBeforeNavigate = (details) => {
          finish(getStep8CallbackUrlFromNavigation(details, signupTabId));
        };
        const onCommitted = (details) => {
          finish(getStep8CallbackUrlFromNavigation(details, signupTabId));
        };
        const onTabUpdated = (tabId, changeInfo, tab) => {
          finish(getStep8CallbackUrlFromTabUpdate(tabId, changeInfo, tab, signupTabId));
        };

        const inspectAuthState = async () => {
          if (settled) return;
          try {
            const pageState = await getLoginAuthStateFromContent(visibleStep, {
              timeoutMs: 8000,
              logMessage: `步骤 ${visibleStep}：等待 OAuth callback 跳转...`,
            });
            const stateName = normalizeString(pageState?.state || 'unknown');
            if (stateName !== lastObservedState) {
              lastObservedState = stateName;
              await addLog(`步骤 ${visibleStep}：等待回调时认证页状态：${stateName || 'unknown'}。`, 'info', {
                step: visibleStep,
                stepKey: SAVE_SESSION_JSON_NODE_ID,
              });
            }
            if (isOAuthInteractiveState(stateName)) {
              const urlPart = pageState?.url ? ` URL: ${pageState.url}` : '';
              fail(new Error(`OAUTH_INTERACTION_REQUIRED::步骤 ${visibleStep}：OAuth 回调前进入 OpenAI 登录/验证交互，已移交后续 OAuth 验证链。当前状态：${stateName || 'unknown'}。${urlPart}`.trim()));
              return;
            }
          } catch (error) {
            console.warn('[MultiPage:save-session-json] auth state probe failed while waiting callback', getErrorMessage(error));
          }
          checkTimer = setTimeout(inspectAuthState, OAUTH_CALLBACK_CHECK_INTERVAL_MS);
        };

        chromeApi.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
        chromeApi.webNavigation.onCommitted?.addListener(onCommitted);
        chromeApi.tabs.onUpdated.addListener(onTabUpdated);
        timeoutTimer = setTimeout(() => {
          fail(new Error(`步骤 ${visibleStep}：等待 localhost OAuth 回调超时，未能在保存 JSON 步骤获取 RT。`));
        }, OAUTH_CALLBACK_WAIT_TIMEOUT_MS);
        checkTimer = setTimeout(inspectAuthState, OAUTH_CALLBACK_CHECK_INTERVAL_MS);
      });
    }

    async function triggerOAuthConsentContinue(visibleStep) {
      const timeoutMs = 15000;
      const result = await sendToContentScriptResilient('signup-page', {
        type: 'STEP8_TRIGGER_CONTINUE',
        source: 'background',
        payload: {
          visibleStep,
          strategy: 'requestSubmit',
          findTimeoutMs: 10000,
          enabledTimeoutMs: 8000,
        },
      }, {
        timeoutMs,
        responseTimeoutMs: timeoutMs,
        retryDelayMs: 500,
        logMessage: `步骤 ${visibleStep}：OAuth 授权页正在切换，等待页面重新就绪...`,
        logStep: visibleStep,
        logStepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function acquireSub2ApiRtCallback(state = {}, visibleStep = 7) {
      if (typeof reuseOrCreateTab !== 'function') {
        throw new Error('当前环境缺少打开 OAuth 标签页能力，无法在保存 JSON 步骤获取 RT。');
      }
      const api = getLocalCliProxyApi();
      const authRequest = await api.createAuthorizationRequest();
      state.oauthUrl = authRequest.oauthUrl;
      state.localCpaJsonOAuthState = authRequest.oauthState || null;
      state.localCpaJsonPkceCodes = authRequest.pkceCodes || null;
      await setState({
        oauthUrl: authRequest.oauthUrl,
        localCpaJsonOAuthState: authRequest.oauthState || null,
        localCpaJsonPkceCodes: authRequest.pkceCodes || null,
      });
      await addLog(`步骤 ${visibleStep}：已按官方 Codex CLI 参数生成 OAuth 授权链接，尝试直接获取 RT；如 OpenAI 要求登录/手机号验证，将移交后续验证链。`, 'info', {
        step: visibleStep,
        stepKey: SAVE_SESSION_JSON_NODE_ID,
      });

      const signupTabId = await reuseOrCreateTab('signup-page', authRequest.oauthUrl, {
        forceNew: true,
      });
      await registerTab('signup-page', signupTabId);
      await ensureContentScriptReadyOnTab('signup-page', signupTabId, {
        inject: signupPageInjectFiles,
        injectSource: 'signup-page',
        timeoutMs: OAUTH_CALLBACK_READY_TIMEOUT_MS,
        retryDelayMs: 600,
        logMessage: `步骤 ${visibleStep}：正在连接 OAuth 页面，准备直接保存 SUB2API JSON...`,
        logStep: visibleStep,
        logStepKey: SAVE_SESSION_JSON_NODE_ID,
      }).catch(async (error) => {
        const callbackUrl = await getLocalhostCallbackUrlFromTab(signupTabId);
        if (callbackUrl) {
          return;
        }
        throw error;
      });
      const readyResult = await waitForOAuthConsentPageOrBlocked(signupTabId, visibleStep, OAUTH_CALLBACK_READY_TIMEOUT_MS).catch(async (error) => {
        if (!/内容脚本未就绪|内容脚本长时间未就绪|Receiving end does not exist|Could not establish connection/i.test(getErrorMessage(error))) {
          throw error;
        }
        const callbackUrl = await getLocalhostCallbackUrlFromTab(signupTabId);
        if (callbackUrl) {
          return { callbackUrl };
        }
        throw error;
      });
      const directCallbackUrl = normalizeString(readyResult?.callbackUrl);
      if (directCallbackUrl) {
        const callback = parseLocalhostCallback(directCallbackUrl, visibleStep);
        if (authRequest.oauthState && callback.state !== authRequest.oauthState) {
          throw new Error(`步骤 ${visibleStep}：OAuth 回调 state 与当前保存 JSON 会话不匹配。`);
        }
        return {
          callback,
          pkceCodes: authRequest.pkceCodes,
        };
      }
      if (readyResult?.deferred) {
        await addLog(`步骤 ${visibleStep}：${readyResult.reason}`, 'warn', {
          step: visibleStep,
          stepKey: SAVE_SESSION_JSON_NODE_ID,
        });
        return {
          deferred: true,
          reason: readyResult.reason,
          pkceCodes: authRequest.pkceCodes,
          authRequest,
          pageState: readyResult.pageState || null,
        };
      }

      const callbackPromise = waitForLocalhostCallbackOnSignupTab(signupTabId, visibleStep);
      await addLog(`步骤 ${visibleStep}：已进入 OAuth 授权页，正在点击继续并等待 localhost 回调...`, 'info', {
        step: visibleStep,
        stepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      try {
        await triggerOAuthConsentContinue(visibleStep);
      } catch (error) {
        if (isOAuthInteractionRequiredError(error)) {
          const reason = stripOAuthInteractionRequiredPrefix(error);
          await addLog(`步骤 ${visibleStep}：${reason}`, 'warn', {
            step: visibleStep,
            stepKey: SAVE_SESSION_JSON_NODE_ID,
          });
          return {
            deferred: true,
            reason,
            pkceCodes: authRequest.pkceCodes,
            authRequest,
          };
        }
        throw error;
      }
      let callbackUrl = '';
      try {
        callbackUrl = await callbackPromise;
      } catch (error) {
        if (isOAuthInteractionRequiredError(error)) {
          const reason = stripOAuthInteractionRequiredPrefix(error);
          await addLog(`步骤 ${visibleStep}：${reason}`, 'warn', {
            step: visibleStep,
            stepKey: SAVE_SESSION_JSON_NODE_ID,
          });
          return {
            deferred: true,
            reason,
            pkceCodes: authRequest.pkceCodes,
            authRequest,
          };
        }
        throw error;
      }
      const callback = parseLocalhostCallback(callbackUrl, visibleStep);
      if (authRequest.oauthState && callback.state !== authRequest.oauthState) {
        throw new Error(`步骤 ${visibleStep}：OAuth 回调 state 与当前保存 JSON 会话不匹配。`);
      }
      return {
        callback,
        pkceCodes: authRequest.pkceCodes,
      };
    }

    async function readChatGptSessionForExport(state = {}, visibleStep = 7, options = {}) {
      if (typeof sendToContentScriptResilient !== 'function') {
        throw new Error('当前环境缺少 ChatGPT 会话读取通道，无法导出本地 CPA JSON 无RT。');
      }

      const stepKey = normalizeString(options.stepKey) || LOCAL_CPA_JSON_EXPORT_NODE_ID;
      const tabInfo = await openChatGptSessionExportTab(state);
      try {
        await ensureContentScriptReadyOnTab(tabInfo.source, tabInfo.tabId, {
          inject: sessionExportInjectFiles,
          injectSource: tabInfo.source,
          timeoutMs: 30000,
          retryDelayMs: 800,
          logMessage: `步骤 ${visibleStep}：正在连接 ChatGPT 页面，准备读取当前会话并导出 JSON...`,
          logStep: visibleStep,
          logStepKey: stepKey,
        });

        const startedAt = Date.now();
        let lastError = null;
        let loggedWaitingForToken = false;
        let attempt = 0;
        while (Date.now() - startedAt < SESSION_EXPORT_READY_TIMEOUT_MS) {
          attempt += 1;
          try {
            const sessionResult = await sendToContentScriptResilient(tabInfo.source, {
              type: 'PLUS_CHECKOUT_GET_STATE',
              step: visibleStep,
              source: 'background',
              payload: {
                includeSession: true,
                includeAccessToken: true,
              },
            }, {
              timeoutMs: 15000,
              retryDelayMs: 500,
              logMessage: `步骤 ${visibleStep}：正在等待 ChatGPT 页面返回当前登录会话...`,
              logStep: visibleStep,
              logStepKey: stepKey,
            });

            if (sessionResult?.error) {
              throw new Error(sessionResult.error);
            }

            const accessToken = resolveSessionAccessToken(sessionResult);
            if (accessToken) {
              return {
                ...sessionResult,
                accessToken,
              };
            }
            lastError = new Error('当前页面已响应，但 ChatGPT session 中暂时没有 accessToken。');
          } catch (error) {
            lastError = error;
          }

          if (!loggedWaitingForToken) {
            await addLog(`步骤 ${visibleStep}：ChatGPT session/accessToken 尚未稳定，正在自动重试读取...`, 'warn', {
              step: visibleStep,
              stepKey,
            });
            loggedWaitingForToken = true;
          }
          console.warn('[MultiPage:save-session-json] waiting for ChatGPT accessToken', {
            attempt,
            message: getErrorMessage(lastError),
          });
          await sleepWithStop(SESSION_EXPORT_READY_RETRY_DELAY_MS);
        }

        throw new Error(`等待 ChatGPT session/accessToken 稳定超时：${getErrorMessage(lastError)}`);
      } finally {
        await closeTemporarySessionExportTab(tabInfo);
      }
    }

    async function exportLocalCpaJsonNoRt(state = {}, options = {}) {
      const visibleStep = Math.max(1, Math.floor(Number(options.visibleStep) || 7));
      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      const pluginDir = normalizeString(state.localCpaJsonPluginDir);
      if (!helperBaseUrl) {
        throw new Error('尚未配置 Hotmail 本地助手地址，请先在侧边栏填写。');
      }
      if (!pluginDir) {
        throw new Error('尚未配置本地插件目录，请先在侧边栏填写。');
      }

      const sessionResult = await readChatGptSessionForExport(state, visibleStep, {
        stepKey: LOCAL_CPA_JSON_EXPORT_NODE_ID,
      });
      const api = getLocalCliProxyApi();
      const artifact = await api.buildAuthJsonArtifact({
        pluginDir,
        relativeAuthDir: state.localCpaJsonRelativeAuthDir,
        session: sessionResult?.session,
        accessToken: sessionResult?.accessToken,
        sessionToken: sessionResult?.session?.sessionToken,
        email: sessionResult?.email || sessionResult?.session?.user?.email || state?.email,
        expiresAt: sessionResult?.expiresAt || sessionResult?.session?.expires,
        accountId: sessionResult?.session?.account?.id,
        userId: sessionResult?.session?.user?.id,
        planType: sessionResult?.session?.account?.planType,
        lastRefresh: '',
        sourceName: 'SessionToJson Local No RT',
      });

      for (const warning of Array.isArray(artifact.warnings) ? artifact.warnings : []) {
        await addLog(`步骤 ${visibleStep}：${warning}`, 'warn');
      }

      const saved = await saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact);
      const verifiedStatus = `本地CPA JSON 无RT 已导出：${saved.filePath}`;
      await addLog(`步骤 ${visibleStep}：${verifiedStatus}`, 'ok');
      return {
        verifiedStatus,
        localCpaJsonFilePath: saved.filePath,
      };
    }

    async function saveSub2ApiCodexSessionJsonWithRt(state = {}, options = {}) {
      const visibleStep = Math.max(1, Math.floor(Number(options.visibleStep) || 7));
      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      if (!helperBaseUrl) {
        throw new Error('尚未配置 Hotmail 本地助手地址，请先在侧边栏填写。');
      }

      const sessionResult = await readChatGptSessionForExport(state, visibleStep, {
        stepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      const tokenExchange = await acquireSub2ApiRtCallback(state, visibleStep);
      if (tokenExchange?.deferred) {
        await addLog(`步骤 ${visibleStep}：未在保存 Session JSON 步骤直接拿到 RT，后续将沿用当前 OAuth 链接完成验证后在导入节点交换并保存 SUB2API JSON。`, 'warn', {
          step: visibleStep,
          stepKey: SAVE_SESSION_JSON_NODE_ID,
        });
        return {
          deferredOAuthRt: true,
          reason: tokenExchange.reason || '',
          pkceCodes: tokenExchange.pkceCodes || tokenExchange.authRequest?.pkceCodes || null,
          oauthState: tokenExchange.authRequest?.oauthState || state.localCpaJsonOAuthState || null,
          oauthUrl: state.oauthUrl || tokenExchange.authRequest?.oauthUrl || '',
        };
      }
      const localApi = getLocalCliProxyApi();
      const tokenBundle = await localApi.exchangeCodeForTokens({
        code: tokenExchange.callback.code,
        pkceCodes: tokenExchange.pkceCodes,
      });
      if (!normalizeString(tokenBundle.refreshToken)) {
        throw new Error('OAuth token 交换成功但未返回 refresh_token，无法生成 SUB2API 可导入 JSON。');
      }

      const email = resolveSessionEmail(state, sessionResult);
      const session = {
        ...(sessionResult?.session && typeof sessionResult.session === 'object' ? sessionResult.session : {}),
        type: 'codex',
        accessToken: tokenBundle.accessToken,
        refreshToken: tokenBundle.refreshToken,
        idToken: tokenBundle.idToken,
        expiresAt: tokenBundle.expiresAt || getTokenExpiresAt(tokenBundle.accessToken),
        email,
      };
      const accountDataPayload = getSub2ApiApi().buildCodexSessionAccountDataPayload({
        state,
        session,
        accessToken: tokenBundle.accessToken,
        preferredAccountName: email,
      });
      const fileName = buildSub2ApiAccountJsonFileName(session, state);
      const jsonText = `${JSON.stringify(accountDataPayload, null, 2)}\n`;
      const filePath = await saveSessionJsonViaHelper(helperBaseUrl, fileName, jsonText, { visibleStep });
      await setState({
        registrationSessionJsonFilePath: filePath,
        sub2apiAccountJsonFilePath: filePath,
        localhostUrl: tokenExchange.callback.url,
      });
      await addLog(`步骤 ${visibleStep}：已获取 RT 并保存 SUB2API 可导入 JSON：${filePath}`, 'ok', {
        step: visibleStep,
        stepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      return {
        filePath,
        localhostUrl: tokenExchange.callback.url,
      };
    }

    async function saveRegistrationSessionJson(state = {}, options = {}) {
      const visibleStep = Math.max(1, Math.floor(Number(options.visibleStep) || 6));
      if (isSub2ApiCodexSessionMode(state)) {
        return saveSub2ApiCodexSessionJsonWithRt(state, { visibleStep });
      }
      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      if (!helperBaseUrl) {
        await addLog(`步骤 ${visibleStep}：未配置本地 helper 地址，跳过保存 session_json。`, 'warn');
        return null;
      }

      const sessionResult = await readChatGptSessionForExport(state, visibleStep, {
        stepKey: SAVE_SESSION_JSON_NODE_ID,
      });
      const api = getLocalCliProxyApi();
      const artifact = await api.buildAuthJsonArtifact({
        pluginDir: '/',
        relativeAuthDir: 'session_json',
        session: sessionResult?.session,
        accessToken: resolveSessionAccessToken(sessionResult),
        sessionToken: sessionResult?.session?.sessionToken,
        email: resolveSessionEmail(state, sessionResult),
        expiresAt: sessionResult?.expiresAt || sessionResult?.session?.expires,
        accountId: sessionResult?.session?.account?.id,
        userId: sessionResult?.session?.user?.id,
        planType: sessionResult?.session?.account?.planType,
        lastRefresh: '',
        sourceName: 'Registration Session JSON',
      });

      for (const warning of Array.isArray(artifact.warnings) ? artifact.warnings : []) {
        await addLog(`步骤 ${visibleStep}：保存 session_json 提示：${warning}`, 'warn');
      }

      const fileName = buildRegistrationSessionJsonFileName(state, sessionResult);
      const filePath = await saveSessionJsonViaHelper(helperBaseUrl, fileName, artifact.jsonText, { visibleStep });
      await addLog(`步骤 ${visibleStep}：已保存注册后 session JSON：${filePath}`, 'ok');
      return { filePath };
    }

    async function clearCookiesIfEnabled(state = {}) {
      if (!state?.step6CookieCleanupEnabled) {
        return;
      }
      if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) {
        await addLog('步骤 6：当前浏览器不支持 cookies API，跳过第六步 Cookies 清理。', 'warn');
        return;
      }

      try {
        await addLog('步骤 6：已开启 Cookies 清理，正在清理 ChatGPT / OpenAI cookies...', 'info');
        const cookies = await collectStep6Cookies(chromeApi);
        let removedCount = 0;
        for (const cookie of cookies) {
          if (await removeStep6Cookie(chromeApi, cookie, getErrorMessage)) {
            removedCount += 1;
          }
        }

        if (chromeApi.browsingData?.removeCookies) {
          try {
            await chromeApi.browsingData.removeCookies({
              since: 0,
              origins: STEP6_COOKIE_CLEAR_ORIGINS,
            });
          } catch (error) {
            await addLog(`步骤 6：browsingData 补扫 cookies 失败：${getErrorMessage(error)}`, 'warn');
          }
        }

        await addLog(`步骤 6：已清理 ${removedCount} 个 ChatGPT / OpenAI cookies。`, 'ok');
      } catch (error) {
        await addLog(`步骤 6：Cookies 清理失败，已跳过并继续后续流程：${getErrorMessage(error)}`, 'warn');
      }
    }

    async function executeStep6(state = {}) {
      const baseWaitMs = Math.max(0, Math.floor(Number(registrationSuccessWaitMs) || 0));
      const waitMs = baseWaitMs;
      if (waitMs > 0) {
        await addLog(`步骤 6：等待 ${Math.round(waitMs / 1000)} 秒，确认注册成功并让页面稳定...`, 'info');
        await sleepWithStop(waitMs);
      }
      await clearCookiesIfEnabled(state);
      await addLog('步骤 6：注册成功等待完成，注册阶段已结束。', 'ok');
      await completeNodeFromBackground('wait-registration-success', {});
    }

    async function executeSaveSessionJson(state = {}) {
      const visibleStep = Math.max(1, Math.floor(Number(state?.visibleStep) || 7));
      const sessionSaveResult = await saveRegistrationSessionJson(state, { visibleStep });
      if (sessionSaveResult?.oauthUrl) {
        state.oauthUrl = sessionSaveResult.oauthUrl;
      }
      if (sessionSaveResult?.oauthState) {
        state.localCpaJsonOAuthState = sessionSaveResult.oauthState;
      }
      if (sessionSaveResult?.pkceCodes) {
        state.localCpaJsonPkceCodes = sessionSaveResult.pkceCodes;
      }
      await completeNodeFromBackground(state?.nodeId || 'save-session-json', {
        ...(sessionSaveResult?.filePath ? { registrationSessionJsonFilePath: sessionSaveResult.filePath } : {}),
        ...(sessionSaveResult?.filePath && isSub2ApiCodexSessionMode(state) ? { sub2apiAccountJsonFilePath: sessionSaveResult.filePath } : {}),
        ...(sessionSaveResult?.deferredOAuthRt ? { deferredOAuthRt: true } : {}),
        ...(sessionSaveResult?.reason ? { saveSessionJsonDeferredReason: sessionSaveResult.reason } : {}),
        ...(sessionSaveResult?.oauthState ? { localCpaJsonOAuthState: sessionSaveResult.oauthState } : {}),
        ...(sessionSaveResult?.pkceCodes ? { localCpaJsonPkceCodes: sessionSaveResult.pkceCodes } : {}),
        ...(sessionSaveResult?.localhostUrl ? { localhostUrl: sessionSaveResult.localhostUrl } : {}),
        ...(state?.oauthUrl ? { oauthUrl: state.oauthUrl } : {}),
        ...(state?.localCpaJsonOAuthState ? { localCpaJsonOAuthState: state.localCpaJsonOAuthState } : {}),
        ...(state?.localCpaJsonPkceCodes ? { localCpaJsonPkceCodes: state.localCpaJsonPkceCodes } : {}),
      });
    }

    function getSub2ApiApi() {
      const factory = createSub2ApiApi
        || globalThis.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi
        || null;
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 直连接口模块未加载，无法生成导入 JSON。');
      }
      return factory({
        addLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
    }

    function getTokenExpiresAt(accessToken = '') {
      const parts = normalizeString(accessToken).split('.');
      if (parts.length < 2) {
        return '';
      }
      try {
        const segment = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
        const text = typeof atob === 'function' ? atob(padded) : '';
        const payload = JSON.parse(text || '{}');
        const exp = Number(payload?.exp) || 0;
        return exp > 0 ? new Date(exp * 1000).toISOString() : '';
      } catch {
        return '';
      }
    }

    function parseLocalhostCallback(rawUrl, visibleStep = 7) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new Error(`步骤 ${visibleStep} 捕获到的 localhost OAuth 回调地址格式无效。`);
      }

      const code = normalizeString(parsed.searchParams.get('code'));
      const state = normalizeString(parsed.searchParams.get('state'));
      const error = normalizeString(parsed.searchParams.get('error'));
      const errorDescription = normalizeString(parsed.searchParams.get('error_description'));
      if (error) {
        throw new Error(errorDescription ? `OAuth 回调失败：${errorDescription}` : `OAuth 回调失败：${error}`);
      }
      if (!code || !state) {
        throw new Error(`步骤 ${visibleStep} 捕获到的 localhost OAuth 回调地址缺少 code 或 state。`);
      }

      return {
        url: parsed.toString(),
        code,
        state,
      };
    }

    async function executeLocalCpaJsonNoRtExport(state = {}) {
      if (!isLocalCpaJsonNoRtMode(state)) {
        throw new Error('当前不是本地CPA JSON 无RT 模式，不能执行无RT导出节点。');
      }
      await addLog('步骤 7：Plus Checkout 已完成，等待 5 秒后导出本地 CPA JSON 无RT...', 'info');
      await sleepWithStop(5000);
      const completionPayload = await exportLocalCpaJsonNoRt(state, { visibleStep: 7 });
      await completeNodeFromBackground(LOCAL_CPA_JSON_EXPORT_NODE_ID, completionPayload);
    }

    return {
      executeLocalCpaJsonNoRtExport,
      executeSaveSessionJson,
      executeStep6,
    };
  }

  return { createStep6Executor };
});
