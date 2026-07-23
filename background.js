// MV3 service worker. Sends a heartbeat to the public Quiet Focus endpoint
// while a focus session is active. No identifying data — just a random uuid.

const HEARTBEAT_URL = "https://kkyfdxaudhycuhtmctsd.supabase.co/rest/v1/focus_sessions";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtreWZkeGF1ZGh5Y3VodG1jdHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODIyMjksImV4cCI6MjA5Nzc1ODIyOX0.ppy94nBUSD_cvl4slKP9jnzag6K7bQP6rbILx9_rM2w";

async function getSessionId() {
  const { sessionId } = await chrome.storage.local.get("sessionId");
  if (sessionId) return sessionId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ sessionId: id });
  return id;
}

async function heartbeat() {
  try {
    const id = await getSessionId();
    await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id, heartbeat_at: new Date().toISOString() }),
    });
  } catch {
    /* offline is fine */
  }
}

async function endSession() {
  try {
    const id = await getSessionId();
    await fetch(`${HEARTBEAT_URL}?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
  } catch {
    /* noop */
  }
}

async function configureSidePanel() {
  try {
    // Clicking the toolbar icon opens (and toggles) the side panel. A global
    // side panel stays open as the user switches tabs, so it acts as a
    // persistent focus tool across the browsing session.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Could not configure side panel", error);
  }
}

configureSidePanel();

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type === "QF_HEARTBEAT_START") {
    heartbeat();
    chrome.alarms.create?.("qf-heartbeat", { periodInMinutes: 1 });
    send({ ok: true });
  } else if (msg?.type === "QF_HEARTBEAT_END") {
    endSession();
    chrome.alarms.clear?.("qf-heartbeat");
    send({ ok: true });
  }
});

chrome.alarms?.onAlarm.addListener((a) => {
  if (a.name === "qf-heartbeat") heartbeat();
});
