// Claudia – persönliche Assistentin (PWA, alle Daten lokal im Browser)
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const STORE = 'claudia.v1';
const KEY_STORE = 'claudia.apikey';
const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5 (klügste Wahl)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (schnell & günstiger)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (am günstigsten)',
};

// ---------- Speicher ----------
const defaults = () => ({
  tasks: [], notes: [], chat: [], notified: [], contacts: [], draftEdits: {}, draftSent: {},
  settings: { name: 'Gerhard', model: 'claude-opus-5-5', effort: 'low', autoSend: true, speak: true },
});
let S = load();
function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE)); if (d) return { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings } }; } catch {}
  return defaults();
}
function saveLocal() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { toast('Speichern fehlgeschlagen'); } }
function save() { saveLocal(); scheduleSync(); }
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const setKey = k => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} };

// ---------- Sync PC ↔ Handy (verschlüsselt in einem geheimen GitHub-Gist) ----------
// Drei-Wege-Abgleich je Datensatz-ID gegen den Stand des letzten Syncs (BASE_STORE):
// nur hier geändert → hier gewinnt, nur dort geändert → dort gewinnt, beide → dieses Gerät gewinnt.
// Löschen wird erkannt, weil der Datensatz im letzten Stand noch da war.
const SYNC_STORE = 'claudia.sync', BASE_STORE = 'claudia.syncbase', SYNC_FILE = 'claudia-sync.json';
const SYNC_COLS = ['tasks', 'notes', 'contacts'];
const syncCfg = () => { try { return JSON.parse(localStorage.getItem(SYNC_STORE)) || {}; } catch { return {}; } };
const setSyncCfg = o => { try { localStorage.setItem(SYNC_STORE, JSON.stringify(o)); } catch {} };
let syncTimer = null, syncing = false, syncAgain = false, syncMsg = '';
function scheduleSync(ms = 2500) { if (!syncCfg().token) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), ms); }
function syncLabel() {
  const c = syncCfg();
  if (syncMsg) return syncMsg;
  return c.last ? `✓ Zuletzt synchronisiert: ${new Date(c.last).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Noch nicht synchronisiert';
}
function setSyncMsg(m) { syncMsg = m; const el = document.getElementById('sync-state'); if (el) el.textContent = syncLabel(); }

const toB64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const keyCache = new Map();
async function syncKey(pass, salt) {
  const id = pass + '|' + toB64(salt);
  if (!keyCache.has(id)) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    keyCache.set(id, await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(id);
}
async function encryptData(obj, pass, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await syncKey(pass, salt), new TextEncoder().encode(JSON.stringify(obj)));
  return { app: 'Claudia', v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}
async function decryptData(env, pass) {
  if (env?.app !== 'Claudia' || !env.data) throw new Error('Sync-Datei ist beschädigt');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, await syncKey(pass, fromB64(env.salt)), fromB64(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { throw new Error('Sync-Passwort passt nicht zu den Daten der anderen Geräte'); }
}
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + syncCfg().token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (r.status === 401) throw new Error('GitHub-Token ungültig oder abgelaufen');
  if (r.status === 403 || r.status === 404) throw new Error('GitHub verweigert den Zugriff. Hat der Token das Recht „gist“?');
  if (!r.ok) throw new Error('GitHub antwortet mit Fehler ' + r.status);
  return r.json();
}
async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find(x => x.files?.[SYNC_FILE]); if (g) return g.id;
    if (list.length < 100) break;
  }
  return null;
}
const hash = x => JSON.stringify(x);
function merge3(local, remote, base) {
  const L = new Map(local.map(x => [x.id, x])), R = new Map(remote.map(x => [x.id, x])), out = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id), b = base[id];
    const lChanged = l ? hash(l) !== b : b !== undefined;
    const rChanged = r ? hash(r) !== b : b !== undefined;
    let pick;
    if (l && r) pick = rChanged && !lChanged ? r : l;
    else if (l) pick = b !== undefined && !lChanged ? null : l;   // dort gelöscht, hier unverändert → löschen
    else pick = b !== undefined && !rChanged ? null : r;          // hier gelöscht, dort unverändert → löschen
    if (pick) out.push(pick);
  }
  return out;
}
// Gleicher Kontakt auf zwei Geräten getrennt angelegt → zusammenführen (leere Felder ergänzen)
function dedupeContacts(list) {
  const m = new Map();
  for (const c of list) {
    const k = String(c.name || '').trim().toLowerCase(), o = m.get(k);
    if (!o) { m.set(k, c); continue; }
    for (const [f, v] of Object.entries(c)) if (f !== 'id' && (o[f] === undefined || o[f] === '' || o[f] === null)) o[f] = v;
  }
  return [...m.values()];
}
function getBase() { try { return JSON.parse(localStorage.getItem(BASE_STORE)) || {}; } catch { return {}; } }
function setBase(d) {
  const b = {}; for (const k of SYNC_COLS) { b[k] = {}; for (const x of d[k] || []) b[k][x.id] = hash(x); }
  try { localStorage.setItem(BASE_STORE, JSON.stringify(b)); } catch {}
}
async function syncNow(manual = false) {
  const cfg = syncCfg(); if (!cfg.token || !cfg.pass) return false;
  if (!navigator.onLine) { setSyncMsg('Offline – Sync folgt, sobald du online bist'); return false; }
  if (syncing) { syncAgain = true; return false; }
  syncing = true; setSyncMsg('Synchronisiere …');
  const snap = hash(SYNC_COLS.map(k => S[k]));
  try {
    if (!cfg.gistId) { cfg.gistId = await findGist(); if (cfg.gistId) setSyncCfg({ ...syncCfg(), gistId: cfg.gistId }); }
    let remote = null, salt = null;
    if (cfg.gistId) {
      const f = (await gh('/gists/' + cfg.gistId)).files?.[SYNC_FILE];
      if (f) {
        const env = JSON.parse(f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content);
        remote = await decryptData(env, cfg.pass); salt = fromB64(env.salt);
      }
    }
    const base = getBase(), merged = {};
    for (const k of SYNC_COLS) merged[k] = remote ? merge3(S[k] || [], remote[k] || [], base[k] || {}) : [...(S[k] || [])];
    merged.contacts = dedupeContacts(merged.contacts);
    merged.notes.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    // Während des Abgleichs lokal geändert? Dann nichts überschreiben, gleich nochmal.
    if (hash(SYNC_COLS.map(k => S[k])) !== snap) { syncAgain = true; return false; }
    if (SYNC_COLS.some(k => hash(merged[k]) !== hash(S[k]))) {
      Object.assign(S, merged); saveLocal();
      if (!dlg.open && !busy) render();
    }
    if (!remote || SYNC_COLS.some(k => hash(merged[k]) !== hash(remote[k] || []))) {
      const env = await encryptData({ at: Date.now(), tasks: merged.tasks, notes: merged.notes, contacts: merged.contacts }, cfg.pass, salt || crypto.getRandomValues(new Uint8Array(16)));
      const files = { [SYNC_FILE]: { content: JSON.stringify(env) } };
      if (cfg.gistId) await gh('/gists/' + cfg.gistId, { method: 'PATCH', body: JSON.stringify({ files }) });
      else { const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'Claudia – verschlüsselte Sync-Daten', public: false, files }) }); setSyncCfg({ ...syncCfg(), gistId: g.id }); }
    }
    setBase(merged);
    setSyncCfg({ ...syncCfg(), last: Date.now() });
    setSyncMsg('');
    if (manual) toast('Synchronisiert ✓');
    return true;
  } catch (e) {
    setSyncMsg('⚠︎ ' + (e.message || 'Sync fehlgeschlagen'));
    if (manual) toast(e.message || 'Sync fehlgeschlagen');
    return false;
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(800); }
  }
}

// ---------- Helfer ----------
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => { const z = new Date(d); z.setMinutes(z.getMinutes() - z.getTimezoneOffset()); return z.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const fmtDate = s => s ? new Date(s + 'T00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '';
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); }
const isOverdue = t => !t.done && t.due && t.due < today();
const isToday = t => !t.done && t.due === today();

function greeting() {
  const h = new Date().getHours();
  return (h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend') + ', ' + (S.settings.name || 'du');
}

// ---------- Aufgaben-Logik (auch von Claudia genutzt) ----------
function addTask({ title, due = '', time = '', cat = 'Privat' }) {
  const t = { id: uid(), title: title.trim(), due, time, cat: cat === 'Geschäftlich' ? 'Geschäftlich' : 'Privat', done: false, created: Date.now() };
  S.tasks.push(t); save(); return t;
}
// Erledigte Aufgaben werden nach kurzer Zeit gelöscht (Speicher klein halten). In den 6 s davor
// bleiben sie durchgestrichen sichtbar – nochmal tippen macht sie wieder offen.
const UNDO_MS = 6000;
const recentlyDone = t => t.done && t.doneAt && Date.now() - t.doneAt < UNDO_MS;
const shown = t => !t.done || recentlyDone(t);
function toggleTask(id, done) {
  const t = S.tasks.find(x => x.id === id); if (!t) return null;
  const was = t.done;
  t.done = done ?? !t.done; t.doneAt = t.done ? Date.now() : null;
  const day = today(); if (S.doneDay?.d !== day) S.doneDay = { d: day, n: 0 };
  if (t.done && !was) S.doneDay.n++; else if (!t.done && was) S.doneDay.n = Math.max(0, S.doneDay.n - 1);
  save();
  if (t.done) setTimeout(purgeDone, UNDO_MS + 100);
  return t;
}
function purgeDone() {
  const keep = S.tasks.filter(t => !t.done || recentlyDone(t));
  if (keep.length === S.tasks.length) return;
  S.tasks = keep;
  S.notified = S.notified.filter(id => keep.some(t => t.id === id));
  save();
  if (!dlg.open) render();
}
function addNote({ title, text = '' }) {
  const n = { id: uid(), title: (title || text.split('\n')[0] || 'Notiz').trim().slice(0, 80), text, updated: Date.now() };
  S.notes.unshift(n); save(); return n;
}
const sortTasks = arr => [...arr].sort((a, b) => (a.done - b.done) || ((a.due || '9999') + (a.time || '99')).localeCompare((b.due || '9999') + (b.time || '99')) || a.created - b.created);

// ---------- Ansichten ----------
let tab = 'today', taskFilter = 'offen', catFilter = 'Alle', noteQuery = '';
function go(t) {
  if (tab === 'chat' && t !== 'chat') clearDictationChat();
  tab = t;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  render();
}
function render() {
  const v = $('#view');
  v.innerHTML = { today: viewToday, tasks: viewTasks, notes: viewNotes, chat: viewChat }[tab]();
  bind(v);
  const badge = $('#contacts-badge'); if (badge) badge.textContent = allowed().length || '';
  if (tab === 'chat') scrollChat();
}

// ---------- Kalender (.ics mit Alarm) – klingelt über den Gerätekalender auch bei geschlossener App ----------
const canCal = t => t && !t.done && t.due && t.time;
function icsFor(t) {
  const txt = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const loc = (d, hm) => d.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';   // Ortszeit des Geräts
  const end = new Date(`${t.due}T${t.time}`); end.setMinutes(end.getMinutes() + 15);
  const pad = n => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Claudia//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${t.id}@claudia`, `DTSTAMP:${stamp}`,
    `DTSTART:${loc(t.due, t.time)}`, `DTEND:${loc(iso(end), pad(end.getHours()) + ':' + pad(end.getMinutes()))}`,
    `SUMMARY:${txt(t.title)}`, `DESCRIPTION:${txt('Erinnerung von Claudia (' + t.cat + ')')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(t.title)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
function addToCalendar(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!canCal(t)) { toast('Dafür braucht die Aufgabe Datum und Uhrzeit'); return; }
  const blob = new Blob([icsFor(t)], { type: 'text/calendar;charset=utf-8' });
  const name = (t.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'Erinnerung') + '.ics';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  t.cal = true; save(); render();
  toast('Termin wird geöffnet – dort „Hinzufügen“ tippen');
}
const calBtn = t => canCal(t)
  ? `<button class="mini cal ${t.cal ? 'on' : ''}" data-act="ics" data-id="${t.id}" aria-label="In Kalender eintragen" title="${t.cal ? 'Schon im Kalender – nochmal eintragen' : 'In Kalender eintragen (Alarm auch bei geschlossener App)'}">📅</button>` : '';

function taskRow(t) {
  const pills = [];
  if (isOverdue(t)) pills.push(`<span class="pill over">überfällig · ${fmtDate(t.due)}</span>`);
  else if (isToday(t)) pills.push(`<span class="pill today">heute${t.time ? ' ' + esc(t.time) : ''}</span>`);
  else if (t.due) pills.push(`<span>${fmtDate(t.due)}${t.time ? ' ' + esc(t.time) : ''}</span>`);
  pills.push(`<span class="pill ${t.cat === 'Privat' ? 'priv' : ''}">${esc(t.cat)}</span>`);
  return `<div class="card item ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="Erledigt">${t.done ? '✓' : ''}</button>
    <div class="body" data-act="edit-task" data-id="${t.id}" style="cursor:pointer">
      <div class="title">${esc(t.title)}</div><div class="meta">${pills.join('')}</div>
    </div>
    ${calBtn(t)}<button class="mini" data-act="del-task" data-id="${t.id}" aria-label="Löschen" title="Löschen">✕</button>
  </div>`;
}
const quickAdd = (ph = 'Neue Aufgabe … (Enter)') => `<form class="quick" data-form="quick-task">
  <input type="text" name="title" placeholder="${ph}" autocomplete="off" required>
  <button class="btn" aria-label="Hinzufügen">＋</button></form>`;

function viewToday() {
  const open = S.tasks.filter(shown);
  const over = sortTasks(open.filter(isOverdue));
  const tod = sortTasks(open.filter(isToday));
  const next = sortTasks(open.filter(t => t.due > today())).slice(0, 5);
  const doneToday = S.doneDay?.d === today() ? S.doneDay.n : 0;
  const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="greet"><img src="claudia.webp" alt="" class="portrait"><div><h1>${esc(greeting())}</h1><p class="sub">${date}</p></div></div>
  <button class="btn dictate" data-act="dictate">🎙 Diktieren</button>
  <div class="stats">
    <div class="card stat" data-act="goto" data-tab="tasks"><b>${tod.length}</b><span>heute fällig</span></div>
    <div class="card stat ${over.length ? 'alert' : ''}" data-act="goto" data-tab="tasks"><b>${over.length}</b><span>überfällig</span></div>
    <div class="card stat"><b>${doneToday}</b><span>heute erledigt</span></div>
  </div>
  ${quickAdd('Was steht heute an? (wird für heute angelegt)').replace('quick-task', 'quick-today')}
  ${over.length ? `<h2>Überfällig</h2><div class="list">${over.map(taskRow).join('')}</div>` : ''}
  <h2>Heute</h2><div class="list">${tod.map(taskRow).join('') || '<div class="card empty">Nichts fällig – genieß den Tag ☀︎</div>'}</div>
  ${next.length ? `<h2>Demnächst</h2><div class="list">${next.map(taskRow).join('')}</div>` : ''}
  ${S.notes.length ? `<h2>Letzte Notizen</h2><div class="list">${S.notes.slice(0, 3).map(noteRow).join('')}</div>` : ''}
  <h2>Claudia fragen</h2>
  <div class="suggest">${['Plane meinen Tag', 'Was ist überfällig?', 'Erinnere mich morgen an …'].map(s => `<button class="chip" data-act="ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
}

function viewTasks() {
  let list = S.tasks.filter(shown);
  if (catFilter !== 'Alle') list = list.filter(t => t.cat === catFilter);
  list = sortTasks(list);
  const chip = (val, cur, act) => `<button class="chip ${val === cur ? 'active' : ''}" data-act="${act}" data-v="${val}">${val[0].toUpperCase() + val.slice(1)}</button>`;
  return `<h1>Aufgaben</h1>
  ${quickAdd()}
  <div class="toolbar">
    <div class="chips">${['Alle', 'Privat', 'Geschäftlich'].map(v => chip(v, catFilter, 'cfilter')).join('')}</div>
  </div>
  <div class="list">${list.map(taskRow).join('') || '<div class="card empty">Keine Aufgaben in dieser Ansicht.</div>'}</div>
  <p class="hint" style="text-align:center">Erledigte Aufgaben werden automatisch gelöscht.</p>`;
}

function noteRow(n) {
  return `<div class="card note" data-act="edit-note" data-id="${n.id}">
    <div class="title">${esc(n.title)}</div>
    <div class="preview">${esc(n.text)}</div>
    <div class="meta">${new Date(n.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</div></div>`;
}
function viewNotes() {
  const q = noteQuery.toLowerCase();
  const list = S.notes.filter(n => !q || (n.title + ' ' + n.text).toLowerCase().includes(q));
  return `<h1>Notizen</h1>
  <div class="quick"><input type="search" id="note-q" placeholder="Notizen durchsuchen …" value="${esc(noteQuery)}">
  <button class="btn" data-act="new-note">＋ Neu</button></div>
  <h2>${list.length} Notiz${list.length === 1 ? '' : 'en'}</h2>
  <div class="list">${list.map(noteRow).join('') || '<div class="card empty">Noch keine Notizen.</div>'}</div>`;
}

// ---------- Chat-Ansicht ----------
let busy = false, liveText = '';
function viewChat() {
  const parts = [];
  for (const m of S.chat) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        const dict = m.content.startsWith(DICT);
        parts.push(`<div class="msg user">${dict ? '🎙 ' : ''}${esc(dict ? m.content.slice(DICT.length) : m.content)}</div>`);
      }
    } else if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'text' && b.text.trim()) parts.push(`<div class="msg bot">${esc(b.text.trim())}</div>`);
        if (b.type === 'tool_use' && b.name === 'prepare_message') parts.push(draftCard(b));
        else if (b.type === 'tool_use') {
          const t = (b.name === 'add_task' || b.name === 'update_task') ? taskOfTool(b) : null;
          parts.push(`<div class="msg tool">✦ ${esc(TOOL_LABEL[b.name] || b.name)}${canCal(t)
            ? ` · <button class="linkbtn" data-act="ics" data-id="${t.id}">📅 ${t.cal ? 'nochmal in' : 'In'} Kalender</button>` : ''}</div>`);
        }
      }
    } else if (m.role === 'ui-error') parts.push(`<div class="msg err">${esc(m.text)}</div>`);
  }
  if (busy) parts.push(`<div class="msg bot" id="live"><span id="live-t">${esc(liveText)}</span><span class="typing"></span></div>`);
  const empty = !S.chat.length && !busy;
  return `<div class="chat-wrap"><div class="toolbar" style="justify-content:space-between;align-items:center;margin-top:0">
      <h1 class="chat-title"><img src="claudia.webp" alt="" class="portrait">Claudia</h1>
      ${S.chat.length ? '<button class="btn ghost" data-act="new-chat">Neuer Chat</button>' : ''}</div>
    ${!getKey() ? `<div class="card" style="padding:14px;margin-bottom:12px">Für den Chat braucht Claudia einen Anthropic API-Key.
      <div style="margin-top:8px"><button class="btn" data-act="settings">API-Key eintragen</button></div></div>` : ''}
    ${empty ? `<p class="sub">Ich kenne deine Aufgaben und Notizen und kann neue anlegen, abhaken und suchen. Frag einfach.</p>
      <div class="suggest">${['Plane meinen Tag', 'Was ist diese Woche fällig?', 'Notiere: Reifenwechsel bis Ende November', 'Fasse meine Notizen zusammen'].map(s => `<button class="chip" data-act="ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <div class="chat">${parts.join('')}</div></div>
  <div class="composer"><form data-form="chat">
    <textarea name="q" placeholder="${rec ? 'Ich höre zu …' : 'Nachricht an Claudia …'}" rows="1" ${busy ? 'disabled' : ''}></textarea>
    <button type="button" class="btn mic ${rec ? 'listening' : ''}" data-act="dictate" ${busy ? 'disabled' : ''} aria-label="Diktieren" title="Diktieren">${rec ? '■' : '🎙'}</button>
    <button class="btn" ${busy ? 'disabled' : ''} aria-label="Senden">➤</button></form></div>`;
}

// Aufgabe, die ein Werkzeug-Aufruf angelegt/geändert hat (ID steht im zugehörigen Werkzeug-Ergebnis)
function taskOfTool(b) {
  if (b.input?.id) return S.tasks.find(x => x.id === b.input.id) || null;
  for (const m of S.chat) if (m.role === 'user' && Array.isArray(m.content))
    for (const r of m.content) if (r.type === 'tool_result' && r.tool_use_id === b.id && !r.is_error) {
      try { const id = JSON.parse(r.content).id; return S.tasks.find(x => x.id === id) || null; } catch { return null; }
    }
  return null;
}

// Diktat-Chats sind Wegwerf-Chats: Wer Claudia verlässt (anderer Reiter oder andere App), dessen Diktat-Chat wird gelöscht.
let clearPending = false;
const isDictationChat = () => S.chat.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(DICT));
function clearDictationChat() {
  if (!isDictationChat()) return;
  if (busy) { clearPending = true; return; }      // Claudia antwortet noch – danach löschen
  clearPending = false;
  S.chat = []; S.draftEdits = {}; S.draftSent = {}; saveLocal();
  if (document.visibilityState === 'visible') render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clearDictationChat(); });

// ---------- Nachrichten-Entwürfe (WhatsApp) ----------
const DICT = '[Diktiert] ';
const norm = s => String(s || '').trim().toLowerCase();
// Nur angehakte (freigegebene) Kontakte sind für Claudia sichtbar
const allowed = () => S.contacts.filter(c => c.on !== false);
function findContact(name) {
  const n = norm(name); if (!n) return null;
  const list = allowed();
  const exact = list.find(c => norm(c.name) === n); if (exact) return exact;
  // Alias (z. B. "meine Frau", "Frau"), mehrere durch Komma getrennt
  const aliasOf = c => String(c.alias || '').split(',').map(a => norm(a).replace(/^(meine?|mein)\s+/, '')).filter(Boolean);
  const nn = n.replace(/^(meine?|mein|an)\s+/, '');
  const byAlias = list.filter(c => aliasOf(c).includes(nn)); if (byAlias.length === 1) return byAlias[0];
  if (/^(mich|mir|ich|selbst)$/.test(nn)) { const me = list.find(c => c.self); if (me) return me; }
  const part = list.filter(c => norm(c.name).includes(n) || n.includes(norm(c.name)));
  return part.length === 1 ? part[0] : null;
}
// WhatsApp braucht die Nummer international ohne + und ohne 00 (z. B. 4917612345678)
function waNumber(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  return null;
}
function findBlock(id) {
  for (const m of S.chat) if (m.role === 'assistant') for (const b of m.content) if (b.id === id) return b;
  return null;
}
function draftCard(b) {
  const inp = b.input || {}, c = findContact(inp.recipient), sent = S.draftSent[b.id];
  const who = c ? `<b>${esc(c.name)}</b>${c.alias ? ` (${esc(c.alias)})` : ''}${c.lang ? ` · ${esc(c.lang)}` : ''}`
    : `<b>${esc(inp.recipient || 'Empfänger offen')}</b> · Kontakt unbekannt, du wählst ihn in WhatsApp oder E-Mail`;
  const mail = inp.channel === 'email' || !!c?.email;
  const waBtn = `<button class="btn wa ${inp.channel === 'email' ? 'ghost' : ''}" data-act="wa" data-id="${b.id}">${sent === 'wa' ? '✓ Erneut in WhatsApp' : 'In WhatsApp öffnen'}</button>`;
  const mailBtn = mail ? `<button class="btn ${inp.channel === 'email' ? '' : 'ghost'}" data-act="mail" data-id="${b.id}">${sent === 'mail' ? '✓ Erneut als E-Mail' : 'Als E-Mail öffnen'}</button>` : '';
  return `<div class="card draft">
    <div class="meta">✉︎ Nachricht an ${who}</div>
    ${mail ? `<input type="text" data-subject="${b.id}" placeholder="Betreff (für E-Mail)" value="${esc(S.draftEdits[b.id + ':s'] ?? inp.subject ?? '')}">` : ''}
    <textarea data-draft="${b.id}" rows="4">${esc(S.draftEdits[b.id] ?? inp.text ?? '')}</textarea>
    <div class="actions">
      ${inp.channel === 'email' ? mailBtn + waBtn : waBtn + mailBtn}
      ${navigator.share ? `<button class="btn ghost" data-act="share" data-id="${b.id}">Teilen …</button>` : ''}
      <button class="btn ghost" data-act="copy" data-id="${b.id}">Kopieren</button>
    </div>
    ${sent ? `<div class="hint">An ${sent === 'mail' ? 'dein E-Mail-Programm' : 'WhatsApp'} übergeben. Dort auf Senden tippen.</div>` : ''}</div>`;
}
function openMail(id) {
  const b = findBlock(id); if (!b) return;
  const text = draftText(id); if (!text) return toast('Nachricht ist leer');
  const c = findContact(b.input?.recipient);
  const subject = (document.querySelector(`input[data-subject="${id}"]`)?.value ?? b.input?.subject ?? '').trim();
  const url = `mailto:${encodeURIComponent(c?.email || '').replace('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  S.draftSent[id] = 'mail'; save();
  location.href = url;
  render();
}
function draftText(id) {
  const ta = document.querySelector(`textarea[data-draft="${id}"]`);
  return (ta ? ta.value : S.draftEdits[id] ?? findBlock(id)?.input?.text ?? '').trim();
}
function openWhatsApp(id) {
  const b = findBlock(id); if (!b) return;
  const text = draftText(id); if (!text) return toast('Nachricht ist leer');
  const c = findContact(b.input?.recipient);
  const num = c ? waNumber(c.phone) : null;
  if (c && !num) toast('Nummer bitte international speichern (z. B. +49 …)');
  const url = `https://wa.me/${num || ''}?text=${encodeURIComponent(text)}`;
  S.draftSent[id] = 'wa'; save();
  window.open(url, '_blank', 'noopener');
  render();
}

// ---------- Diktat (Spracherkennung des Browsers) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function startDictation() {
  if (tab !== 'chat') go('chat');
  if (rec) { rec.stopNow(); return; }
  if (busy) return;
  if (!SR) {
    toast('Spracherkennung fehlt hier. Nutze das Mikrofon auf der Tastatur.');
    $('form[data-form=chat] textarea')?.focus(); return;
  }
  // Läuft gerade noch die Vorlese-Stimme, braucht das iPhone einen Moment, bis das Mikrofon frei ist.
  const wasSpeaking = 'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const r = new SR();
  r.lang = 'de-DE'; r.continuous = true; r.interimResults = true;
  const base = ($('form[data-form=chat] textarea')?.value.trim() || '');
  let heard = '', done = false, gotAudio = false;
  // Abschluss genau einmal – auch wenn der Browser "onend" verschluckt (kommt auf dem iPhone vor)
  const finish = () => {
    if (done) return; done = true;
    if (rec === r) rec = null;
    const txt = (($('form[data-form=chat] textarea')?.value) || '').trim();
    if (heard && txt && S.settings.autoSend) sendChat(txt, false, true);
    else { render(); const ta = $('form[data-form=chat] textarea'); if (ta) { ta.value = txt; grow(ta); ta.focus(); } }
  };
  r.onaudiostart = () => { gotAudio = true; };
  r.onresult = e => {
    gotAudio = true;
    // Bei jedem Ereignis komplett neu zusammensetzen (vermeidet doppelte Wörter auf Android)
    heard = [...e.results].map(x => x[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    const ta = $('form[data-form=chat] textarea'); if (ta) { ta.value = (base ? base + ' ' : '') + heard; grow(ta); }
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Mikrofon ist nicht erlaubt');
    else if (e.error === 'audio-capture') toast('Mikrofon ist belegt – bitte nochmal 🎙 tippen');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Spracherkennung: ' + e.error);
  };
  r.onend = finish;
  r.stopNow = () => { try { r.stop(); } catch {} setTimeout(() => { if (!done) { try { r.abort(); } catch {} finish(); } }, 1500); };
  rec = r; render();
  const ta = $('form[data-form=chat] textarea'); if (ta) { ta.value = base; grow(ta); }
  const begin = () => {
    if (done || rec !== r) return;
    try { r.start(); } catch { done = true; rec = null; render(); toast('Spracherkennung startet nicht – bitte nochmal 🎙 tippen'); return; }
    // Kommt nach 4 s kein Ton an, hängt die Erkennung: sauber beenden, damit 🎙 wieder geht
    setTimeout(() => { if (!done && !gotAudio && rec === r) { try { r.abort(); } catch {} finish(); toast('Mikrofon hat nicht reagiert – bitte nochmal 🎙 tippen'); } }, 4000);
  };
  if (wasSpeaking) setTimeout(begin, 400); else begin();
}
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[•✓✦]/g, ''));
  u.lang = 'de-DE';
  const v = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('de'));
  u.voice = v.find(v => /katja|anna|hedda|marlene|vicki|female|frau/i.test(v.name)) || v[0] || null;
  speechSynthesis.speak(u);
}
// Textfelder wachsen mit dem Text (Chat-Eingabe bis 40 % der Bildschirmhöhe, danach scrollt sie)
function grow(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  const max = ta.closest('.composer') ? window.innerHeight * 0.4 : Infinity;
  const h = ta.scrollHeight + 2;
  ta.style.height = Math.min(h, max) + 'px';
  ta.style.overflowY = h > max ? 'auto' : 'hidden';
  const comp = ta.closest('.composer');
  if (comp) document.documentElement.style.setProperty('--composer-h', comp.offsetHeight + 'px');
}
function growChat() { grow($('form[data-form=chat] textarea')); }
document.addEventListener('input', e => {
  if (e.target.matches?.('.composer textarea, textarea[data-draft]')) grow(e.target);
});
function scrollChat() { requestAnimationFrame(() => { const m = $('#view'); m.scrollTop = m.scrollHeight; }); }

// ---------- Events ----------
function bind(root) {
  root.querySelectorAll('textarea[data-draft]').forEach(ta => ta.addEventListener('input', () => { S.draftEdits[ta.dataset.draft] = ta.value; save(); }));
  root.querySelectorAll('input[data-subject]').forEach(i => i.addEventListener('input', () => { S.draftEdits[i.dataset.subject + ':s'] = i.value; save(); }));
  root.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); act(el.dataset.act, el.dataset); }));
  root.querySelectorAll('form[data-form]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); submit(f.dataset.form, f); }));
  const nq = $('#note-q');
  if (nq) nq.addEventListener('input', () => { noteQuery = nq.value; const pos = nq.selectionStart; render(); const n = $('#note-q'); n.focus(); n.setSelectionRange(pos, pos); });
  const ta = root.querySelector('form[data-form=chat] textarea');
  root.querySelectorAll('textarea[data-draft]').forEach(grow);
  growChat();
  if (ta) ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.form.requestSubmit(); } });
}
function act(a, d) {
  switch (a) {
    case 'goto': return go(d.tab);
    case 'toggle': { const t = toggleTask(d.id); if (t?.done) toast('Erledigt ✓ – nochmal tippen macht es rückgängig'); return render(); }
    case 'del-task': S.tasks = S.tasks.filter(t => t.id !== d.id); save(); toast('Gelöscht'); return render();
    case 'edit-task': return taskDialog(S.tasks.find(t => t.id === d.id));
    case 'tfilter': taskFilter = d.v; return render();
    case 'cfilter': catFilter = d.v; return render();
    case 'clear-done': if (confirm('Alle erledigten Aufgaben löschen?')) { S.tasks = S.tasks.filter(t => !t.done); save(); render(); } return;
    case 'new-note': return noteDialog();
    case 'edit-note': return noteDialog(S.notes.find(n => n.id === d.id));
    case 'new-chat': S.chat = []; S.draftEdits = {}; S.draftSent = {}; save(); return render();
    case 'dictate': return startDictation();
    case 'ics': return addToCalendar(d.id);
    case 'wa': return openWhatsApp(d.id);
    case 'mail': return openMail(d.id);
    case 'copy': navigator.clipboard?.writeText(draftText(d.id)).then(() => toast('Kopiert'), () => toast('Kopieren nicht möglich')); return;
    case 'share': navigator.share?.({ text: draftText(d.id) }).catch(() => {}); return;
    case 'contacts': return contactsDialog();
    case 'settings': return settingsDialog();
    case 'ask': go('chat'); return sendChat(d.q.endsWith('…') ? d.q.replace('…', '').trim() + ' ' : d.q, d.q.endsWith('…'));
  }
}
function submit(form, f) {
  const fd = new FormData(f);
  if (form === 'quick-task' || form === 'quick-today') {
    const title = String(fd.get('title') || '').trim(); if (!title) return;
    addTask({ title, due: form === 'quick-today' ? today() : '', cat: catFilter === 'Geschäftlich' ? 'Geschäftlich' : 'Privat' });
    toast('Aufgabe angelegt'); render(); $('#view input[name=title]')?.focus();
  }
  if (form === 'chat') { const q = String(fd.get('q') || '').trim(); if (q) sendChat(q); }
}

// ---------- Dialoge ----------
const dlg = $('#dlg');
function openDialog(html, onSubmit) {
  // autofocus aufs Formular: kein Eingabefeld bekommt automatisch den Fokus (iPhone fragt sonst nach Passwörtern)
  dlg.innerHTML = `<form class="dlg" method="dialog" tabindex="-1" autofocus>${html}</form>`;
  const f = dlg.querySelector('form');
  f.addEventListener('submit', e => { const r = onSubmit(e.submitter?.value, new FormData(f)); if (r === false) e.preventDefault(); else render(); });
  if (!dlg.open) dlg.showModal();
  f.focus({ preventScroll: true });
}
function taskDialog(t) {
  if (!t) return;
  openDialog(`<h3>Aufgabe bearbeiten</h3>
    <label>Titel<input type="text" name="title" value="${esc(t.title)}" required></label>
    <div class="row"><label>Fällig am<input type="date" name="due" value="${esc(t.due)}"></label>
    <label>Uhrzeit (Erinnerung)<input type="time" name="time" value="${esc(t.time)}"></label></div>
    <label>Kategorie<select name="cat">${['Privat', 'Geschäftlich'].map(c => `<option ${c === t.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="hint">📅 trägt die Aufgabe mit Alarm in den Kalender des Geräts ein – der klingelt auch, wenn Claudia geschlossen ist.</div>
    <div class="actions"><button class="btn ghost" value="cal" style="margin-right:auto">📅 Speichern + Kalender</button><button class="btn ghost" value="cancel" formnovalidate>Abbrechen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => {
      if (v !== 'ok' && v !== 'cal') return;
      const changed = t.due !== fd.get('due') || t.time !== fd.get('time') || t.title !== fd.get('title').trim();
      Object.assign(t, { title: fd.get('title').trim(), due: fd.get('due'), time: fd.get('time'), cat: fd.get('cat') });
      if (changed) t.cal = false;
      S.notified = S.notified.filter(x => x !== t.id); save();
      if (v === 'cal') setTimeout(() => addToCalendar(t.id));
    });
}
function noteDialog(n) {
  openDialog(`<h3>${n ? 'Notiz bearbeiten' : 'Neue Notiz'}</h3>
    <label>Titel<input type="text" name="title" value="${esc(n?.title)}" placeholder="optional"></label>
    <label>Text<textarea name="text" rows="8">${esc(n?.text)}</textarea></label>
    <div class="actions">${n ? '<button class="btn danger" value="del" formnovalidate>Löschen</button>' : ''}
    <button class="btn ghost" value="cancel" formnovalidate>Abbrechen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => {
      if (v === 'del') { S.notes = S.notes.filter(x => x !== n); save(); toast('Notiz gelöscht'); return; }
      if (v !== 'ok') return;
      const title = fd.get('title').trim(), text = fd.get('text');
      if (!title && !text.trim()) return;
      if (n) { Object.assign(n, { title: title || text.split('\n')[0].slice(0, 80), text, updated: Date.now() }); S.notes.sort((a, b) => b.updated - a.updated); save(); }
      else addNote({ title, text });
    });
}
function settingsDialog() {
  const s = S.settings;
  openDialog(`<h3>Einstellungen <span class="hint" style="font-weight:400">Version ${APP_VERSION}</span></h3>
    <label>Wie soll Claudia dich nennen?<input type="text" name="name" value="${esc(s.name)}"></label>
    <label>Anthropic API-Key<input type="password" name="key" value="${esc(getKey())}" placeholder="sk-ant-…" autocomplete="off"></label>
    <div class="hint">Wird nur auf diesem Gerät gespeichert und direkt an api.anthropic.com gesendet. Key erstellen: console.anthropic.com → API Keys.</div>
    <div class="row"><label>Modell<select name="model">${Object.entries(MODELS).map(([k, l]) => `<option value="${k}" ${k === s.model ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Gründlichkeit<select name="effort">${[['low', 'Schnell'], ['medium', 'Ausgewogen'], ['high', 'Gründlich']].map(([k, l]) => `<option value="${k}" ${k === s.effort ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <h3 style="margin-top:6px">Diktat</h3>
    <label class="cb"><input type="checkbox" name="autoSend" ${s.autoSend ? 'checked' : ''}> Diktat nach dem Sprechen automatisch an Claudia senden</label>
    <label class="cb"><input type="checkbox" name="speak" ${s.speak ? 'checked' : ''}> Claudias Antwort nach einem Diktat vorlesen</label>
    <h3 style="margin-top:6px">Erinnerungen</h3>
    <label class="cb"><input type="checkbox" name="alarmSound" ${s.alarmSound !== false ? 'checked' : ''}> Alarmton zur Erinnerungszeit</label>
    <label class="cb"><input type="checkbox" name="alarmSpeak" ${s.alarmSpeak !== false ? 'checked' : ''}> Erinnerung ansagen</label>
    <div class="hint">Klingelt zur eingetragenen Uhrzeit, solange Claudia geöffnet ist. Ist Claudia beim Fälligwerden geschlossen, kommt der Alarm beim nächsten Öffnen.</div>
    <div class="row"><button class="btn ghost" value="alarm-test" formnovalidate>Alarm testen</button>
    <button class="btn ghost" value="notify" formnovalidate>${'Notification' in window && Notification.permission === 'granted' ? 'Benachrichtigungen aktiv ✓' : 'Benachrichtigungen erlauben'}</button></div>
    <h3 style="margin-top:6px">Sync PC ↔ Handy</h3>
    ${syncCfg().token ? `
      <div class="hint">Aufgaben, Notizen und Kontakte werden automatisch abgeglichen, verschlüsselt mit deinem Sync-Passwort. Chat, API-Key und Einstellungen bleiben auf dem Gerät.</div>
      <div class="sync-state" id="sync-state">${esc(syncLabel())}</div>
      <div class="row"><button class="btn ghost" value="sync-now" formnovalidate>Jetzt synchronisieren</button><button class="btn danger" value="sync-off" formnovalidate>Sync hier beenden</button></div>`
    : `
      <div class="hint">Einmal auf <b>jedem</b> Gerät einrichten, mit demselben Token und demselben Sync-Passwort. Die Daten liegen verschlüsselt in einem geheimen (nicht öffentlich gelisteten) Gist in deinem GitHub-Konto; ohne das Sync-Passwort kann sie niemand lesen. Wähle ein gutes Passwort, das du sonst nirgends nutzt.</div>
      <div class="hint">1. <a href="https://github.com/settings/tokens/new?scopes=gist&description=Claudia%20Sync" target="_blank" rel="noopener">GitHub-Token erstellen</a> (nur Recht „gist“, Ablauf nach Wunsch) und hier einfügen.<br>2. Ein Sync-Passwort ausdenken (mind. 8 Zeichen) und auf allen Geräten gleich eintragen.</div>
      <label>GitHub-Token<input type="password" name="stoken" placeholder="ghp_…" autocomplete="off"></label>
      <label>Sync-Passwort<input type="password" name="spass" autocomplete="new-password"></label>
      <button class="btn ghost" value="sync-setup" formnovalidate>Sync einrichten</button>`}
    <details class="hint"><summary>Manuell übertragen (Datei)</summary>
      <div style="margin:8px 0">Exportieren und auf dem anderen Gerät importieren (z. B. über OneDrive). Der API-Key wird nicht exportiert.</div>
      <div class="row"><button class="btn ghost" value="export" formnovalidate>Exportieren</button><button class="btn ghost" value="import" formnovalidate>Importieren</button></div></details>
    <div class="actions"><button class="btn ghost" value="cancel" formnovalidate>Schließen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => {
      if (v === 'export') return exportData(), false;
      if (v === 'import') return importData(), false;
      if (v === 'sync-now') { syncNow(true); return false; }
      if (v === 'sync-off') {
        if (!confirm('Sync auf diesem Gerät beenden? Deine Daten bleiben hier und im Gist erhalten.')) return false;
        setSyncCfg({}); try { localStorage.removeItem(BASE_STORE); } catch {} toast('Sync beendet'); setTimeout(settingsDialog); return;
      }
      if (v === 'sync-setup' || (v === 'ok' && fd.get('stoken')?.trim())) {
        const token = fd.get('stoken').trim(), pass = fd.get('spass');
        if (!token || pass.length < 8) { toast('Token und Sync-Passwort (mind. 8 Zeichen) eintragen'); return false; }
        setSyncCfg({ token, pass });
        syncNow(true).then(ok => { if (!ok) setSyncCfg({}); if (dlg.open) settingsDialog(); });
        if (v === 'sync-setup') return false;
      }
      if (v === 'alarm-test') {
        const prev = { a: s.alarmSound, b: s.alarmSpeak };
        s.alarmSound = !!fd.get('alarmSound'); s.alarmSpeak = !!fd.get('alarmSpeak');
        (async () => { if (s.alarmSound) await playAlarm(); if (s.alarmSpeak) speak('Erinnerung: Das ist ein Test.'); s.alarmSound = prev.a; s.alarmSpeak = prev.b; })();
        return false;
      }
      if (v === 'notify') { Notification?.requestPermission().then(p => toast(p === 'granted' ? 'Benachrichtigungen aktiv' : 'Nicht erlaubt')); return false; }
      if (v !== 'ok') return;
      Object.assign(s, { name: fd.get('name').trim(), model: fd.get('model'), effort: fd.get('effort'), autoSend: fd.has('autoSend'), speak: fd.has('speak'), alarmSound: fd.has('alarmSound'), alarmSpeak: fd.has('alarmSpeak') });
      setKey(fd.get('key').trim()); save(); toast('Gespeichert');
    });
}
let contactQuery = '';
function contactsDialog() {
  const canPick = 'contacts' in navigator && 'select' in (navigator.contacts || {});
  const rows = [...S.contacts].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(c =>
    `<div class="crow ${c.on === false ? 'off' : ''}" data-q="${esc(norm([c.name, c.phone, c.email, c.alias].join(' ')))}">
       <label class="cb"><input type="checkbox" data-cid="${c.id}" ${c.on === false ? '' : 'checked'}>
       <span><b>${esc(c.name)}</b>${c.self ? ' <span class="pill">ich</span>' : ''}${c.alias ? ` <span class="pill priv">${esc(c.alias)}</span>` : ''}${c.lang ? ` <span class="pill today">${esc(c.lang)}</span>` : ''}
       <span class="hint" style="display:block">${esc(c.phone || '')}${c.phone && !waNumber(c.phone) ? ' ⚠︎ ohne +Ländervorwahl' : ''}${c.email ? (c.phone ? ' · ' : '') + esc(c.email) : ''}</span></span></label>
       <button class="mini edit" value="edit:${c.id}" formnovalidate aria-label="Bearbeiten" title="Bearbeiten">✎</button>
       <button class="mini" value="del:${c.id}" formnovalidate aria-label="Löschen" title="Löschen">✕</button></div>`).join('');
  openDialog(`<h3>Kontakte für Claudia</h3>
    <div class="hint">Nur <b>angehakte</b> Kontakte kann Claudia sehen und als Empfänger nutzen. Alle anderen bleiben unsichtbar für sie und werden nie an die KI gesendet.</div>
    <div class="ccount hint" id="ccount"></div>
    ${S.contacts.length ? `<input type="search" id="cq" placeholder="Kontakt suchen …" value="${esc(contactQuery)}">
    <div class="chips"><button type="button" class="chip" data-call="1">Alle sichtbaren anhaken</button><button type="button" class="chip" data-call="0">Alle sichtbaren abwählen</button></div>` : ''}
    <div class="clist">${rows || '<div class="hint">Noch keine Kontakte. Importiere dein Adressbuch als vCard-Datei (.vcf) oder trag einzelne Kontakte ein.</div>'}</div>
    <div class="row"><input type="text" name="cname" placeholder="Name (z. B. Maria)"><input type="text" name="cphone" placeholder="+49 … (optional)" inputmode="tel"></div>
    <div class="hint">Mit ✎ trägst du E-Mail, Sprache, Alias (z. B. „meine Frau“) und „Das bin ich“ ein.</div>
    <div class="actions">
    <button class="btn ghost" value="vcf" formnovalidate>Adressbuch importieren (.vcf)</button>
    ${canPick ? '<button class="btn ghost" value="pick" formnovalidate>Aus Handy-Kontakten</button>' : ''}
    <button class="btn ghost" value="add" formnovalidate>Hinzufügen</button><button class="btn" value="cancel" formnovalidate>Fertig</button></div>
    <div class="hint">vCard exportieren: Android-Kontakte → Einstellungen → Exportieren · iPhone: Kontakte am PC über icloud.com → Exportieren · Outlook/Google Kontakte → Exportieren (vCard). Importierte Kontakte sind zunächst <b>nicht</b> freigegeben; hake an, wen Claudia kennen darf.</div>`,
    (v, fd) => {
      if (v?.startsWith('del:')) {
        const c = S.contacts.find(x => x.id === v.slice(4));
        if (c && !confirm(`${c.name} löschen?`)) return false;
        S.contacts = S.contacts.filter(x => x.id !== v.slice(4)); save(); setTimeout(contactsDialog); return;
      }
      if (v?.startsWith('edit:')) { const c = S.contacts.find(x => x.id === v.slice(5)); setTimeout(() => contactEditDialog(c)); return; }
      if (v === 'add') {
        const name = fd.get('cname').trim(), phone = fd.get('cphone').trim();
        if (!name) { toast('Name eintragen'); return false; }
        const c = saveContact(name, phone, true); setTimeout(() => contactEditDialog(c)); return;
      }
      if (v === 'vcf') { importVcf(); return false; }
      if (v === 'pick') {
        navigator.contacts.getProperties().then(props => navigator.contacts.select(['name', 'tel', ...(props.includes('email') ? ['email'] : [])], { multiple: true })).then(list => {
          let n = 0; for (const p of list) if (p.name?.[0] && (p.tel?.[0] || p.email?.[0])) { const c = saveContact(p.name[0], p.tel?.[0] || '', true); if (p.email?.[0] && !c.email) c.email = p.email[0]; n++; }
          save();
          toast(`${n} Kontakt(e) übernommen und freigegeben`); contactsDialog();
        }).catch(() => {});
        return;
      }
    });
  // Häkchen sofort speichern, Suche filtert ohne Neuaufbau
  const count = () => {
    const el = $('#ccount'); if (el) el.textContent = `${allowed().length} von ${S.contacts.length} Kontakten freigegeben`;
    const b = $('#contacts-badge'); if (b) b.textContent = allowed().length || '';
  };
  const filter = () => {
    const q = norm(contactQuery);
    dlg.querySelectorAll('.crow').forEach(r => { r.hidden = !!q && !r.dataset.q.includes(q); });
  };
  dlg.querySelectorAll('input[data-cid]').forEach(cb => cb.addEventListener('change', () => {
    const c = S.contacts.find(x => x.id === cb.dataset.cid); if (!c) return;
    c.on = cb.checked; cb.closest('.crow').classList.toggle('off', !cb.checked); save(); count();
  }));
  dlg.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => {
    const on = b.dataset.call === '1';
    dlg.querySelectorAll('.crow:not([hidden]) input[data-cid]').forEach(cb => { if (cb.checked !== on) { cb.checked = on; cb.dispatchEvent(new Event('change')); } });
  }));
  $('#cq')?.addEventListener('input', e => { contactQuery = e.target.value; filter(); });
  // Enter darf nicht den ersten Button im Formular (Löschen ✕) auslösen
  dlg.querySelectorAll('input[type=text], input[type=search]').forEach(i => i.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    if (i.name === 'cname' || i.name === 'cphone') dlg.querySelector('button[value=add]').click();
  }));
  count(); filter();
}
const APP_VERSION = '2026-11-08 · 15';
const LANGS = ['Deutsch', 'Englisch', 'Spanisch', 'Baskisch', 'Französisch', 'Italienisch', 'Portugiesisch'];
function contactEditDialog(c) {
  if (!c) return contactsDialog();
  const langs = c.lang && !LANGS.includes(c.lang) ? [...LANGS, c.lang] : LANGS;
  openDialog(`<h3>Kontakt bearbeiten</h3>
    <label>Name<input type="text" name="name" value="${esc(c.name)}" required></label>
    <label>Alias / Beziehung<input type="text" name="alias" value="${esc(c.alias || '')}" placeholder="z. B. meine Frau, Schatz"></label>
    <div class="hint">Mehrere Aliase mit Komma trennen. Dann versteht Claudia z. B. „Schreib meiner Frau …“.</div>
    <div class="row"><label>Telefon (WhatsApp)<input type="text" name="phone" value="${esc(c.phone || '')}" placeholder="+49 …" inputmode="tel"></label>
    <label>E-Mail<input type="email" name="email" value="${esc(c.email || '')}" placeholder="name@beispiel.de" inputmode="email"></label></div>
    <label>Sprache für Nachrichten<select name="lang"><option value="">Wie diktiert (Standard)</option>${langs.map(l => `<option ${l === c.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="hint">Claudia schreibt Nachrichten an diese Person immer in dieser Sprache, auch wenn du auf Deutsch diktierst.</div>
    <label class="cb"><input type="checkbox" name="on" ${c.on === false ? '' : 'checked'}> Für Claudia freigegeben</label>
    <label class="cb"><input type="checkbox" name="self" ${c.self ? 'checked' : ''}> Das bin ich</label>
    <div class="actions"><button class="btn ghost" value="cancel" formnovalidate>Abbrechen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => {
      if (v === 'ok') {
        const phone = fd.get('phone').trim(), email = fd.get('email').trim();
        if (phone && !waNumber(phone)) toast('Hinweis: Nummer ohne +Ländervorwahl funktioniert nicht mit WhatsApp');
        Object.assign(c, { name: fd.get('name').trim() || c.name, alias: fd.get('alias').trim(), phone, email, lang: fd.get('lang'), on: fd.has('on'), self: fd.has('self') });
        if (c.self) for (const x of S.contacts) if (x !== c) x.self = false;
        save();
      }
      setTimeout(contactsDialog);
    });
}
function saveContact(name, phone, on) {
  const c = S.contacts.find(x => norm(x.name) === norm(name));
  if (c) { if (phone) c.phone = phone; if (on !== undefined) c.on = on; }
  else S.contacts.push({ id: uid(), name: name.trim(), phone: phone.trim(), on: on !== false });
  save(); return c || S.contacts[S.contacts.length - 1];
}
// vCard (.vcf) einlesen: Name (FN/N) + beste Telefonnummer (Handy bevorzugt)
function parseVcf(txt) {
  const lines = txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  const dec = s => s.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\').trim();
  for (const line of lines) {
    const i = line.indexOf(':'); if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1), key = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
    if (key === 'BEGIN') cur = { fn: '', n: '', tels: [], email: '' };
    else if (key === 'EMAIL' && cur && !cur.email) cur.email = val.replace(/^mailto:/i, '').trim();
    else if (!cur) continue;
    else if (key === 'FN') cur.fn = dec(val);
    else if (key === 'N') { const p = val.split(';').map(dec); cur.n = [p[1], p[0]].filter(Boolean).join(' '); }
    else if (key === 'TEL') cur.tels.push({ num: val.replace(/^tel:/i, '').trim(), mobile: /CELL|MOBILE|IPHONE/i.test(head) });
    else if (key === 'END') {
      const name = cur.fn || cur.n, tel = cur.tels.find(t => t.mobile) || cur.tels[0];
      // Deutsche Inlandsnummer (0171 …) → +49 171 …
      const phone = !tel ? '' : /^0[1-9]/.test(tel.num) ? '+49 ' + tel.num.slice(1) : tel.num;
      if (name && (phone || cur.email)) out.push({ name, phone, email: cur.email });
      cur = null;
    }
  }
  return out;
}
function importVcf() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.vcf,text/vcard,text/x-vcard';
  inp.onchange = async () => {
    try {
      const list = parseVcf(await inp.files[0].text());
      if (!list.length) throw 0;
      let neu = 0;
      for (const p of list) {
        const had = S.contacts.some(x => norm(x.name) === norm(p.name));
        const c = saveContact(p.name, p.phone, had ? undefined : false);
        if (p.email && !c.email) c.email = p.email;
        if (!had) neu++;
      }
      save(); toast(`${list.length} Kontakte gelesen, ${neu} neu (noch nicht freigegeben)`); contactsDialog();
    } catch { toast('Keine Kontakte mit Telefonnummer oder E-Mail in der Datei gefunden'); }
  };
  inp.click();
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'Claudia', version: 1, exported: new Date().toISOString(), tasks: S.tasks, notes: S.notes, contacts: S.contacts }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Claudia_Daten_${today()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importData() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      if (d.app !== 'Claudia' || !Array.isArray(d.tasks) || !Array.isArray(d.notes)) throw 0;
      // Zusammenführen: gleiche ID → neuere Version gewinnt
      const merge = (mine, theirs, stamp) => { const m = new Map(mine.map(x => [x.id, x])); for (const x of theirs) { const o = m.get(x.id); if (!o || stamp(x) >= stamp(o)) m.set(x.id, x); } return [...m.values()]; };
      S.tasks = merge(S.tasks, d.tasks, x => x.doneAt || x.created || 0);
      S.notes = merge(S.notes, d.notes, x => x.updated || 0).sort((a, b) => b.updated - a.updated);
      if (Array.isArray(d.contacts)) for (const c of d.contacts) if (c?.name) { const x = saveContact(c.name, c.phone || '', c.on !== false); for (const k of ['email', 'lang', 'alias', 'self']) if (c[k] !== undefined) x[k] = c[k]; }
      save(); dlg.close(); render(); toast(`Importiert: ${d.tasks.length} Aufgaben, ${d.notes.length} Notizen`);
    } catch { toast('Keine gültige Claudia-Datei'); }
  };
  inp.click();
}

// ---------- Claudia (Claude API) ----------
const TOOL_LABEL = { list_contacts: 'Kontakte angesehen', update_contact: 'Kontakt aktualisiert', save_contact: 'Kontakt gespeichert', list_tasks: 'Aufgaben angesehen', add_task: 'Aufgabe angelegt', update_task: 'Aufgabe geändert', complete_task: 'Aufgabe abgehakt', add_note: 'Notiz gespeichert', search_notes: 'Notizen durchsucht' };
const TOOLS = [
  { name: 'list_tasks', description: 'Listet Aufgaben des Nutzers. Nutze das, bevor du über Aufgaben sprichst oder welche änderst.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['offen', 'erledigt', 'alle'] } }, required: ['status'], additionalProperties: false } },
  { name: 'add_task', description: 'Legt eine neue Aufgabe/Erinnerung an. Datum als YYYY-MM-DD (relativ zu heute berechnen), Uhrzeit HH:MM optional.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD oder leer' }, time: { type: 'string', description: 'HH:MM oder leer' }, cat: { type: 'string', enum: ['Privat', 'Geschäftlich'] } }, required: ['title', 'due', 'time', 'cat'], additionalProperties: false } },
  { name: 'update_task', description: 'Ändert Titel, Fälligkeit, Uhrzeit oder Kategorie einer bestehenden Aufgabe (ID aus list_tasks). Nicht zu ändernde Felder weglassen.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, due: { type: 'string' }, time: { type: 'string' }, cat: { type: 'string', enum: ['Privat', 'Geschäftlich'] } }, required: ['id'], additionalProperties: false } },
  { name: 'complete_task', description: 'Markiert eine Aufgabe als erledigt (oder mit done=false wieder als offen).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id', 'done'], additionalProperties: false } },
  { name: 'add_note', description: 'Speichert eine Notiz für den Nutzer.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'], additionalProperties: false } },
  { name: 'search_notes', description: 'Durchsucht die Notizen (leerer Suchbegriff = alle, neueste zuerst).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'list_contacts', description: 'Listet die Kontakte, die der Nutzer für dich freigegeben hat: Name, Alias/Beziehung (z. B. "meine Frau"), Sprache für Nachrichten, ob WhatsApp-Nummer bzw. E-Mail vorhanden sind, und ob es der Nutzer selbst ist (ich=true). Andere Kontakte siehst du bewusst nicht.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'update_contact', description: 'Ändert Alias/Beziehung, Sprache oder E-Mail eines freigegebenen Kontakts, wenn der Nutzer das sagt (z. B. "Urtza ist meine Frau", "schreib ihr immer auf Englisch"). Nicht zu ändernde Felder weglassen.',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Name wie in list_contacts' }, alias: { type: 'string' }, lang: { type: 'string', description: 'Sprache auf Deutsch, z. B. Englisch, Spanisch; leer = wie diktiert' }, email: { type: 'string' } }, required: ['name'], additionalProperties: false } },
  { name: 'save_contact', description: 'Speichert oder aktualisiert einen Kontakt mit Telefonnummer (international, z. B. +49…). Nur wenn der Nutzer eine Nummer nennt.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } }, required: ['name', 'phone'], additionalProperties: false } },
  { name: 'prepare_message', description: 'Zeigt dem Nutzer einen fertigen Nachrichtenentwurf mit Buttons "In WhatsApp öffnen" und (wenn eine E-Mail hinterlegt ist) "Als E-Mail öffnen". Der Nutzer prüft und sendet selbst; du kannst nicht selbst senden. Nur aufrufen, wenn der Nutzer die Nachricht verschicken will und der Empfänger feststeht.',
    input_schema: { type: 'object', properties: { recipient: { type: 'string', description: 'Name des Empfängers genau wie in list_contacts' }, text: { type: 'string', description: 'Endgültiger, korrigierter Nachrichtentext, in der Sprache des Empfängers' }, channel: { type: 'string', enum: ['whatsapp', 'email'], description: 'email nur, wenn der Nutzer eine E-Mail/Mail will' }, subject: { type: 'string', description: 'Betreff, nur bei E-Mail' } }, required: ['recipient', 'text', 'channel'], additionalProperties: false } },
].map(t => ({ ...t, eager_input_streaming: true }));

const reDate = /^(\d{4}-\d{2}-\d{2})?$/, reTime = /^(\d{2}:\d{2})?$/;
function runTool(name, inp) {
  if (!inp || typeof inp !== 'object') throw new Error('Ungültige Eingabe');
  const need = (k, type = 'string') => { if (typeof inp[k] !== type) throw new Error(`Feld "${k}" fehlt oder ist ungültig`); };
  const brief = t => ({ id: t.id, title: t.title, due: t.due, time: t.time, cat: t.cat, done: t.done });
  switch (name) {
    case 'list_tasks': {
      const st = inp.status || 'offen';
      return sortTasks(S.tasks.filter(t => st === 'alle' || (st === 'offen' ? !t.done : t.done))).slice(0, 100).map(brief);
    }
    case 'add_task': {
      need('title'); if (!inp.title.trim()) throw new Error('Titel leer');
      if (!reDate.test(inp.due || '') || !reTime.test(inp.time || '')) throw new Error('Datum/Uhrzeit-Format ungültig');
      return brief(addTask(inp));
    }
    case 'update_task': {
      need('id'); const t = S.tasks.find(x => x.id === inp.id); if (!t) throw new Error('Aufgabe nicht gefunden');
      if (inp.due !== undefined && !reDate.test(inp.due)) throw new Error('Datum ungültig');
      if (inp.time !== undefined && !reTime.test(inp.time)) throw new Error('Uhrzeit ungültig');
      for (const k of ['title', 'due', 'time', 'cat']) if (typeof inp[k] === 'string') t[k] = inp[k];
      S.notified = S.notified.filter(x => x !== t.id); save(); return brief(t);
    }
    case 'complete_task': {
      need('id'); need('done', 'boolean'); const t = toggleTask(inp.id, inp.done); if (!t) throw new Error('Aufgabe nicht gefunden'); return brief(t);
    }
    case 'add_note': { need('text'); const n = addNote(inp); return { id: n.id, title: n.title }; }
    case 'search_notes': {
      const q = String(inp.query || '').toLowerCase();
      return S.notes.filter(n => !q || (n.title + ' ' + n.text).toLowerCase().includes(q)).slice(0, 20)
        .map(n => ({ id: n.id, title: n.title, text: n.text.slice(0, 1500), updated: new Date(n.updated).toISOString().slice(0, 10) }));
    }
    case 'list_contacts': return allowed().map(c => ({ name: c.name, alias: c.alias || '', sprache: c.lang || 'wie diktiert', whatsapp: !!waNumber(c.phone), email: !!c.email, ...(c.self ? { ich: true } : {}) }));
    case 'update_contact': {
      need('name'); const c = findContact(inp.name); if (!c) throw new Error('Kontakt nicht gefunden oder nicht freigegeben');
      if (inp.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inp.email)) throw new Error('E-Mail-Adresse ungültig');
      for (const k of ['alias', 'lang', 'email']) if (typeof inp[k] === 'string') c[k] = inp[k].trim();
      save(); return { name: c.name, alias: c.alias || '', sprache: c.lang || 'wie diktiert', email: !!c.email };
    }
    case 'save_contact': {
      need('name'); need('phone');
      if (!waNumber(inp.phone)) throw new Error('Nummer braucht die Ländervorwahl mit + (z. B. +49…). Frag den Nutzer nach dem Land.');
      const c = saveContact(inp.name, inp.phone, true); return { name: c.name, gespeichert: true };
    }
    case 'prepare_message': {
      need('recipient'); need('text'); if (!inp.text.trim()) throw new Error('Text leer');
      if (inp.channel !== undefined && !['whatsapp', 'email'].includes(inp.channel)) throw new Error('channel ungültig');
      const c = findContact(inp.recipient);
      if (c && inp.channel === 'email' && !c.email) return { angezeigt: true, kontakt_gefunden: true, hinweis: 'Für diesen Kontakt ist keine E-Mail hinterlegt; der Nutzer trägt die Adresse im Mailprogramm ein. Biete an, sie zu speichern.' };
      return { angezeigt: true, kontakt_gefunden: !!c, hinweis: c ? 'Der Nutzer tippt jetzt selbst auf Senden.' : 'Kontakt unbekannt oder nicht freigegeben: Der Nutzer wählt ihn selbst aus.' };
    }
  }
  throw new Error('Unbekanntes Werkzeug');
}

function systemPrompt() {
  const now = new Date();
  return `Du bist Claudia, die persönliche Assistentin von ${S.settings.name || 'deinem Nutzer'}. Du antwortest auf Deutsch, herzlich, klar und knapp – wie eine sehr gute, vorausschauende Assistentin. Kein Markdown mit Überschriften oder Tabellen; kurze Absätze und einfache Aufzählungen mit "•" sind ok.
Du verwaltest die Aufgaben (mit Kategorie Privat/Geschäftlich, Fälligkeit und optionaler Uhrzeit als Erinnerung) und Notizen des Nutzers über deine Werkzeuge. Sieh mit list_tasks nach, bevor du über bestehende Aufgaben sprichst. Wenn der Nutzer etwas notieren, erinnert werden oder erledigen möchte, lege es direkt an bzw. hake es ab und bestätige kurz, statt nachzufragen – frag nur, wenn wirklich etwas Wesentliches unklar ist. Kategorie: im Zweifel Privat, bei Arbeitsthemen Geschäftlich.
Diktat: Nachrichten, die mit "[Diktiert]" beginnen, hat der Nutzer gesprochen; die Spracherkennung macht dabei Fehler (falsche Wörter, fehlende Satzzeichen). Unterscheide:
• Auftrag oder Frage an dich (z. B. "Erinnere mich …", "Was steht an?"): einfach erledigen.
• Ein Nachrichtentext für andere Menschen: Korrigiere Rechtschreibung, Grammatik, Zeichensetzung und offensichtliche Erkennungsfehler. Inhalt, Ton, Du/Sie und Länge bleiben, wie sie sind; nichts dazuerfinden. Zeig die korrigierte Fassung in Anführungszeichen und frag: "Soll ich sie verschicken, und wenn ja, an wen?" Ist der Text nur für ihn selbst, biete an, ihn als Notiz zu speichern.
• Nennt er den Empfänger schon im Diktat ("Schreib Maria, dass ich später komme"), formuliere die Nachricht direkt an diese Person (in seinem Namen, Ich-Form) und ruf gleich prepare_message auf.
Sobald der Empfänger feststeht: list_contacts prüfen, dann prepare_message mit dem genauen Namen aus der Liste. Empfänger können auch über ihren Alias genannt werden ("meine Frau", "meine Tochter"); der Kontakt mit ich=true ist der Nutzer selbst ("schick mir", "an mich"). Ist der Name unklar (mehrere Treffer), kurz nachfragen.
Sprache: Hat der Empfänger eine Sprache hinterlegt, schreibst du die Nachricht in dieser Sprache – sinngemäß übersetzt, gleicher Ton, nichts dazuerfinden –, auch wenn diktiert auf Deutsch. Sag dem Nutzer dann kurz auf Deutsch, dass du übersetzt hast. Ohne Sprache bleibt sie in der diktierten Sprache.
Kanal: Standard ist WhatsApp; sagt der Nutzer "Mail"/"E-Mail", nimm channel "email" mit einem kurzen Betreff in der Sprache des Empfängers. Sagt der Nutzer etwas über einen Kontakt (Beziehung, Sprache, E-Mail), speichere es mit update_contact.
Abgehakte Aufgaben werden nach wenigen Sekunden automatisch gelöscht; sie lassen sich danach nicht mehr wieder öffnen.
Erinnerungen: Hat eine Aufgabe Datum und Uhrzeit, klingelt Claudia nur, solange die App offen ist. Unter deiner Bestätigung erscheint ein 📅-Knopf, der einen Kalendertermin mit Alarm anlegt (klingelt auch bei geschlossener App); erwähne ihn kurz, wenn der Nutzer ausdrücklich einen Alarm oder Wecker möchte.
Du verschickst nie selbst; der Nutzer tippt im Entwurf auf "In WhatsApp öffnen" bzw. "Als E-Mail öffnen" und dort auf Senden. Halte Antworten nach einem Diktat besonders kurz, sie werden vorgelesen.
Heute ist ${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${today()}), ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`;
}

// ---------- Guthaben (Schätzung) ----------
// Die API verrät das Restguthaben nicht. Der Nutzer trägt seinen Kontostand aus der Console ein,
// Claudia zieht die Kosten jeder Antwort ab (Preise je 1 Mio. Tokens in USD, Stand Preisliste Nov. 2026).
const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cr: 0.20 },
  'claude-sonnet-5-5': { in: 2, out: 10, cr: 0.10 },
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cr: 0.01 },
};
function costOf(model, u) {
  if (!u) return 0;
  const p = PRICES[Object.keys(PRICES).find(k => String(model || '').startsWith(k))] || PRICES['claude-opus-5-5'];
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out
    + (u.cache_read_input_tokens || 0) * p.cr + (u.cache_creation_input_tokens || 0) * p.in * 1.25) / 1e6;
}
function addCost(usd) {
  const c = S.settings.credit; if (!c) return;
  c.spent = (c.spent || 0) + usd; saveLocal(); renderCredit();
}
const creditLeft = () => { const c = S.settings.credit; return c ? c.start - (c.spent || 0) : null; };
function renderCredit() {
  const b = $('#btn-credit'); if (!b) return;
  const left = creditLeft();
  b.textContent = left === null ? '$ ?' : '≈ $' + Math.max(0, left).toFixed(2);
  b.classList.toggle('low', left !== null && left < 2);
}
function creditDialog() {
  const c = S.settings.credit, left = creditLeft();
  openDialog(`<h3>API-Guthaben</h3>
    ${c ? `<div class="sync-state">Geschätzt übrig: $${Math.max(0, left).toFixed(2)}</div>
      <div class="hint">Eingetragen am ${new Date(c.at).toLocaleDateString('de-DE')}: $${c.start.toFixed(2)} · seitdem auf diesem Gerät verbraucht: $${(c.spent || 0).toFixed(4)}</div>` : ''}
    <div class="hint">Anthropic gibt das Restguthaben nicht über den API-Key heraus. Trag hier den Stand aus der
      <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener">Console (Billing)</a> ein – Claudia zieht dann die Kosten jeder Antwort ab.
      Nur Schätzung: Verbrauch auf anderen Geräten zählt hier nicht mit, also ab und zu neu eintragen.</div>
    <label>Aktuelles Guthaben in $<input type="text" inputmode="decimal" name="bal" placeholder="z. B. 18,50" autocomplete="off"></label>
    <div class="actions">${c ? '<button class="btn danger" value="off" formnovalidate style="margin-right:auto">Anzeige aus</button>' : ''}
    <button class="btn ghost" value="cancel" formnovalidate>Schließen</button><button class="btn" value="ok">Übernehmen</button></div>`,
    (v, fd) => {
      if (v === 'off') { delete S.settings.credit; saveLocal(); renderCredit(); return; }
      if (v !== 'ok') return;
      const n = parseFloat(String(fd.get('bal')).replace(/[^0-9,.-]/g, '').replace(',', '.'));
      if (!isFinite(n) || n < 0) { toast('Bitte einen Betrag eintragen, z. B. 18,50'); return false; }
      S.settings.credit = { start: n, at: Date.now(), spent: 0 }; saveLocal(); renderCredit(); toast('Guthaben übernommen');
    });
}

let sdk = null;
async function sendChat(text, prefillOnly = false, dictated = false) {
  if (prefillOnly) { render(); const ta = $('form[data-form=chat] textarea'); ta.value = text; grow(ta); ta.focus(); return; }
  if (busy) return;
  const key = getKey();
  if (!key) { settingsDialog(); toast('Bitte zuerst den API-Key eintragen'); return; }
  S.chat = S.chat.filter(m => m.role !== 'ui-error');
  S.chat.push({ role: 'user', content: (dictated ? DICT : '') + text }); save();
  let spoken = '';
  busy = true; liveText = ''; render();
  try {
    if (!sdk) sdk = (await import(SDK_URL)).default;
    const client = new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
    const model = S.settings.model;
    // Systemprompt (enthält die Uhrzeit) einmal pro Anfrage festlegen. Denkblöcke gelten nur für genau den
    // Systemprompt, mit dem sie entstanden sind – ältere Runden schicken wir daher ohne sie.
    const system = systemPrompt();
    const turnStart = S.chat.length - 1;
    const history = () => S.chat.map((m, i) => {
      if (m.role !== 'assistant' || i >= turnStart || !Array.isArray(m.content)) return m;
      const content = m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
      return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] };
    }).filter(m => m.role === 'user' || m.role === 'assistant');
    for (let step = 0; step < 10; step++) {
      const params = {
        model, max_tokens: 16000, system, tools: TOOLS,
        messages: history(),
        thinking: { type: 'adaptive' }, output_config: { effort: S.settings.effort || 'low' },
      };
      // Bei einer Sicherheits-Ablehnung springt automatisch ein anderes Modell ein (nicht für Haiku verfügbar).
      if (model !== 'claude-haiku-5-5') { params.fallbacks = 'default'; params.betas = ['server-side-fallback-2026-07-01']; }
      const stream = client.beta.messages.stream(params);
      liveText = '';
      stream.on('text', t => { liveText += t; const el = $('#live-t'); if (el) { el.textContent = liveText; scrollChat(); } });
      const msg = await stream.finalMessage();
      addCost(costOf(msg.model || model, msg.usage));
      S.chat.push({ role: 'assistant', content: msg.content }); save();
      spoken += msg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') + ' ';

      if (msg.stop_reason === 'refusal') { S.chat.push({ role: 'ui-error', text: 'Claudia kann bei dieser Anfrage leider nicht helfen.' }); break; }
      if (msg.stop_reason === 'max_tokens') { S.chat.push({ role: 'ui-error', text: 'Die Antwort wurde wegen Längenbegrenzung abgeschnitten.' }); break; }
      if (msg.stop_reason !== 'tool_use') break;

      const results = msg.content.filter(b => b.type === 'tool_use').map(b => {
        try { return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(runTool(b.name, b.input)) }; }
        catch (e) { return { type: 'tool_result', tool_use_id: b.id, content: 'Fehler: ' + e.message, is_error: true }; }
      });
      S.chat.push({ role: 'user', content: results }); save();
      render();
    }
  } catch (e) {
    console.error(e);
    const st = e?.status;
    const txt = st === 401 ? 'API-Key ungültig – bitte in den Einstellungen prüfen.'
      : st === 429 ? 'Zu viele Anfragen – bitte kurz warten.'
      : st >= 500 ? 'Der Claude-Dienst ist gerade überlastet. Bitte gleich nochmal versuchen.'
      : !navigator.onLine ? 'Keine Internetverbindung.'
      : 'Fehler: ' + (e?.message || e);
    // Unvollständigen Verlauf (offene Werkzeug-Aufrufe) bereinigen, damit der nächste Versuch funktioniert
    const last = S.chat[S.chat.length - 1];
    if (last?.role === 'assistant' && last.content.some(b => b.type === 'tool_use')) S.chat.pop();
    if (S.chat[S.chat.length - 1]?.role === 'user' && typeof S.chat[S.chat.length - 1].content === 'string') S.chat.pop();
    S.chat.push({ role: 'ui-error', text: txt });
  }
  busy = false; liveText = ''; save();
  if (clearPending && (document.visibilityState === 'hidden' || tab !== 'chat')) { clearDictationChat(); return; }
  clearPending = false; render();
  if (dictated && S.settings.speak) speak(spoken.trim());
}

// ---------- Erinnerungen ----------
// Browser spielen Ton erst ab, nachdem einmal auf die Seite getippt wurde – dabei wird der Ton „freigeschaltet“.
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
['pointerdown', 'keydown', 'touchend'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));

// Alarmton: 3 × drei kurze Pieptöne (ca. 3 s). Die Töne werden gemerkt, damit eine Reaktion sie sofort stoppt.
let alarmNodes = [];
function playAlarm() {
  return new Promise(resolve => {
    unlockAudio();
    if (!audioCtx) return setTimeout(resolve, 3100);
    const t0 = audioCtx.currentTime + 0.05;
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) {
      const at = t0 + r * 1.0 + i * 0.2;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      o.connect(g).connect(audioCtx.destination); o.start(at); o.stop(at + 0.16);
      alarmNodes.push(o);
    }
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch {}
    setTimeout(resolve, 3100);
  });
}
function stopAlarmSound() {
  for (const o of alarmNodes) try { o.stop(); } catch {}
  alarmNodes = [];
  try { navigator.vibrate?.(0); } catch {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// Alarm läuft, bis im Alarmfenster ein Knopf getippt wird
let alarmActive = false, alarmList = [];
function showAlarm(list) {
  for (const t of list) if (!alarmList.some(x => x.id === t.id)) alarmList.push(t);
  let el = $('#alarm');
  if (!el) { el = document.createElement('div'); el.id = 'alarm'; document.body.appendChild(el); }
  el.innerHTML = `<div class="alarm-box" role="alertdialog" aria-label="Erinnerung">
    <div class="alarm-head">⏰ Erinnerung</div>
    ${alarmList.map(t => `<div class="alarm-item"><b>${esc(t.title)}</b><span class="hint">${t.due === today() ? 'heute' : fmtDate(t.due)} ${esc(t.time)}</span>
      <div class="row"><button class="btn" data-a="done" data-id="${t.id}">Erledigt</button>
      <button class="btn ghost" data-a="snooze" data-id="${t.id}">10 Min. später</button></div></div>`).join('')}
    <button class="btn ghost" data-a="close" style="width:100%">OK – Alarm aus</button></div>`;
  el.hidden = false;
  el.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
    alarmActive = false; stopAlarmSound();          // jede Reaktion beendet den Ton
    const t = S.tasks.find(x => x.id === b.dataset.id);
    if (b.dataset.a === 'done' && t) { toggleTask(t.id, true); toast('Erledigt ✓'); }
    if (b.dataset.a === 'snooze' && t) {
      const n = new Date(Date.now() + 10 * 60_000);
      t.due = iso(n); t.time = n.toTimeString().slice(0, 5);
      S.notified = S.notified.filter(x => x !== t.id); save(); toast('Erinnere dich um ' + t.time);
    }
    alarmList = alarmList.filter(x => x.id !== b.dataset.id);
    b.closest('.alarm-item')?.remove();
    if (b.dataset.a === 'close' || !el.querySelector('.alarm-item')) { el.hidden = true; alarmList = []; }
    render();
  });
}

const waitSpeech = () => new Promise(res => {
  const t0 = Date.now();
  const tick = () => (!alarmActive || !speechSynthesis.speaking && Date.now() - t0 > 300 || Date.now() - t0 > 20000) ? res() : setTimeout(tick, 200);
  tick();
});
async function fireAlarm(list) {
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    for (const t of list) try { new Notification('⏰ Claudia erinnert dich', { body: t.title, icon: 'icon.svg', tag: t.id, requireInteraction: true }); } catch {}
  }
  showAlarm(list);
  if (alarmActive) return;                          // läuft schon – neue Erinnerung wird mit angesagt
  alarmActive = true;
  const sound = S.settings.alarmSound !== false, say = S.settings.alarmSpeak !== false && 'speechSynthesis' in window;
  if (!sound && !say) { alarmActive = false; return; }
  let round = 0;
  while (alarmActive) {
    if (sound) await playAlarm();
    if (!alarmActive) break;
    // Ansage beim ersten Mal und danach jede 3. Runde
    if (say && round % 3 === 0) { speak('Erinnerung: ' + alarmList.map(t => t.title).join('. Und: ')); await waitSpeech(); }
    if (!sound && round >= 2) break;               // ohne Ton: nur dreimal ansagen
    round++;
    await new Promise(r => setTimeout(r, 1200));
  }
}

function checkReminders() {
  const now = new Date(), d = today(), hm = now.toTimeString().slice(0, 5);
  const due = S.tasks.filter(t => !t.done && t.time && t.due && !S.notified.includes(t.id) && (t.due < d || (t.due === d && t.time <= hm)));
  if (!due.length) return;
  S.notified.push(...due.map(t => t.id)); save();
  // Nur Erinnerungen der letzten 12 Stunden klingeln; ältere werden still als erledigt-gemeldet markiert
  const recent = due.filter(t => now - new Date(t.due + 'T' + t.time) < 12 * 3600_000);
  if (recent.length) fireAlarm(recent);
}

// ---------- Start ----------
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$('#btn-settings').addEventListener('click', settingsDialog);
$('#btn-contacts').addEventListener('click', contactsDialog);
$('#btn-credit').addEventListener('click', creditDialog);
renderCredit();
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
window.addEventListener('storage', () => { S = load(); render(); });
render();
purgeDone(); checkReminders(); setInterval(() => { purgeDone(); checkReminders(); }, 15_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkReminders(); });
// Sync: beim Start, beim Zurückkehren in die App, wieder online und alle 90 s im Vordergrund
syncNow();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('online', () => syncNow());
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 90_000);
setInterval(() => { if (tab === 'today' && !dlg.open) render(); }, 5 * 60_000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
