(() => {
  if (location.origin !== "https://web.parsec.app") return;
  if (globalThis.__parsecAudioContentInstalled) return;
  globalThis.__parsecAudioContentInstalled = true;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-bridge.js");
  const bridgeReady = new Promise((resolve, reject) => {
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error("Could not load the Parsec page helper. Reload the Parsec tab.")); };
  });
  bridgeReady.catch(() => {});
  (document.documentElement || document).appendChild(script);
  const pending = new Map();
  window.addEventListener("message", event => {
    const m = event.data;
    if (event.source !== window || !m || m.source !== "parsec-audio-extension-page") return;
    if (m.event === "connected") {
      chrome.runtime.sendMessage({ event: "parsec-connected" }).catch(() => {});
      return;
    }
    const resolve = pending.get(m.id);
    if (resolve) { pending.delete(m.id); resolve(m); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); sendResponse({ok:false,error:"Parsec page did not respond. Reload it and try again."}); }, 5000);
    pending.set(id, response => { clearTimeout(timer); sendResponse(response); });
    bridgeReady.then(() => {
      window.postMessage({...message, source:"parsec-audio-extension-content", id}, location.origin);
    }).catch(error => {
      clearTimeout(timer); pending.delete(id); sendResponse({ok:false,error:error.message});
    });
    return true;
  });
})();
