/*
|--------------------------------------------------------------------------
| Volume Booster - Popup Controller
|--------------------------------------------------------------------------
|
| Responsibilities:
|
| - Detect the currently active tab
| - Load its saved settings
| - Display the current tab title
| - Enable / disable volume boosting
| - Change boost level from 100% to 600%
| - Enable / disable limiter
| - Display errors
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| DOM Elements
|--------------------------------------------------------------------------
*/

const enableToggle = document.getElementById("enableToggle");

const limiterToggle = document.getElementById("limiterToggle");

const gainSlider = document.getElementById("gainSlider");

const gainValue = document.getElementById("gainValue");

const statusText = document.getElementById("statusText");

const tabTitle = document.getElementById("tabTitle");

const errorMessage = document.getElementById("errorMessage");

const volumeSection = document.querySelector(".volume-section");

/*
|--------------------------------------------------------------------------
| Current tab
|--------------------------------------------------------------------------
*/

let currentTab = null;

/*
|--------------------------------------------------------------------------
| Prevent duplicate operations
|--------------------------------------------------------------------------
*/

let isProcessing = false;

/*
|--------------------------------------------------------------------------
| Utility: Send message to background
|--------------------------------------------------------------------------
*/

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      /*
       * Chrome runtime error.
       */
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));

        return;
      }

      /*
       * No response.
       */
      if (!response) {
        reject(new Error("No response received from the extension."));

        return;
      }

      resolve(response);
    });
  });
}

/*
|--------------------------------------------------------------------------
| Get active tab
|--------------------------------------------------------------------------
*/

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tabs || tabs.length === 0) {
    throw new Error("Could not find the current browser tab.");
  }

  return tabs[0];
}

/*
|--------------------------------------------------------------------------
| Display error
|--------------------------------------------------------------------------
*/

function showError(message) {
  if (!errorMessage) {
    return;
  }

  errorMessage.textContent = message || "Something went wrong.";

  errorMessage.hidden = false;
}

/*
|--------------------------------------------------------------------------
| Hide error
|--------------------------------------------------------------------------
*/

function hideError() {
  if (!errorMessage) {
    return;
  }

  errorMessage.textContent = "";

  errorMessage.hidden = true;
}

/*
|--------------------------------------------------------------------------
| Set loading / processing state
|--------------------------------------------------------------------------
*/

function setProcessing(processing) {
  isProcessing = Boolean(processing);

  /*
   * Disable controls while an operation is
   * being processed.
   */
  enableToggle.disabled = processing;

  limiterToggle.disabled = processing;

  gainSlider.disabled = processing;
}

/*
|--------------------------------------------------------------------------
| Update status text
|--------------------------------------------------------------------------
*/

function updateStatus(enabled) {
  if (enabled) {
    statusText.textContent = "Enabled";

    statusText.classList.add("enabled");
  } else {
    statusText.textContent = "Disabled";

    statusText.classList.remove("enabled");
  }
}

/*
|--------------------------------------------------------------------------
| Update gain display
|--------------------------------------------------------------------------
*/

function updateGainDisplay(gain) {
  const numericGain = Number(gain);

  if (!Number.isFinite(numericGain)) {
    gainValue.textContent = "100%";

    return;
  }

  const percentage = Math.round(numericGain * 100);

  gainValue.textContent = `${percentage}%`;

  /*
   * Keep the slider synchronized.
   */
  gainSlider.value = String(Math.min(600, Math.max(100, percentage)));
}

/*
|--------------------------------------------------------------------------
| Update volume section appearance
|--------------------------------------------------------------------------
*/

function updateVolumeAppearance(enabled) {
  if (!volumeSection) {
    return;
  }

  /*
   * We intentionally do NOT disable the slider
   * when the booster is off.
   *
   * The user can select a gain value while disabled,
   * and that value will be used when they enable it.
   */
  volumeSection.classList.toggle("disabled", false);
}

/*
|--------------------------------------------------------------------------
| Apply state to UI
|--------------------------------------------------------------------------
*/

function applyState(state) {
  if (!state) {
    return;
  }

  const enabled = Boolean(state.enabled);

  const limiter = Boolean(state.limiter);

  const gain = Number(state.gain);

  /*
   * Toggle.
   */
  enableToggle.checked = enabled;

  /*
   * Limiter.
   */
  limiterToggle.checked = limiter;

  /*
   * Gain.
   */
  updateGainDisplay(Number.isFinite(gain) ? gain : 1.0);

  /*
   * Status.
   */
  updateStatus(enabled);

  /*
   * Visual state.
   */
  updateVolumeAppearance(enabled);
}

/*
|--------------------------------------------------------------------------
| Load current tab state
|--------------------------------------------------------------------------
*/

async function loadState() {
  hideError();

  try {
    /*
     * Find active tab.
     */
    currentTab = await getCurrentTab();

    /*
     * Display tab title.
     */
    if (currentTab.title && currentTab.title.trim()) {
      tabTitle.textContent = currentTab.title;
    } else {
      tabTitle.textContent = "Current tab";
    }

    /*
     * Request saved state from background.js.
     */
    const response = await sendMessage({
      type: "GET_STATE",

      tabId: currentTab.id,
    });

    if (!response.ok) {
      throw new Error(response.error || "Could not load tab settings.");
    }

    /*
     * Apply saved settings.
     */
    applyState(response.state);
  } catch (error) {
    console.error("Could not load state:", error);

    showError(error?.message || "Could not load the current tab.");
  }
}

/*
|--------------------------------------------------------------------------
| Enable / Disable
|--------------------------------------------------------------------------
*/

async function handleEnableToggle() {
  if (isProcessing) {
    return;
  }

  hideError();

  /*
   * Make sure we still have a tab.
   */
  if (!currentTab || !Number.isInteger(currentTab.id)) {
    showError("Could not determine the current tab.");

    return;
  }

  const enabled = enableToggle.checked;

  setProcessing(true);

  try {
    const response = await sendMessage({
      type: "SET_ENABLED",

      tabId: currentTab.id,

      enabled: enabled,
    });

    if (!response.ok) {
      /*
       * Revert the toggle because the operation
       * failed.
       */
      enableToggle.checked = !enabled;

      throw new Error(
        response.error ||
          (enabled
            ? "Could not enable volume boost."
            : "Could not disable volume boost."),
      );
    }

    /*
     * Update UI.
     */
    updateStatus(enabled);

    updateVolumeAppearance(enabled);
  } catch (error) {
    console.error("Enable toggle error:", error);

    showError(error?.message || "Could not change volume boost.");
  } finally {
    setProcessing(false);
  }
}

/*
|--------------------------------------------------------------------------
| Gain Slider
|--------------------------------------------------------------------------
*/

async function handleGainChange() {
  if (isProcessing) {
    return;
  }

  hideError();

  if (!currentTab || !Number.isInteger(currentTab.id)) {
    showError("Could not determine the current tab.");

    return;
  }

  /*
   * Slider value is a percentage.
   *
   * Example:
   *
   * 100 = 1.0
   * 250 = 2.5
   * 600 = 6.0
   */
  const percentage = Number(gainSlider.value);

  if (!Number.isFinite(percentage)) {
    return;
  }

  const gain = Math.min(600, Math.max(100, percentage)) / 100;

  /*
   * Update display immediately.
   */
  updateGainDisplay(gain);

  /*
   * Don't block the slider visually while
   * communicating with background.js.
   */
  try {
    const response = await sendMessage({
      type: "SET_GAIN",

      tabId: currentTab.id,

      gain: gain,
    });

    if (!response.ok) {
      throw new Error(response.error || "Could not change boost level.");
    }

    /*
     * Use the value confirmed by background.js.
     */
    if (Number.isFinite(Number(response.gain))) {
      updateGainDisplay(Number(response.gain));
    }
  } catch (error) {
    console.error("Gain update error:", error);

    showError(error?.message || "Could not change boost level.");
  }
}

/*
|--------------------------------------------------------------------------
| Limiter
|--------------------------------------------------------------------------
*/

async function handleLimiterToggle() {
  if (isProcessing) {
    return;
  }

  hideError();

  if (!currentTab || !Number.isInteger(currentTab.id)) {
    showError("Could not determine the current tab.");

    return;
  }

  const limiter = limiterToggle.checked;

  setProcessing(true);

  try {
    const response = await sendMessage({
      type: "SET_LIMITER",

      tabId: currentTab.id,

      limiter: limiter,
    });

    if (!response.ok) {
      /*
       * Revert UI when operation failed.
       */
      limiterToggle.checked = !limiter;

      throw new Error(response.error || "Could not change limiter.");
    }

    /*
     * Use confirmed state.
     */
    limiterToggle.checked = Boolean(response.limiter);
  } catch (error) {
    console.error("Limiter update error:", error);

    showError(error?.message || "Could not change limiter.");
  } finally {
    setProcessing(false);
  }
}

/*
|--------------------------------------------------------------------------
| Check whether current page can be captured
|--------------------------------------------------------------------------
|
| Chrome does not allow tabCapture on certain internal pages,
| including:
|
| - chrome://
| - Chrome Web Store
| - Some browser-owned pages
|
| We don't prevent the user from clicking the toggle here.
| The background/audio engine will return the actual error.
|
|--------------------------------------------------------------------------
*/

function isRestrictedPage(url) {
  if (!url) {
    return false;
  }

  const restrictedProtocols = [
    "chrome:",
    "edge:",
    "about:",
    "chrome-extension:",
  ];

  return restrictedProtocols.some((protocol) => url.startsWith(protocol));
}

/*
|--------------------------------------------------------------------------
| Show restricted page warning
|--------------------------------------------------------------------------
*/

function checkRestrictedPage() {
  if (!currentTab || !currentTab.url) {
    return;
  }

  if (isRestrictedPage(currentTab.url)) {
    showError("Volume Boost cannot be used on this browser page.");
  }
}

/*
|--------------------------------------------------------------------------
| Event listeners
|--------------------------------------------------------------------------
*/

enableToggle.addEventListener("change", handleEnableToggle);

gainSlider.addEventListener("input", () => {
  /*
   * Update the number immediately while dragging.
   */
  const percentage = Number(gainSlider.value);

  if (Number.isFinite(percentage)) {
    gainValue.textContent = `${Math.round(percentage)}%`;
  }
});

gainSlider.addEventListener("change", handleGainChange);

limiterToggle.addEventListener("change", handleLimiterToggle);

/*
|--------------------------------------------------------------------------
| Prevent accidental popup selection
|--------------------------------------------------------------------------
*/

document.addEventListener("keydown", (event) => {
  /*
   * Escape simply lets Chrome close the popup.
   */
  if (event.key === "Escape") {
    return;
  }
});

/*
|--------------------------------------------------------------------------
| Initialize popup
|--------------------------------------------------------------------------
*/

document.addEventListener("DOMContentLoaded", async () => {
  await loadState();

  checkRestrictedPage();
});
