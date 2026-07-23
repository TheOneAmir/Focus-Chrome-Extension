// Quiet Focus — popup script. Vanilla JS so the extension stays small.

// ---------- Modes ----------
const MODES = {
  deep:  { id:"deep",  label:"Deep Focus",   sub:"Long · binaural",  ratio:0.30, min:4, max:20, audio:"binaural", session:45 },
  skim:  { id:"skim",  label:"Quick Skim",   sub:"2–3 sentences · silent", ratio:0.12, min:2, max:3, audio:"off", session:10 },
  low:   { id:"low",   label:"Low Energy",   sub:"Headline · soft sine", ratio:0.06, min:1, max:2, audio:"calm", session:15 },
  hyper: { id:"hyper", label:"Hyperfocus",   sub:"Medium · lo-fi loop", ratio:0.22, min:3, max:12, audio:"lofi", session:90 },
};
const MODE_IDS = ["deep","skim","low","hyper"];

// ---------- TextRank (inlined; identical algorithm to the site) ----------
const STOPWORDS = new Set("a an the and or but if then else for of in on at to from by with as is are was were be been being have has had do does did this that these those it its i you he she we they them his her our their not no so just very also can will would should could may might".split(" "));
function tokenize(s){return s.toLowerCase().replace(/[^a-z0-9\s']/g," ").split(/\s+/).filter(t=>t.length>2 && !STOPWORDS.has(t));}
function splitSentences(t){return t.replace(/\s+/g," ").split(/(?<=[.!?])\s+(?=[A-Z"'(])/g).map(s=>s.trim()).filter(s=>s.length>20);}
function tfidf(sents){
  const tokens=sents.map(tokenize), df=new Map();
  tokens.forEach(toks=>{const seen=new Set(toks);seen.forEach(t=>df.set(t,(df.get(t)||0)+1));});
  const N=sents.length;
  return tokens.map(toks=>{
    const tf=new Map(); toks.forEach(t=>tf.set(t,(tf.get(t)||0)+1));
    const v=new Map();
    tf.forEach((c,term)=>{const idf=Math.log((N+1)/((df.get(term)||0)+1))+1; v.set(term,c*idf);});
    return v;
  });
}
function cosine(a,b){let dot=0,am=0,bm=0; a.forEach(v=>am+=v*v); b.forEach(v=>bm+=v*v); const [s,big]=a.size<b.size?[a,b]:[b,a]; s.forEach((v,k)=>{const bv=big.get(k); if(bv) dot+=v*bv;}); if(!am||!bm) return 0; return dot/(Math.sqrt(am)*Math.sqrt(bm));}
function pagerank(m,iters=30,d=0.85){const n=m.length;if(!n) return []; const sc=Array(n).fill(1/n); const sums=m.map(r=>r.reduce((a,b)=>a+b,0)); for(let it=0;it<iters;it++){const next=Array(n).fill((1-d)/n); for(let i=0;i<n;i++)for(let j=0;j<n;j++){if(i===j||!sums[j]) continue; next[i]+=d*(m[j][i]/sums[j])*sc[j];} for(let i=0;i<n;i++) sc[i]=next[i];} return sc;}
function textrank(text, opt){
  const sents=splitSentences(text); if(sents.length===0) return [];
  if(sents.length<=2) return sents;
  const vecs=tfidf(sents), n=sents.length;
  const m=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){const s=cosine(vecs[i],vecs[j]); m[i][j]=s; m[j][i]=s;}
  const sc=pagerank(m);
  let pick=Math.round(n*(opt.ratio||0.2));
  pick=Math.max(opt.min||1, pick);
  pick=Math.min(opt.max||n, pick, n);
  return sc.map((s,i)=>({i,s})).sort((a,b)=>b.s-a.s).slice(0,pick).map(r=>r.i).sort((a,b)=>a-b).map(i=>sents[i]);
}
const WPM=230;
function wc(s){return s.trim().split(/\s+/).filter(Boolean).length;}

async function summarize(text, modeId){
  const mode = MODES[modeId];
  const original = wc(text);
  let sentences = [];
  let method = "textrank";
  try {
    if (self.Summarizer && self.Summarizer.create && self.Summarizer.availability) {
      const status = await self.Summarizer.availability();
      if (status === "available" || status === "readily") {
        const s = await self.Summarizer.create({ type:"key-points",
          length: mode.ratio>0.2?"long":mode.ratio>0.1?"medium":"short" });
        sentences = splitSentences(await s.summarize(text));
        method = "chrome-ai";
      }
    }
  } catch {/* fall through */}
  if (sentences.length === 0)
    sentences = textrank(text, { ratio: mode.ratio, min: mode.min, max: mode.max });
  const sw = wc(sentences.join(" "));
  return { sentences, method, originalWordCount: original, summaryWordCount: sw,
    minutesSaved: Math.max(0, Math.round((original - sw)/WPM)) };
}

async function contentHash(text){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,32);
}

// ---------- Audio ----------
class AmbientPlayer {
  constructor(){ this.ctx=null; this.nodes=[]; this.master=null; this.muted=false; }
  start(mode){
    this.stop();
    if (mode.audio === "off") return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx(); this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0.08; master.connect(ctx.destination); this.master = master;
    if (mode.audio==="binaural") this.binaural(ctx, master);
    else if (mode.audio==="calm") this.calmSine(ctx, master);
    else if (mode.audio==="lofi") this.lofi(ctx, master);
  }
  stop(){ this.nodes.forEach(n=>{try{n.stop&&n.stop();}catch{} n.disconnect&&n.disconnect();}); this.nodes=[]; if(this.ctx){this.ctx.close().catch(()=>{}); this.ctx=null;} this.master=null; }
  binaural(ctx,out){const m=ctx.createChannelMerger(2);const L=ctx.createOscillator();const R=ctx.createOscillator();L.frequency.value=110;R.frequency.value=116;L.connect(m,0,0);R.connect(m,0,1);m.connect(out);L.start();R.start();this.nodes.push(L,R,m);}
  calmSine(ctx,out){const o=ctx.createOscillator();o.type="sine";o.frequency.value=174;const lfo=ctx.createOscillator();lfo.frequency.value=0.1;const lg=ctx.createGain();lg.gain.value=6;lfo.connect(lg).connect(o.frequency);o.connect(out);o.start();lfo.start();this.nodes.push(o,lfo,lg);}
  lofi(ctx,out){[220,277.18,329.63].forEach((f,i)=>{const o=ctx.createOscillator();o.type=i===0?"triangle":"sine";o.frequency.value=f;const g=ctx.createGain();g.gain.value=0.05;o.connect(g).connect(out);o.start();this.nodes.push(o,g);});}
}

// ---------- Garden & Plant System ----------
function rand(seed){let s=seed|0;return()=>{s=(s*1664525+1013904223)|0;return ((s>>>0)%10000)/10000;};}
const PLANT_COLORS=["#8aab8e","#a3c1a7","#7e9e83","#c5d7b7","#b7c69a","#9db89f","#a8c5a3"];
const FLOWER_COLORS=["#e0b5c4","#f0d28a","#c9b0d8","#b8d4e6","#f5a3b8","#d4a5e8"];

// Generate unique plant characteristics
function generatePlant(){
  const seed = Math.floor(Math.random()*1e9);
  const r = rand(seed);
  return {
    id: Date.now() + "-" + Math.random().toString(36).substr(2,9),
    seed,
    stemColor: PLANT_COLORS[Math.floor(r()*PLANT_COLORS.length)],
    height: 25 + r()*45,
    leafCount: Math.floor(2 + r()*4),
    flowerColor: r()>0.4 ? FLOWER_COLORS[Math.floor(r()*FLOWER_COLORS.length)] : null,
    curvature: (r()-0.5)*15,
    timestamp: Date.now()
  };
}

// Render a single plant with its characteristics
function renderPlant(plant, x, baseY, scale=1){
  const r = rand(plant.seed);
  const h = plant.height * scale;
  const endX = x + plant.curvature * scale;
  const out = [];
  
  // Stem
  out.push(`<path d="M${x.toFixed(1)} ${baseY} Q ${((x+endX)/2).toFixed(1)} ${(baseY-h/2).toFixed(1)} ${endX.toFixed(1)} ${(baseY-h).toFixed(1)}" stroke="${plant.stemColor}" stroke-width="${(2+r()*1).toFixed(1)}" fill="none" stroke-linecap="round"/>`);
  
  // Leaves
  for(let i=0; i<plant.leafCount; i++){
    const leafY = baseY - (h * (0.3 + (i/plant.leafCount)*0.5));
    const leafX = x + (plant.curvature * (i/plant.leafCount)) + (r()>0.5?6:-6);
    const leafSize = 4 + r()*3;
    out.push(`<ellipse cx="${leafX.toFixed(1)}" cy="${leafY.toFixed(1)}" rx="${leafSize.toFixed(1)}" ry="${(leafSize*0.6).toFixed(1)}" fill="${plant.stemColor}" opacity="0.8"/>`);
  }
  
  // Flower
  if(plant.flowerColor){
    const petalCount = 5 + Math.floor(r()*3);
    for(let i=0; i<petalCount; i++){
      const angle = (i/petalCount)*Math.PI*2;
      const px = endX + Math.cos(angle)*3;
      const py = (baseY-h) + Math.sin(angle)*3;
      out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5" fill="${plant.flowerColor}" opacity="0.9"/>`);
    }
    out.push(`<circle cx="${endX.toFixed(1)}" cy="${(baseY-h).toFixed(1)}" r="2" fill="#f4d58d"/>`);
  }
  
  return out.join("\n");
}

// Render the garden with stored plants
function renderGarden(plants, width=320, height=140){
  const sky="#f7f5ef", soil="#cbb89a";
  const out=[];
  const max=Math.min(plants.length, 60);
  
  if(max === 0){
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect width="${width}" height="${height}" rx="14" fill="${sky}"/>
      <rect x="0" y="${height-18}" width="${width}" height="18" fill="${soil}"/>
      <text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#9aa0ad" font-size="12" font-family="system-ui">Complete a session to grow your first plant</text>
    </svg>`;
  }
  
  const baseY = height-22;
  const spacing = (width-16)/Math.max(max,1);
  
  for(let i=0; i<max; i++){
    const plant = plants[plants.length - max + i];
    const x = 8 + i*spacing + spacing/2;
    out.push(renderPlant(plant, x, baseY, 0.85));
  }
  
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <rect width="${width}" height="${height}" rx="14" fill="${sky}"/>
    <rect x="0" y="${height-18}" width="${width}" height="18" fill="${soil}"/>
    ${out.join("\n")}
  </svg>`;
}

// Render the currently growing plant
function renderGrowingPlant(plant, growthStage=1, width=320, height=120){
  if(!plant) return "";
  const sky="#f7f5ef", soil="#cbb89a";
  const baseY = height-18;
  const x = width/2;
  const plantSvg = renderPlant(plant, x, baseY, growthStage);
  
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <rect width="${width}" height="${height}" rx="14" fill="${sky}"/>
    <rect x="0" y="${height-18}" width="${width}" height="18" fill="${soil}"/>
    ${plantSvg}
  </svg>`;
}

// ---------- Gamification ----------
const SURPRISES = ["A bee visits your garden.","Tiny mushroom appeared overnight.","Something bloomed.","A leaf unfurled.","A small bird flew through.","The light shifted, just so."];
function weekStart(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-x.getDay());return x;}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function emptyState(){return{count:0,plants:[],seed:Math.floor(Math.random()*1e9),honestTags:0,weekStartIso:weekStart(new Date()).toISOString(),daysActiveThisWeek:0,bestWeek:0,lastActiveIso:"",graceUsedThisWeek:0,currentPlant:null};}
function recordCompletion(state,opts={}){
  const now=new Date(); const next={...state};
  const ws=weekStart(now);
  if (new Date(state.weekStartIso).getTime()!==ws.getTime()){
    next.bestWeek=Math.max(state.bestWeek,state.daysActiveThisWeek);
    next.weekStartIso=ws.toISOString(); next.daysActiveThisWeek=0; next.graceUsedThisWeek=0;
  }
  const last=state.lastActiveIso?new Date(state.lastActiveIso):null;
  if (!last || !sameDay(last,now)){ next.daysActiveThisWeek+=1; next.lastActiveIso=now.toISOString(); }
  next.count+=1;
  
  // Add current plant to garden if it exists
  if (state.currentPlant) {
    next.plants = [...(state.plants || []), state.currentPlant];
    // Keep only last 60 plants
    if (next.plants.length > 60) next.plants = next.plants.slice(-60);
    next.currentPlant = null;
  }
  
  if (opts.honestlyTagged) next.honestTags+=1;
  const surprise = Math.random()<0.18 ? SURPRISES[Math.floor(Math.random()*SURPRISES.length)] : null;
  return { state: next, surprise };
}

// ---------- Storage ----------
async function loadState(){
  const { state } = await chrome.storage.local.get("state");
  return state || emptyState();
}
async function saveState(s){ await chrome.storage.local.set({ state: s }); }
async function loadPrefs(){
  const { mode, audio } = await chrome.storage.local.get(["mode","audio"]);
  return { mode: mode || "deep", audio: !!audio };
}
async function savePrefs(p){ await chrome.storage.local.set(p); }

// ---------- Session timing ----------
async function loadSession(){
  const { qfSession } = await chrome.storage.local.get("qfSession");
  return qfSession || null;
}
async function saveSession(s){ await chrome.storage.local.set({ qfSession: s }); }
async function clearSession(){ await chrome.storage.local.remove("qfSession"); }

function fmtRemaining(ms){
  const totalSec = Math.ceil(ms/1000);
  const m = Math.floor(totalSec/60);
  const s = totalSec%60;
  return m>0 ? `${m} min ${s.toString().padStart(2,"0")}s` : `${s}s`;
}

async function cachedSummary(hash){
  const { cache } = await chrome.storage.local.get("cache");
  return (cache || {})[hash];
}
async function cacheSummary(hash, value){
  const { cache } = await chrome.storage.local.get("cache");
  const next = { ...(cache || {}) };
  next[hash] = value;
  // simple cap
  const keys = Object.keys(next);
  if (keys.length > 50) delete next[keys[0]];
  await chrome.storage.local.set({ cache: next });
}

// ---------- UI wiring ----------
const COUNT_URL = "https://kkyfdxaudhycuhtmctsd.supabase.co/rest/v1/rpc/get_focus_count";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtreWZkeGF1ZGh5Y3VodG1jdHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODIyMjksImV4cCI6MjA5Nzc1ODIyOX0.ppy94nBUSD_cvl4slKP9jnzag6K7bQP6rbILx9_rM2w";

const els = {
  modes: document.getElementById("modes"),
  summarize: document.getElementById("summarize"),
  session: document.getElementById("session-toggle"),
  audio: document.getElementById("audio-toggle"),
  audioLabel: document.getElementById("audio-label"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  currentPlantSection: document.getElementById("current-plant-section"),
  currentPlant: document.getElementById("current-plant"),
  plantTimer: document.getElementById("plant-timer"),
  plantProgress: document.getElementById("plant-progress"),
  plantProgressBar: document.getElementById("plant-progress-bar"),
  sessionStats: document.getElementById("session-stats"),
  garden: document.getElementById("garden"),
  gardenCount: document.getElementById("garden-count"),
  gardenMeta: document.getElementById("garden-meta"),
  surprise: document.getElementById("surprise"),
  others: document.getElementById("others"),
};

const player = new AmbientPlayer();
const ui = { mode: "deep", audio: false, lowStim: false, sessionActive: false };

function renderModes(){
  els.modes.innerHTML = "";
  MODE_IDS.forEach(id=>{
    const m = MODES[id];
    const b = document.createElement("button");
    b.className = "mode" + (ui.mode===id?" active":"");
    b.innerHTML = `<div class="name">${m.label}</div><div class="sub">${m.sub}</div>`;
    // Clicking a mode selects it and plays its ambient audio automatically
    // (silent modes turn audio off). The click is the user gesture the
    // AudioContext needs, so playback is allowed.
    b.onclick = ()=>{ ui.mode=id; savePrefs({mode:id}); renderModes(); setAudio(m.audio!=="off"); };
    els.modes.appendChild(b);
  });
}

let statsTimer = null;
function startStatsTimer(){
  stopStatsTimer();
  statsTimer = setInterval(renderCurrentPlantUI, 1000);
}
function stopStatsTimer(){
  if (statsTimer){ clearInterval(statsTimer); statsTimer = null; }
}

async function renderCurrentPlantUI(){
  const state = await loadState();
  if (!state.currentPlant) {
    els.currentPlantSection.hidden = true;
    els.plantTimer.textContent = "";
    els.plantProgress.hidden = true;
    stopStatsTimer();
    return;
  }
  els.currentPlantSection.hidden = false;

  const session = await loadSession();
  if (session) {
    const mode = MODES[session.mode] || MODES.deep;
    const durationMs = mode.session * 60000;
    const elapsed = Date.now() - session.startMs;
    const remaining = Math.max(0, durationMs - elapsed);
    const growth = Math.min(1, Math.max(0.15, elapsed / durationMs));
    const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));

    els.currentPlant.innerHTML = renderGrowingPlant(state.currentPlant, growth);
    els.plantProgress.hidden = false;
    els.plantProgressBar.style.width = pct + "%";
    if (remaining > 0) {
      els.plantTimer.textContent = `${fmtRemaining(remaining)} left`;
      els.sessionStats.textContent =
        `${mode.label} · ${mode.session} min session · ${pct}% grown`;
    } else {
      els.plantTimer.textContent = "Fully grown 🌸";
      els.sessionStats.textContent = "End your session to add this plant to your garden";
    }
  } else {
    els.currentPlant.innerHTML = renderGrowingPlant(state.currentPlant, 1);
    els.plantProgress.hidden = true;
    els.plantTimer.textContent = "";
    els.sessionStats.textContent = "Complete your session to add this plant to your garden";
  }
}
async function renderGardenUI(){
  const state = await loadState();
  const plants = state.plants || [];
  els.garden.innerHTML = renderGarden(plants);
  els.gardenCount.textContent = `${state.count} ${state.count===1?"growth":"growths"}`;
  els.gardenMeta.textContent = `Best week: ${state.bestWeek} days · This week: ${state.daysActiveThisWeek} days · grace left ${Math.max(0,2-state.graceUsedThisWeek)} · honest tags ${state.honestTags}`;
}
function setStatus(t){ els.status.textContent = t || ""; }
function applyLowStim(){
  // Honour the OS "reduce motion" accessibility setting automatically.
  const on = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  ui.lowStim = on;
  document.body.classList.toggle("low-stim", on);
}
function setAudio(on){
  ui.audio = on; els.audio.setAttribute("aria-pressed", String(on));
  els.audioLabel.textContent = on ? `Audio: ${MODES[ui.mode].audio}` : "Audio off";
  savePrefs({ audio: on });
  if (on) player.start(MODES[ui.mode]); else player.stop();
}

async function onSummarize(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab?.id){ setStatus("No active tab."); return; }
  els.summarize.disabled = true; setStatus("Reading page…");
  
  // Generate a new plant for this session
  let state = await loadState();
  if (!state.currentPlant) {
    state.currentPlant = generatePlant();
    await saveState(state);
    await renderCurrentPlantUI();
  }
  
  try {
    await chrome.scripting.executeScript({ target:{tabId: tab.id}, files:["content.js"] }).catch(()=>{});
    const resp = await chrome.tabs.sendMessage(tab.id, { type:"QF_EXTRACT" });
    if (!resp?.ok || !resp.data?.text) { setStatus("Couldn't read that page."); return; }
    const { text } = resp.data;
    const hash = await contentHash(text + "|" + ui.mode);
    let result = await cachedSummary(hash);
    if (!result) {
      setStatus("Summarizing…");
      result = await summarize(text, ui.mode);
      await cacheSummary(hash, result);
    } else {
      setStatus("From cache.");
    }
    showSummary(result, resp.data.title);
    state = await loadState();
    const { state: next, surprise } = recordCompletion(state);
    await saveState(next);
    await renderCurrentPlantUI();
    await renderGardenUI();
    if (surprise) flashSurprise(surprise);
  } catch (e) {
    setStatus("Couldn't summarize this page.");
  } finally {
    els.summarize.disabled = false;
  }
}

function showSummary(r, title){
  els.summary.hidden = false;
  const saved = r.minutesSaved>0 ? ` · saved you ~${r.minutesSaved} min` : "";
  const method = r.method==="chrome-ai" ? "Chrome on-device" : "TextRank";
  els.summary.innerHTML = `<div class="meta">${title ? escapeHtml(title)+" · " : ""}${method} · ${r.originalWordCount} → ${r.summaryWordCount} words${saved}</div>` +
    r.sentences.map(s=>`<p>${escapeHtml(s)}</p>`).join("");
  setStatus("");
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

let surpriseTimer;
function flashSurprise(text){
  els.surprise.hidden = false;
  els.surprise.textContent = "✦ " + text;
  els.surprise.classList.remove("animate");
  // restart animation
  void els.surprise.offsetWidth;
  els.surprise.classList.add("animate");
  clearTimeout(surpriseTimer);
  surpriseTimer = setTimeout(()=>{ els.surprise.hidden = true; }, ui.lowStim ? 1800 : 4500);
}

async function toggleSession(){
  ui.sessionActive = !ui.sessionActive;
  els.session.textContent = ui.sessionActive ? "End session" : "Start session";
  if (ui.sessionActive) {
    // Generate a new plant when starting a session
    let state = await loadState();
    if (!state.currentPlant) {
      state.currentPlant = generatePlant();
      await saveState(state);
    }
    await saveSession({ startMs: Date.now(), mode: ui.mode });
    await renderCurrentPlantUI();
    startStatsTimer();
    chrome.runtime.sendMessage({ type:"QF_HEARTBEAT_START" });
    const mins = (MODES[ui.mode] || MODES.deep).session;
    setStatus(`Session running · growing for ${mins} min. Heartbeats are anonymous.`);
  } else {
    stopStatsTimer();
    await clearSession();
    chrome.runtime.sendMessage({ type:"QF_HEARTBEAT_END" });
    // count session completion toward the garden
    const state = await loadState();
    const { state: next, surprise } = recordCompletion(state);
    await saveState(next);
    await renderCurrentPlantUI();
    await renderGardenUI();
    if (surprise) flashSurprise(surprise);
    setStatus("");
  }
}

async function refreshOthers(){
  try {
    const r = await fetch(COUNT_URL, { method:"POST", headers:{
      "Content-Type":"application/json","apikey":ANON_KEY,"Authorization":`Bearer ${ANON_KEY}` }, body:"{}" });
    const n = await r.json();
    // Only show when > 1, never "1 person" or "0 people".
    els.others.textContent = (typeof n === "number" && n > 1) ? `${n} others focusing` : "";
  } catch { els.others.textContent = ""; }
}

(async function init(){
  const prefs = await loadPrefs();
  ui.mode = prefs.mode;
  applyLowStim();
  renderModes();
  // Restore an in-progress session (popup may have been closed and reopened)
  const session = await loadSession();
  if (session) {
    ui.sessionActive = true;
    els.session.textContent = "End session";
    startStatsTimer();
  }
  await renderCurrentPlantUI();
  await renderGardenUI();
  if (prefs.audio) setAudio(true); else setAudio(false);
  els.summarize.onclick = onSummarize;
  els.session.onclick = toggleSession;
  els.audio.onclick = ()=> setAudio(!ui.audio);
  refreshOthers();
})();
