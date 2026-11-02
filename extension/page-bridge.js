
  /*
 * Experimental, reversible Parsec WEB CLIENT video-pause helper.
 * Source inspected: https://web.parsec.app/lib/parsec.js (2026-09-29).
 * This is not an installed/native Parsec setting and provides no microphone return.
 * It requests that the host pause video; actual traffic/encoding must be measured.
 * No authentication, storage, audio configuration, or installation is accessed.
 *
 * Load this script in the page context of https://web.parsec.app after connecting.
 * Then call:
 *   ParsecAudioOnly.enable()  // request video pause, keep audio handling unchanged
 *   ParsecAudioOnly.status()
 *   ParsecAudioOnly.metrics() // passive received-byte counts; no audio content read
 *   ParsecAudioOnly.disable() // restore normal video requests and request video
 *   ParsecAudioOnly.toggle()
 * Reloading the page removes this helper. Reconnects require calling enable again.
 * Do not paste scripts from untrusted sources into an authenticated page.
 */
(function installParsecVideoPause(global) {
  "use strict";

  const marker = "codex-parsec-browser-video-pause-v1";
  if (global.ParsecAudioOnly !== undefined) {
    if (global.ParsecAudioOnly.marker === marker) return;
    throw new Error("ParsecAudioOnly already exists; reload the page before installing this helper.");
  }

  let state = null;

  function now() { return global.performance.now(); }

  function currentClient() {
    // PARSEC is a global lexical variable in the current public weblib.js.
    return typeof PARSEC === "undefined" ? null : PARSEC;
  }

  function connectedTransport() {
    if (global.location.origin !== "https://web.parsec.app") {
      throw new Error("This helper only supports the official https://web.parsec.app page.");
    }
    const client = currentClient();
    if (!client || typeof client.clientGetStatus !== "function" ||
        typeof client.clientPollAudio !== "function" ||
        typeof client.setVideoProtocolMetadata !== "function") {
      throw new Error("The expected Parsec browser interface is unavailable or has changed.");
    }
    if (client.clientGetStatus() !== 0) {
      throw new Error("Connect to the Windows host before requesting video pause.");
    }
    const transport = client.b;
    const control = transport && transport.c && transport.c[0];
    if (!transport || typeof transport.send !== "function" || !control ||
        control.label !== "control" || control.readyState !== "open") {
      throw new Error("The expected open Parsec control channel is unavailable or has changed.");
    }
    return transport;
  }

  function packet(type) {
    const data = new ArrayBuffer(13);
    new DataView(data).setInt8(12, type);
    return data;
  }

  function isExactReinit(data, channel) {
    if (channel !== 0 || !(data instanceof ArrayBuffer) || data.byteLength !== 13) return false;
    const view = new DataView(data);
    return view.getInt8(12) === 13 && view.getInt32(0) === 0 &&
      view.getInt32(4) === 0 && view.getInt32(8) === 0;
  }

  function isCurrent(entry) {
    try { return connectedTransport() === entry.transport; }
    catch (_) { return false; }
  }

  function status() {
    let connected = false;
    try { connectedTransport(); connected = true; } catch (_) { /* No packets or secrets. */ }
    const attached = Boolean(state && state.enabled && isCurrent(state));
    return {
      videoPauseRequested: attached,
      connected,
      reconnectNeedsEnable: Boolean(state && !attached),
      ownsTransportWrapper: Boolean(state && state.transport.send === state.wrapper),
      microphoneReturn: "not provided",
      measuredVideoStopped: false
    };
  }

  function metrics() {
    const current = state && state.enabled && isCurrent(state) ? state : null;
    const time = now();
    const observed = current && current.observed;
    return {
      monitoringAvailable: Boolean(observed && observed.monitoringAvailable),
      sinceEnabledMs: current ? Math.max(0, time - current.startedAt) : 0,
      audioBytesReceived: observed ? observed.audioBytesReceived : 0,
      videoBytesReceived: observed ? observed.videoBytesReceived : 0,
      lastAudioAgoMs: observed && observed.lastAudioAt !== null ? Math.max(0, time - observed.lastAudioAt) : null,
      lastVideoAgoMs: observed && observed.lastVideoAt !== null ? Math.max(0, time - observed.lastVideoAt) : null
    };
  }

  function observeIncoming(entry) {
    entry.observed = {
      monitoringAvailable: false,
      audioBytesReceived: 0,
      videoBytesReceived: 0,
      lastAudioAt: null,
      lastVideoAt: null
    };
    entry.listeners = [];
    const video = entry.transport.c[1];
    const audio = entry.transport.c[2];
    const supportsEvents = channel => channel && typeof channel.addEventListener === "function" &&
      typeof channel.removeEventListener === "function";
    if (!supportsEvents(video) || video.label !== "video" ||
        !supportsEvents(audio) || audio.label !== "audio") return;

    function listen(channel, event, listener) {
      channel.addEventListener(event, listener);
      entry.listeners.push([channel, event, listener]);
    }
    for (const [channel, kind] of [[audio, "audio"], [video, "video"]]) {
      listen(channel, "message", event => {
        if (!entry.enabled) return;
        // Current Parsec sets binaryType='arraybuffer'. Count lengths only.
        const size = event.data && event.data.byteLength;
        if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return;
        entry.observed[kind + "BytesReceived"] += size;
        entry.observed[kind === "audio" ? "lastAudioAt" : "lastVideoAt"] = now();
      });
    }
    const control = entry.transport.c[0];
    if (supportsEvents(control)) listen(control, "close", () => detach(entry));
    entry.observed.monitoringAvailable = true;
  }

  function detach(entry) {
    entry.enabled = false;
    for (const [channel, event, listener] of entry.listeners || []) {
      channel.removeEventListener(event, listener);
    }
    entry.listeners = [];
    // Leave later third-party wrappers in place; any nested copy of ours becomes inert.
    if (entry.transport.send === entry.wrapper) {
      if (entry.hadOwnSend) entry.transport.send = entry.original;
      else delete entry.transport.send;
    }
  }

  function disable() {
    if (!state) return status();
    const entry = state;
    const resumeCurrentConnection = isCurrent(entry);
    detach(entry);
    state = null;
    if (resumeCurrentConnection) entry.transport.send(packet(13), 0);
    return status();
  }

  function enable() {
    const transport = connectedTransport();
    if (state && state.enabled && state.transport === transport) return status();
    if (state) { detach(state); state = null; }

    const entry = {
      transport,
      original: transport.send,
      hadOwnSend: Object.prototype.hasOwnProperty.call(transport, "send"),
      startedAt: now(),
      enabled: true,
      wrapper: null
    };
    entry.wrapper = function videoPauseSend(data, channel, ...rest) {
      const outgoing = entry.enabled && this === transport && isExactReinit(data, channel)
        ? packet(19) : data;
      return Reflect.apply(entry.original, this, [outgoing, channel, ...rest]);
    };
    transport.send = entry.wrapper;
    if (transport.send !== entry.wrapper) throw new Error("Unable to attach the reversible transport helper.");
    state = entry;
    try {
      observeIncoming(entry);
      transport.send(packet(19), 0);
    } catch (error) {
      detach(entry);
      state = null;
      throw error;
    }
    return status();
  }

  global.ParsecAudioOnly = Object.freeze({
    marker,
    enable,
    disable,
    status,
    metrics,
    toggle() {
      return state && state.enabled && isCurrent(state) ? disable() : enable();
    }
  });
})(globalThis);

    /*
 * Experimental Parsec browser microphone sender. Load on https://web.parsec.app.
 * Start from a user click after connecting; the Windows host microphone must
 * already be enabled. No host configuration, identity, or audio codec is changed.
 * API: ParsecMicrophone.start({deviceId?}), stop(), mute(boolean), devices(), status().
 * Transmitted frames are counted, not acknowledged as received by the host.
 * Reload removes this helper. Reconnection never restarts microphone capture.
 */
(function installParsecMicrophone(global) {
  "use strict";
  const marker = "codex-parsec-browser-microphone-v1";
  if (global.ParsecMicrophone !== undefined) {
    if (global.ParsecMicrophone.marker === marker) return;
    throw new Error("ParsecMicrophone already exists; reload before installing this helper.");
  }

  const PACKET_BYTES = 1945;
  const FRAME_SAMPLES = 480;
  const MAX_BUFFERED_BYTES = PACKET_BYTES * 5;
  let active = null;
  let desiredMute = false;
  let hostObservation = { transport: null, value: "unknown" };
  let last = {
    state: "idle", muted: false, hostMicrophone: "unknown", sentFrames: 0,
    droppedFrames: 0, sampleRate: null, deviceLabel: null, lastError: null
  };

  // This source is created locally as a Blob; it loads no external code.
  const processorSource = `
    class ParsecMicrophoneCapture extends AudioWorkletProcessor {
      constructor() {
        super();
        this.previous = 0;
        this.inputIndex = 0;
        this.outputIndex = 0;
        this.havePrevious = false;
        this.frame = new Int16Array(480);
        this.used = 0;
        this.muted = false;
        this.port.onmessage = event => {
          if (event.data && event.data.type === 'mute') this.muted = !!event.data.value;
        };
      }
      emit(value, captureAt) {
        value = this.muted || !Number.isFinite(value) ? 0 : Math.max(-1, Math.min(1, value));
        this.frame[this.used++] = Math.round(value < 0 ? value * 32768 : value * 32767);
        if (this.used === 480) {
          const samples = this.frame.buffer;
          this.port.postMessage({ type: 'frame', samples, captureAt }, [samples]);
          this.frame = new Int16Array(480);
          this.used = 0;
        }
      }
      process(inputs, outputs) {
        // The node must stay connected to run; its entire audible output is zero.
        for (const bus of outputs) for (const channel of bus) channel.fill(0);
        const channels = inputs[0];
        if (!channels || channels.length === 0 || channels[0].length === 0) return true;
        const count = channels[0].length;
        for (let i = 0; i < count; i++) {
          let value = 0;
          for (const channel of channels) {
            const sample = channel[i];
            value += Number.isFinite(sample) ? sample : 0;
          }
          value /= channels.length;
          if (!this.havePrevious) {
            this.previous = value;
            this.havePrevious = true;
          }
          // Absolute counters avoid drift across render quanta. Linear interpolation
          // retains one input sample of history, including at non-48-kHz rates.
          let position = this.outputIndex * sampleRate / 48000;
          while (position <= this.inputIndex + 1e-9) {
            const fraction = this.inputIndex === 0 ? 1 : position - (this.inputIndex - 1);
            const interpolated = this.previous + (value - this.previous) * fraction;
            this.emit(interpolated, currentTime + i / sampleRate);
            this.outputIndex++;
            position = this.outputIndex * sampleRate / 48000;
          }
          this.previous = value;
          this.inputIndex++;
        }
        return true;
      }
    }
    registerProcessor('parsec-microphone-capture-v1', ParsecMicrophoneCapture);
  `;

  function client() { return typeof PARSEC === "undefined" ? null : PARSEC; }

  function connection() {
    if (global.location.origin !== "https://web.parsec.app") {
      throw new Error("Open the official https://web.parsec.app page before starting the microphone.");
    }
    const current = client();
    if (!current || typeof current.clientGetStatus !== "function" ||
        typeof current.clientPollAudio !== "function" ||
        typeof current.setVideoProtocolMetadata !== "function") {
      throw new Error("The expected Parsec browser interface is unavailable or has changed.");
    }
    if (current.clientGetStatus() !== 0) throw new Error("Connect to the host before starting the microphone.");
    const transport = current.b;
    const control = transport && transport.c && transport.c[0];
    if (!transport || typeof transport.send !== "function" || !control ||
        control.label !== "control" || control.readyState !== "open" ||
        typeof control.addEventListener !== "function" ||
        typeof control.removeEventListener !== "function") {
      throw new Error("The expected open Parsec control channel is unavailable or has changed.");
    }
    return { client: current, transport, control };
  }

  function isCurrent(entry) {
    try {
      const current = connection();
      return current.client === entry.client && current.transport === entry.transport &&
        current.control === entry.control;
    } catch (_) { return false; }
  }

  function snapshot(entry) {
    return {
      state: entry.phase === "running" && entry.muted ? "muted" : entry.phase,
      muted: entry.muted, hostMicrophone: entry.hostMicrophone,
      sentFrames: entry.sentFrames, droppedFrames: entry.droppedFrames,
      sampleRate: entry.context ? entry.context.sampleRate : null,
      deviceLabel: entry.deviceLabel, lastError: entry.lastError
    };
  }

  function status() {
    let current = null;
    try { current = connection(); } catch (_) { /* Read-only connection check. */ }
    const result = active ? snapshot(active) : { ...last };
    if (!current || hostObservation.transport !== current.transport) result.hostMicrophone = "unknown";
    return { ...result, connected: Boolean(current) };
  }

  function stopTracks(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch (_) { /* Continue releasing other resources. */ }
    }
  }

  function listen(entry, target, type, callback) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, callback);
    entry.listeners.push([target, type, callback]);
  }

  function finish(entry, error) {
    if (entry.cancelled) return entry.cleanupPromise || Promise.resolve();
    entry.cancelled = true;
    entry.lastError = error ? error.message : null;
    entry.phase = error ? "error" : "idle";
    entry.cancel(new Error(error ? error.message : "Microphone start was cancelled."));
    global.clearInterval(entry.timer);
    for (const [target, type, listener] of entry.listeners) target.removeEventListener(type, listener);
    entry.listeners.length = 0;
    if (entry.worklet) entry.worklet.port.onmessage = null;
    for (const node of [entry.source, entry.worklet, entry.gain]) {
      if (node) { try { node.disconnect(); } catch (_) { /* Already disconnected. */ } }
    }
    stopTracks(entry.stream);
    entry.stream = null;
    if (entry.blobURL) {
      global.URL.revokeObjectURL(entry.blobURL);
      entry.blobURL = null;
    }
    // Readiness is observed only while this session has a control listener.
    // After stopping, host settings may change without another event reaching us.
    if (hostObservation.transport === entry.transport) {
      hostObservation = { transport: null, value: "unknown" };
    }
    if (active === entry) {
      last = snapshot(entry);
      active = null;
    }
    try {
      entry.cleanupPromise = Promise.resolve(entry.context && entry.context.close()).catch(() => {});
    } catch (_) { entry.cleanupPromise = Promise.resolve(); }
    return entry.cleanupPromise;
  }

  function assertActive(entry) {
    if (entry.cancelled) throw new Error("Microphone start was cancelled.");
    if (!isCurrent(entry)) throw new Error("The Parsec connection changed. Start the microphone again after reconnecting.");
    if (entry.hostMicrophone === "disabled") throw new Error("The host reports that its microphone is disabled.");
  }

  function hostState(data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 14) return null;
    const view = new DataView(data);
    if (view.getUint8(12) !== 17 || view.getUint32(4, false) !== 18) return null;
    const length = view.getUint32(0, false);
    if ((length !== 1 && length !== 2) || data.byteLength !== 13 + length ||
        (length === 2 && view.getUint8(14) !== 0)) return null;
    return view.getUint8(13) === 48 ? "disabled" : view.getUint8(13) === 49 ? "enabled" : null;
  }

  function observe(entry) {
    listen(entry, entry.control, "message", event => {
      if (entry.cancelled || !isCurrent(entry)) return;
      const value = hostState(event.data);
      if (!value) return;
      entry.hostMicrophone = value;
      hostObservation = { transport: entry.transport, value };
      if (value === "disabled") finish(entry, new Error("The host reports that its microphone is disabled."));
    });
    const disconnected = () => finish(entry, new Error("The Parsec connection closed. Reconnect and start the microphone again."));
    listen(entry, entry.control, "close", disconnected);
    listen(entry, entry.control, "error", disconnected);
    listen(entry, global, "pagehide", () => finish(entry));
    entry.timer = global.setInterval(() => {
      if (entry.cancelled) return;
      if (!isCurrent(entry)) {
        finish(entry, new Error("The Parsec connection changed. Reconnect and start the microphone again."));
      } else if (entry.stream && entry.stream.getAudioTracks().some(track => track.readyState === "ended")) {
        finish(entry, new Error("The microphone disconnected or stopped. Select an input and start again."));
      }
    }, 150);
  }

  function packet(samples, muted) {
    const buffer = new ArrayBuffer(PACKET_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, 1932, false);
    view.setUint32(4, 1, false);
    view.setUint32(8, 0xF055F055, false);
    view.setUint8(12, 32);
    view.setUint32(13, 12, true);
    if (!muted) {
      const pcm = new Int16Array(samples);
      for (let i = 0; i < FRAME_SAMPLES; i++) view.setInt16(17 + i * 2, pcm[i], true);
    }
    // The second 960-byte half and reserved tail remain zero initialized.
    view.setUint32(1937, 960, true);
    view.setUint8(1941, 0); // Raw PCM, as in the inspected native microphone path.
    return buffer;
  }

  function captured(entry, event) {
    if (entry.cancelled || entry.phase !== "running") return;
    try { assertActive(entry); } catch (error) { finish(entry, error); return; }
    const frame = event.data;
    if (!frame || frame.type !== "frame" || !(frame.samples instanceof ArrayBuffer) ||
        frame.samples.byteLength !== FRAME_SAMPLES * 2) return;
    // Discard stale worklet messages and congested frames instead of adding delay.
    if (entry.control.bufferedAmount > MAX_BUFFERED_BYTES ||
        (Number.isFinite(frame.captureAt) && entry.context.currentTime - frame.captureAt > 0.05)) {
      entry.droppedFrames++;
      return;
    }
    try {
      entry.transport.send(packet(frame.samples, entry.muted), 0);
      entry.sentFrames++;
    } catch (_) { finish(entry, new Error("The microphone frame could not be sent. Reconnect and start again.")); }
  }

  async function requestStream(entry, deviceId) {
    assertActive(entry);
    const audio = { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const pending = global.navigator.mediaDevices.getUserMedia({ audio, video: false }).then(stream => {
      if (entry.cancelled) stopTracks(stream);
      return stream;
    });
    const stream = await Promise.race([pending, entry.cancellation]);
    // Register ownership before checking connection so cleanup also stops this stream.
    entry.stream = stream;
    for (const track of stream.getAudioTracks()) track.enabled = !entry.muted;
    assertActive(entry);
    if (!stream.getAudioTracks().length) throw new Error("Chrome did not provide an audio input.");
    return stream;
  }

  async function run(entry, options) {
    try {
      let stream = await requestStream(entry, options.deviceId);
      if (!options.deviceId) {
        const inputs = await Promise.race([global.navigator.mediaDevices.enumerateDevices(), entry.cancellation]);
        assertActive(entry);
        const airPods = inputs.find(device => device.kind === "audioinput" && /AirPods/i.test(device.label));
        const track = stream.getAudioTracks()[0];
        const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
        if (airPods && airPods.deviceId && settings.deviceId !== airPods.deviceId) {
          stopTracks(stream);
          entry.stream = null;
          stream = await requestStream(entry, airPods.deviceId);
        }
      }
      assertActive(entry);
      const track = stream.getAudioTracks()[0];
      if (track.readyState === "ended") throw new Error("The selected microphone has stopped.");
      entry.deviceLabel = track.label || null;
      for (const audioTrack of stream.getAudioTracks()) {
        listen(entry, audioTrack, "ended", () => finish(entry, new Error("The microphone disconnected or stopped. Select an input and start again.")));
      }
      await Promise.race([entry.resuming, entry.cancellation]);
      assertActive(entry);
      if (entry.resumeError || entry.context.state !== "running") {
        throw new Error("Chrome could not start its audio engine. Click Start microphone again.");
      }
      entry.blobURL = global.URL.createObjectURL(new global.Blob([processorSource], { type: "text/javascript" }));
      await Promise.race([entry.context.audioWorklet.addModule(entry.blobURL), entry.cancellation]);
      assertActive(entry);
      global.URL.revokeObjectURL(entry.blobURL);
      entry.blobURL = null;
      entry.source = entry.context.createMediaStreamSource(stream);
      entry.worklet = new global.AudioWorkletNode(entry.context, "parsec-microphone-capture-v1", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
      });
      entry.gain = entry.context.createGain();
      entry.gain.gain.value = 0;
      entry.worklet.port.onmessage = event => captured(entry, event);
      entry.worklet.port.postMessage({ type: "mute", value: entry.muted });
      listen(entry, entry.worklet, "processorerror", () =>
        finish(entry, new Error("Chrome's microphone processor stopped. Click Start microphone again.")));
      entry.source.connect(entry.worklet);
      entry.worklet.connect(entry.gain);
      entry.gain.connect(entry.context.destination);
      listen(entry, entry.context, "statechange", () => {
        if (!entry.cancelled && entry.phase === "running" && entry.context.state !== "running") {
          finish(entry, new Error("Chrome paused its audio engine. Click Start microphone again."));
        }
      });
      entry.phase = "running";
      return status();
    } catch (error) {
      if (!entry.cancelled) {
        const message = error && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in Chrome before starting again."
          : error && error.message ? error.message : "Microphone capture could not start.";
        await finish(entry, new Error(message));
      }
      throw new Error(entry.lastError || "Microphone start was cancelled.");
    }
  }

  function start(options = {}) {
    if (active) return active.phase === "starting" ? active.startPromise : Promise.resolve(status());
    let entry;
    try {
      if (!options || (options.deviceId !== undefined && typeof options.deviceId !== "string")) {
        throw new Error("deviceId must be a microphone device ID string.");
      }
      const current = connection();
      if (!global.navigator.mediaDevices || typeof global.navigator.mediaDevices.getUserMedia !== "function" ||
          typeof global.navigator.mediaDevices.enumerateDevices !== "function" ||
          typeof global.AudioContext !== "function" || typeof global.AudioWorkletNode !== "function") {
        throw new Error("This Chrome page does not provide the required microphone and AudioWorklet APIs.");
      }
      if (hostObservation.transport !== current.transport) hostObservation = { transport: current.transport, value: "unknown" };
      if (hostObservation.value === "disabled") throw new Error("The host reports that its microphone is disabled.");
      entry = {
        ...current, phase: "starting", cancelled: false, muted: desiredMute,
        hostMicrophone: hostObservation.value, sentFrames: 0, droppedFrames: 0,
        deviceLabel: null, lastError: null, listeners: [], stream: null, context: null,
        source: null, worklet: null, gain: null, blobURL: null, timer: null
      };
      entry.cancellation = new Promise((resolve, reject) => { entry.cancel = reject; });
      entry.cancellation.catch(() => {});
      active = entry;
      observe(entry);
      // Resume is requested synchronously from the Start click, before permission awaits.
      try { entry.context = new global.AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); }
      catch (error) {
        if (error && error.name === "NotSupportedError") entry.context = new global.AudioContext({ latencyHint: "interactive" });
        else throw error;
      }
      if (!entry.context.audioWorklet) throw new Error("Chrome AudioWorklet support is unavailable.");
      entry.resuming = Promise.resolve(entry.context.resume()).catch(error => { entry.resumeError = error; });
      entry.startPromise = run(entry, options);
      return entry.startPromise;
    } catch (error) {
      if (entry) finish(entry, error);
      else last = { ...last, state: "error", lastError: error.message };
      return Promise.reject(error);
    }
  }

  async function stop() {
    if (active) await finish(active);
    else last = { ...last, state: "idle", lastError: null };
    return status();
  }

  function mute(value) {
    if (typeof value !== "boolean") throw new Error("Pass true or false to mute().");
    desiredMute = value;
    if (active) {
      active.muted = value;
      if (active.stream) {
        for (const track of active.stream.getAudioTracks()) track.enabled = !value;
      }
      if (active.worklet) active.worklet.port.postMessage({ type: "mute", value });
    } else last = { ...last, muted: value };
    return status();
  }

  async function devices() {
    if (global.location.origin !== "https://web.parsec.app") throw new Error("Open the official Parsec web page first.");
    if (!global.navigator.mediaDevices || typeof global.navigator.mediaDevices.enumerateDevices !== "function") return [];
    const list = await global.navigator.mediaDevices.enumerateDevices();
    return list.filter(device => device.kind === "audioinput")
      .map(device => ({ deviceId: device.deviceId, label: device.label }));
  }

  Object.defineProperty(global, "ParsecMicrophone", {
    value: Object.freeze({ marker, start, stop, mute, devices, status }),
    configurable: true, enumerable: false, writable: false
  });
})(globalThis);


(function () {
  const reply = (id, ok, result) => window.postMessage({source:"parsec-audio-extension-page", id, ok, result: ok ? result : {error: String(result && result.message || result)}}, location.origin);
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (event.source !== window || !m || m.source !== "parsec-audio-extension-content" || typeof m.id !== "string") return;
    try {
      let result;
      switch(m.action) {
        case "status": result={audio:ParsecAudioOnly.status(), metrics:ParsecAudioOnly.metrics(), mic:ParsecMicrophone.status(), devices:await ParsecMicrophone.devices()}; break;
        case "video": result=ParsecAudioOnly.toggle(); break;
        case "startMic": result=await ParsecMicrophone.start(m.deviceId ? {deviceId:m.deviceId} : {}); break;
        case "mute": result=ParsecMicrophone.mute(m.value); break;
        case "stopMic": result=await ParsecMicrophone.stop(); break;
        case "reset": await ParsecMicrophone.stop(); result=ParsecAudioOnly.disable(); break;
        case "devices": result=await ParsecMicrophone.devices(); break;
        default: throw new Error("Unknown command");
      }
      reply(m.id,true,result);
    } catch(e) { reply(m.id,false,e); }
  });
})();
