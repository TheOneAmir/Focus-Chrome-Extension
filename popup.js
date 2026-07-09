// Quiet Focus — popup script. Vanilla JS so the extension stays small.

// ---------- Modes ----------
const MODES = {
  deep:  { id:"deep",  label:"Deep Focus",   sub:"Long · binaural",  ratio:0.30, min:4, max:20, audio:"binaural", session:45 },
  skim:  { id:"skim",  label:"Quick Skim",   sub:"2–3 sentences · silent", ratio:0.12, min:2, max:3, audio:"off", session:10 },
  low:   { id:"low",   label:"Low Energy",   sub:"Headline · soft sine", ratio:0.06, min:1, max:2, audio:"calm", session:15 },
  hyper: { id:"hyper", label:"Hyperfocus",   sub:"Medium · lo-fi loop", ratio:0.22, min:3, max:12, audio:"lofi", session:90 },
};
const MODE_IDS = ["deep","skim","low","hyper"];

const ENERGY = [
  { id:"hyperfocus",  label:"Hyperfocus",  suggest:"hyper" },
  { id:"normal",      label:"Normal",      suggest:"deep" },
  { id:"low_battery", label:"Low battery", suggest:"skim" },
  { id:"zombie",      label:"Zombie",      suggest:"low" },
];

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

// ---------- Garden ----------
function rand(seed){let s=seed|0;return()=>{s=(s*1664525+1013904223)|0;return ((s>>>0)%10000)/10000;};}
const PLANT=["#8aab8e","#a3c1a7","#7e9e83","#c5d7b7","#b7c69a"];
const FLOWER=["#e0b5c4","#f0d28a","#c9b0d8","#b8d4e6"];
function renderGarden(state, width=320, height=140){
  const r=rand(state.seed||1);
  const sky="#f7f5ef", soil="#cbb89a";
  const out=[]; const max=Math.min(state.count,60);
  for(let i=0;i<max;i++){
    const x=8+(i/Math.max(max,1))*(width-16)+(r()-0.5)*8;
    const baseY=height-22; const h=18+r()*42+(i%5)*3;
    const c=PLANT[Math.floor(r()*PLANT.length)];
    out.push(`<path d="M${x.toFixed(1)} ${baseY} Q ${(x+(r()-0.5)*12).toFixed(1)} ${(baseY-h/2).toFixed(1)} ${x.toFixed(1)} ${(baseY-h).toFixed(1)}" stroke="${c}" stroke-width="${(1.5+r()*1.5).toFixed(1)}" fill="none" stroke-linecap="round"/>`);
    if (h>30){const ly=baseY-h*0.6; out.push(`<ellipse cx="${(x+(r()>0.5?5:-5)).toFixed(1)}" cy="${ly.toFixed(1)}" rx="5" ry="2.5" fill="${c}" opacity="0.85"/>`);}
    if (state.count>5 && r()<0.18){const fc=FLOWER[Math.floor(r()*FLOWER.length)]; out.push(`<circle cx="${x.toFixed(1)}" cy="${(baseY-h).toFixed(1)}" r="3.2" fill="${fc}"/>`);}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
  <rect width="${width}" height="${height}" rx="14" fill="${sky}"/>
  <rect x="0" y="${height-18}" width="${width}" height="18" fill="${soil}"/>
  ${out.join("\n")}
</svg>`;
}

// ---------- Gamification ----------
const SURPRISES = ["A bee visits your garden.","Tiny mushroom appeared overnight.","Something bloomed.","A leaf unfurled.","A small bird flew through.","The light shifted, just so."];
function weekStart(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-x.getDay());return x;}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function emptyState(){return{count:0,seed:Math.floor(Math.random()*1e9),honestTags:0,weekStartIso:weekStart(new Date()).toISOString(),daysActiveThisWeek:0,bestWeek:0,lastActiveIso:"",graceUsedThisWeek:0};}
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
  const { mode, energy, audio, lowStim } = await chrome.storage.local.get(["mode","energy","audio","lowStim"]);
  return { mode: mode || "deep", energy: energy || null, audio: !!audio, lowStim: !!lowStim };
}
async function savePrefs(p){ await chrome.storage.local.set(p); }

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
  energy: document.getElementById("energy"),
  summarize: document.getElementById("summarize"),
  session: document.getElementById("session-toggle"),
  audio: document.getElementById("audio-toggle"),
  audioLabel: document.getElementById("audio-label"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  garden: document.getElementById("garden"),
  gardenCount: document.getElementById("garden-count"),
  gardenMeta: document.getElementById("garden-meta"),
  surprise: document.getElementById("surprise"),
  lowStim: document.getElementById("low-stim"),
  others: document.getElementById("others"),
};

const player = new AmbientPlayer();
const ui = { mode: "deep", energy: null, audio: false, lowStim: false, sessionActive: false };

function renderModes(){
  els.modes.innerHTML = "";
  MODE_IDS.forEach(id=>{
    const m = MODES[id];
    const b = document.createElement("button");
    b.className = "mode" + (ui.mode===id?" active":"");
    b.innerHTML = `<div class="name">${m.label}</div><div class="sub">${m.sub}</div>`;
    b.onclick = ()=>{ ui.mode=id; savePrefs({mode:id}); renderModes(); restartAudioIfOn(); };
    els.modes.appendChild(b);
  });
}
function renderEnergy(){
  els.energy.innerHTML = "";
  ENERGY.forEach(e=>{
    const c = document.createElement("button");
    c.className = "chip" + (ui.energy===e.id?" active":"");
    c.textContent = e.label;
    c.onclick = ()=>{
      ui.energy = ui.energy===e.id ? null : e.id;
      savePrefs({ energy: ui.energy });
      if (ui.energy){ ui.mode = e.suggest; savePrefs({ mode: ui.mode }); renderModes(); }
      renderEnergy();
    };
    els.energy.appendChild(c);
  });
}
async function renderGardenUI(){
  const state = await loadState();
  els.garden.innerHTML = renderGarden({count: state.count, seed: state.seed});
  els.gardenCount.textContent = `${state.count} ${state.count===1?"growth":"growths"}`;
  els.gardenMeta.textContent = `Best week: ${state.bestWeek} days · This week: ${state.daysActiveThisWeek} days · grace left ${Math.max(0,2-state.graceUsedThisWeek)} · honest tags ${state.honestTags}`;
}
function setStatus(t){ els.status.textContent = t || ""; }
function setLowStim(on){
  ui.lowStim = on; els.lowStim.checked = on;
  document.body.classList.toggle("low-stim", on);
  savePrefs({ lowStim: on });
}
function restartAudioIfOn(){
  if (ui.audio) player.start(MODES[ui.mode]);
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
    const state = await loadState();
    const { state: next, surprise } = recordCompletion(state, { honestlyTagged: !!ui.energy });
    await saveState(next);
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
    chrome.runtime.sendMessage({ type:"QF_HEARTBEAT_START" });
    setStatus("Session running. Heartbeats are anonymous.");
  } else {
    chrome.runtime.sendMessage({ type:"QF_HEARTBEAT_END" });
    // count session completion toward the garden
    const state = await loadState();
    const { state: next, surprise } = recordCompletion(state, { honestlyTagged: !!ui.energy });
    await saveState(next);
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
  ui.mode = prefs.mode; ui.energy = prefs.energy;
  setLowStim(prefs.lowStim || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  renderModes(); renderEnergy(); await renderGardenUI();
  if (prefs.audio) setAudio(true); else setAudio(false);
  els.summarize.onclick = onSummarize;
  els.session.onclick = toggleSession;
  els.audio.onclick = ()=> setAudio(!ui.audio);
  els.lowStim.onchange = (e)=> setLowStim(e.target.checked);
  refreshOthers();
})();
