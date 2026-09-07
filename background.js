const OFFSCREEN_DOCUMENT_PATH = "audio/offscreen.html";

const DEFAULT_STATE = {
  enabled: false,
  gain: 1.0,
  limiter: true,
};

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

function clampGain(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 1.0;
  }

  return Math.min(6.0, Math.max(1.0, number));
}

/*
|--------------------------------------------------------------------------
| Per-tab storage
|--------------------------------------------------------------------------
*/

async function getTabState(tabId) {
  const key = `tab_${tabId}`;

  const result = await chrome.storage.local.get(key);

  const savedState = result[key] || {};

  return {
    ...DEFAULT_STATE,
    ...savedState,

    gain: clampGain(savedState.gain ?? DEFAULT_STATE.gain),

    enabled: Boolean(savedState.enabled),

    limiter: Boolean(savedState.limiter ?? DEFAULT_STATE.limiter),
  };
}

async function saveTabState(tabId, state) {
  const key = `tab_${tabId}`;

  await chrome.storage.local.set({
    [key]: {
      enabled: Boolean(state.enabled),

      gain: clampGain(state.gain),

      limiter: Boolean(state.limiter),
    },
  });
}

/*
|--------------------------------------------------------------------------
| Offscreen document
|--------------------------------------------------------------------------
*/

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],

    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,

    reasons: ["USER_MEDIA"],

    justification: "Process captured tab audio using the Web Audio API.",
  });
}

/*
|--------------------------------------------------------------------------
| Start volume boosting
|--------------------------------------------------------------------------
*/

async function startBoost(tabId) {
  const state = await getTabState(tabId);

  /*
   * Get the capture stream ID.
   */
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });

  /*
   * Create offscreen document after getting
   * the stream ID.
   */
  await ensureOffscreenDocument();

  /*
   * Tell offscreen document to start processing.
   */
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START",

    tabId: tabId,

    streamId: streamId,

    gain: state.gain,

    limiter: state.limiter,
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Failed to start audio processing.");
  }

  /*
   * Save enabled state.
   */
  await saveTabState(tabId, {
    ...state,

    enabled: true,
  });

  await updateBadge(tabId, true);

  return {
    ok: true,
  };
}

/*
|--------------------------------------------------------------------------
| Stop volume boosting
|--------------------------------------------------------------------------
*/

async function stopBoost(tabId) {
  try {
    /*
     * Only create the offscreen document if needed.
     */
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_STOP",

      tabId: tabId,
    });

    if (response && response.ok === false) {
      console.warn("Offscreen stop returned an error:", response.error);
    }
  } catch (error) {
    console.warn("Could not stop offscreen audio:", error);
  }

  /*
   * Update stored state regardless of whether
   * the audio session existed.
   */
  const state = await getTabState(tabId);

  await saveTabState(tabId, {
    ...state,

    enabled: false,
  });

  await updateBadge(tabId, false);

  return {
    ok: true,
  };
}

/*
|--------------------------------------------------------------------------
| Change gain
|--------------------------------------------------------------------------
*/

async function updateGain(tabId, gain) {
  const state = await getTabState(tabId);

  const newGain = clampGain(gain);

  /*
   * If boosting is active, update the live
   * audio processor immediately.
   */
  if (state.enabled) {
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_SET_GAIN",

      tabId: tabId,

      gain: newGain,
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Failed to change audio gain.");
    }
  }

  /*
   * Save even if disabled.
   */
  await saveTabState(tabId, {
    ...state,

    gain: newGain,
  });

  return {
    ok: true,

    gain: newGain,
  };
}

/*
|--------------------------------------------------------------------------
| Change limiter
|--------------------------------------------------------------------------
*/

async function updateLimiter(tabId, limiter) {
  const state = await getTabState(tabId);

  const newLimiterState = Boolean(limiter);

  /*
   * If currently active, update live processor.
   */
  if (state.enabled) {
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_SET_LIMITER",

      tabId: tabId,

      limiter: newLimiterState,
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Failed to change limiter.");
    }
  }

  await saveTabState(tabId, {
    ...state,

    limiter: newLimiterState,
  });

  return {
    ok: true,

    limiter: newLimiterState,
  };
}

/*
|--------------------------------------------------------------------------
| Extension badge
|--------------------------------------------------------------------------
*/

async function updateBadge(tabId, enabled) {
  if (enabled) {
    await chrome.action.setBadgeText({
      tabId: tabId,

      text: "ON",
    });

    await chrome.action.setTitle({
      tabId: tabId,

      title: "Volume Booster — Enabled",
    });
  } else {
    await chrome.action.setBadgeText({
      tabId: tabId,

      text: "",
    });

    await chrome.action.setTitle({
      tabId: tabId,

      title: "Volume Booster — Disabled",
    });
  }
}

/*
|--------------------------------------------------------------------------
| Messages
|--------------------------------------------------------------------------
*/

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /*
   * Ignore invalid messages.
   */
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = message.type;

  /*
   * GET STATE
   */
  if (type === "GET_STATE") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const state = await getTabState(tabId);

        sendResponse({
          ok: true,

          state: state,
        });
      } catch (error) {
        console.error("GET_STATE error:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
   * SET ENABLED
   */
  if (type === "SET_ENABLED") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const enabled = Boolean(message.enabled);

        let response;

        if (enabled) {
          response = await startBoost(tabId);
        } else {
          response = await stopBoost(tabId);
        }

        sendResponse(response);
      } catch (error) {
        console.error("SET_ENABLED error:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
   * SET GAIN
   */
  if (type === "SET_GAIN") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const response = await updateGain(
          tabId,

          message.gain,
        );

        sendResponse(response);
      } catch (error) {
        console.error("SET_GAIN error:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
   * SET LIMITER
   */
  if (type === "SET_LIMITER") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const response = await updateLimiter(
          tabId,

          message.limiter,
        );

        sendResponse(response);
      } catch (error) {
        console.error("SET_LIMITER error:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
   * OFFSCREEN_ERROR
   *
   * This message comes from offscreen.js.
   */
  if (type === "OFFSCREEN_ERROR") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        console.error("Volume Booster audio error:", message.error);

        if (Number.isInteger(tabId) && tabId > 0) {
          const state = await getTabState(tabId);

          await saveTabState(tabId, {
            ...state,

            enabled: false,
          });

          await updateBadge(tabId, false);
        }

        sendResponse({
          ok: true,
        });
      } catch (error) {
        console.error("OFFSCREEN_ERROR handling failed:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
   * IMPORTANT
   *
   * Messages intended for offscreen.js
   * are ignored here.
   *
   * chrome.runtime.sendMessage() can reach
   * multiple extension contexts.
   */
  return false;
});

/*
|--------------------------------------------------------------------------
| Tab closed
|--------------------------------------------------------------------------
*/

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    /*
     * Stop audio session if one exists.
     */
    await ensureOffscreenDocument();

    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_STOP",

      tabId: tabId,
    });
  } catch (error) {
    console.warn("Could not stop audio for closed tab:", error);
  }

  try {
    await chrome.storage.local.remove(`tab_${tabId}`);
  } catch (error) {
    console.warn("Could not remove tab state:", error);
  }
});

/*
|--------------------------------------------------------------------------
| Page navigation
|--------------------------------------------------------------------------
*/

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") {
    return;
  }

  try {
    const state = await getTabState(tabId);

    if (state.enabled) {
      await stopBoost(tabId);
    }
  } catch (error) {
    console.warn("Could not stop booster during navigation:", error);
  }
});

/*
|--------------------------------------------------------------------------
| Installation
|--------------------------------------------------------------------------
*/

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Volume Booster installed successfully.");
});
