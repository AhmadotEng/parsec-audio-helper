(() => {
  if (location.origin !== "https://web.parsec.app") return;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.onload = () => script.remove();
  (document.documentElement || document).appendChild(script);
  const pending = new Map();
  window.addEventListener("message", event => {
    const m = event.data;
    if (event.source !== window || !m || m.source !== "parsec-audio-extension-page") return;
    const resolve = pending.get(m.id);
    if (resolve) { pending.delete(m.id); resolve(m); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); sendResponse({ok:false,error:"Parsec page did not respond. Reload it and try again."}); }, 5000);
    pending.set(id, response => { clearTimeout(timer); sendResponse(response); });
    window.postMessage({...message, source:"parsec-audio-extension-content", id}, location.origin);
    return true;
  });
})();
