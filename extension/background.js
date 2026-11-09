// Open the helper only for the active Parsec tab that reported a connection.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.event !== "parsec-connected" || sender.id !== chrome.runtime.id ||
      !sender.tab?.active || sender.frameId !== 0 ||
      !sender.url?.startsWith("https://web.parsec.app/")) return;
  chrome.action.openPopup({ windowId: sender.tab.windowId }).catch(error => {
    console.warn("Could not automatically open Parsec Audio Helper:", error.message);
  });
});

// Extension reloads invalidate content scripts in existing tabs. Restore the
// helper without forcing the user to disconnect their Parsec session.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://web.parsec.app/*" });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }); }
    catch (error) { console.warn("Could not restore the Parsec page helper:", error.message); }
  }
});
