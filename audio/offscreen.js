/*
|--------------------------------------------------------------------------
| Volume Booster - Offscreen Audio Engine
|--------------------------------------------------------------------------
|
| This document handles the actual audio processing.
|
| Flow:
|
|     Captured Tab Audio
|            ↓
|       MediaStream
|            ↓
|         GainNode
|            ↓
|     Limiter (optional)
|            ↓
|        Speakers
|
|--------------------------------------------------------------------------
*/

const sessions = new Map();

const MIN_GAIN = 1.0;
const MAX_GAIN = 6.0;

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

function clampGain(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return MIN_GAIN;
  }

  return Math.min(
    MAX_GAIN,

    Math.max(MIN_GAIN, number),
  );
}

function normalizeLimiter(value) {
  return Boolean(value);
}

/*
|--------------------------------------------------------------------------
| Create captured tab stream
|--------------------------------------------------------------------------
*/

async function createTabMediaStream(streamId) {
  if (!streamId) {
    throw new Error("No tab capture stream ID was provided.");
  }

  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",

          chromeMediaSourceId: streamId,
        },
      },

      video: false,
    });

    return mediaStream;
  } catch (error) {
    throw new Error(
      "Could not access captured tab audio: " +
        (error?.message || String(error)),
    );
  }
}

/*
|--------------------------------------------------------------------------
| Create limiter
|--------------------------------------------------------------------------
*/

function createLimiter(audioContext) {
  const compressor = audioContext.createDynamicsCompressor();

  /*
   * Threshold
   */
  compressor.threshold.value = -8;

  /*
   * Knee
   */
  compressor.knee.value = 12;

  /*
   * Ratio
   */
  compressor.ratio.value = 20;

  /*
   * Attack
   */
  compressor.attack.value = 0.003;

  /*
   * Release
   */
  compressor.release.value = 0.08;

  return compressor;
}

/*
|--------------------------------------------------------------------------
| Connect audio graph
|--------------------------------------------------------------------------
*/

function connectAudioGraph(session) {
  /*
   * Disconnect existing graph.
   */
  try {
    session.gainNode.disconnect();
  } catch (_) {}

  try {
    session.compressor.disconnect();
  } catch (_) {}

  /*
   * Set gain.
   */
  session.gainNode.gain.value = session.gain;

  /*
   * Limiter enabled:
   *
   * Gain
   *   ↓
   * Compressor
   *   ↓
   * Destination
   */
  if (session.limiter) {
    session.gainNode.connect(session.compressor);

    session.compressor.connect(session.audioContext.destination);

    return;
  }

  /*
   * Limiter disabled:
   *
   * Gain
   *   ↓
   * Destination
   */
  session.gainNode.connect(session.audioContext.destination);
}

/*
|--------------------------------------------------------------------------
| Start session
|--------------------------------------------------------------------------
*/

async function startSession(tabId, streamId, gain, limiter) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Invalid tab ID.");
  }

  /*
   * Stop an existing session first.
   */
  if (sessions.has(tabId)) {
    await stopSession(tabId);
  }

  const normalizedGain = clampGain(gain);

  const normalizedLimiter = normalizeLimiter(limiter);

  /*
   * Capture tab audio.
   */
  const mediaStream = await createTabMediaStream(streamId);

  /*
   * Create AudioContext.
   */
  const audioContext = new AudioContext();

  /*
   * Create MediaStream source.
   */
  const source = audioContext.createMediaStreamSource(mediaStream);

  /*
   * Create GainNode.
   */
  const gainNode = audioContext.createGain();

  /*
   * Create limiter.
   */
  const compressor = createLimiter(audioContext);

  /*
   * Create session.
   */
  const session = {
    tabId: tabId,

    mediaStream: mediaStream,

    audioContext: audioContext,

    source: source,

    gainNode: gainNode,

    compressor: compressor,

    gain: normalizedGain,

    limiter: normalizedLimiter,
  };

  /*
   * Store session.
   */
  sessions.set(tabId, session);

  try {
    /*
     * Source → Gain
     */
    source.connect(gainNode);

    /*
     * Gain → Limiter/Destination
     */
    connectAudioGraph(session);

    /*
     * Resume AudioContext.
     */
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    /*
     * Watch audio tracks.
     */
    const tracks = mediaStream.getAudioTracks();

    for (const track of tracks) {
      track.addEventListener(
        "ended",
        () => {
          handleStreamEnded(tabId);
        },
        {
          once: true,
        },
      );
    }

    console.log(`Volume Booster started for tab ${tabId}`);

    return {
      ok: true,
    };
  } catch (error) {
    await stopSession(tabId);

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| Handle stream ending
|--------------------------------------------------------------------------
*/

async function handleStreamEnded(tabId) {
  /*
   * If it was already stopped intentionally,
   * don't report an error.
   */
  if (!sessions.has(tabId)) {
    return;
  }

  console.warn(`Audio stream ended for tab ${tabId}`);

  await stopSession(tabId);

  /*
   * Notify background.js.
   */
  try {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_ERROR",

      tabId: tabId,

      error: "The captured tab audio stream ended.",
    });
  } catch (error) {
    console.warn("Could not report stream ending:", error);
  }
}

/*
|--------------------------------------------------------------------------
| Stop session
|--------------------------------------------------------------------------
*/

async function stopSession(tabId) {
  const session = sessions.get(tabId);

  /*
   * Already stopped.
   */
  if (!session) {
    return;
  }

  /*
   * Remove immediately.
   */
  sessions.delete(tabId);

  /*
   * Disconnect source.
   */
  try {
    session.source.disconnect();
  } catch (_) {}

  /*
   * Disconnect gain.
   */
  try {
    session.gainNode.disconnect();
  } catch (_) {}

  /*
   * Disconnect compressor.
   */
  try {
    session.compressor.disconnect();
  } catch (_) {}

  /*
   * Stop captured tracks.
   */
  try {
    const tracks = session.mediaStream.getTracks();

    for (const track of tracks) {
      try {
        track.stop();
      } catch (_) {}
    }
  } catch (_) {}

  /*
   * Close AudioContext.
   */
  try {
    if (session.audioContext && session.audioContext.state !== "closed") {
      await session.audioContext.close();
    }
  } catch (_) {}

  console.log(`Volume Booster stopped for tab ${tabId}`);
}

/*
|--------------------------------------------------------------------------
| Set gain
|--------------------------------------------------------------------------
*/

async function setSessionGain(tabId, gain) {
  const session = sessions.get(tabId);

  if (!session) {
    throw new Error("No active audio session exists for this tab.");
  }

  const newGain = clampGain(gain);

  session.gain = newGain;

  /*
   * Update gain immediately.
   */
  session.gainNode.gain.setValueAtTime(
    newGain,

    session.audioContext.currentTime,
  );

  return {
    ok: true,

    gain: newGain,
  };
}

/*
|--------------------------------------------------------------------------
| Set limiter
|--------------------------------------------------------------------------
*/

async function setSessionLimiter(tabId, limiter) {
  const session = sessions.get(tabId);

  if (!session) {
    throw new Error("No active audio session exists for this tab.");
  }

  session.limiter = normalizeLimiter(limiter);

  /*
   * Reconnect graph.
   */
  connectAudioGraph(session);

  return {
    ok: true,

    limiter: session.limiter,
  };
}

/*
|--------------------------------------------------------------------------
| Runtime message handler
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
         |--------------------------------------------------------------------------
         | OFFSCREEN_START
         |--------------------------------------------------------------------------
         */

  if (type === "OFFSCREEN_START") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const response = await startSession(
          tabId,

          message.streamId,

          message.gain,

          message.limiter,
        );

        sendResponse(response);
      } catch (error) {
        console.error("OFFSCREEN_START failed:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
         |--------------------------------------------------------------------------
         | OFFSCREEN_STOP
         |--------------------------------------------------------------------------
         */

  if (type === "OFFSCREEN_STOP") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        await stopSession(tabId);

        sendResponse({
          ok: true,
        });
      } catch (error) {
        console.error("OFFSCREEN_STOP failed:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
         |--------------------------------------------------------------------------
         | OFFSCREEN_SET_GAIN
         |--------------------------------------------------------------------------
         */

  if (type === "OFFSCREEN_SET_GAIN") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const response = await setSessionGain(
          tabId,

          message.gain,
        );

        sendResponse(response);
      } catch (error) {
        console.error("OFFSCREEN_SET_GAIN failed:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
         |--------------------------------------------------------------------------
         | OFFSCREEN_SET_LIMITER
         |--------------------------------------------------------------------------
         */

  if (type === "OFFSCREEN_SET_LIMITER") {
    (async () => {
      try {
        const tabId = Number(message.tabId);

        const response = await setSessionLimiter(
          tabId,

          message.limiter,
        );

        sendResponse(response);
      } catch (error) {
        console.error("OFFSCREEN_SET_LIMITER failed:", error);

        sendResponse({
          ok: false,

          error: error?.message || String(error),
        });
      }
    })();

    return true;
  }

  /*
         |--------------------------------------------------------------------------
         | IMPORTANT
         |--------------------------------------------------------------------------
         |
         | Messages such as:
         |
         | SET_ENABLED
         | SET_GAIN
         | SET_LIMITER
         | GET_STATE
         |
         | belong to background.js.
         |
         | chrome.runtime.sendMessage() can deliver those messages
         | to this offscreen document too.
         |
         | We MUST NOT answer them.
         |
         */

  return false;
});

/*
|--------------------------------------------------------------------------
| Cleanup
|--------------------------------------------------------------------------
*/

window.addEventListener("beforeunload", () => {
  for (const session of sessions.values()) {
    try {
      session.source.disconnect();
    } catch (_) {}

    try {
      session.gainNode.disconnect();
    } catch (_) {}

    try {
      session.compressor.disconnect();
    } catch (_) {}

    try {
      const tracks = session.mediaStream.getTracks();

      for (const track of tracks) {
        track.stop();
      }
    } catch (_) {}
  }

  sessions.clear();
});

/*
|--------------------------------------------------------------------------
| Startup
|--------------------------------------------------------------------------
*/

console.log("Volume Booster audio engine loaded.");
