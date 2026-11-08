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
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { toast('Speichern fehlgeschlagen'); } }
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const setKey = k => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} };

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
function toggleTask(id, done) {
  const t = S.tasks.find(x => x.id === id); if (!t) return null;
  t.done = done ?? !t.done; t.doneAt = t.done ? Date.now() : null; save(); return t;
}
function addNote({ title, text = '' }) {
  const n = { id: uid(), title: (title || text.split('\n')[0] || 'Notiz').trim().slice(0, 80), text, updated: Date.now() };
  S.notes.unshift(n); save(); return n;
}
const sortTasks = arr => [...arr].sort((a, b) => (a.done - b.done) || ((a.due || '9999') + (a.time || '99')).localeCompare((b.due || '9999') + (b.time || '99')) || a.created - b.created);

// ---------- Ansichten ----------
let tab = 'today', taskFilter = 'offen', catFilter = 'Alle', noteQuery = '';
function go(t) {
  tab = t;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  render();
}
function render() {
  const v = $('#view');
  v.innerHTML = { today: viewToday, tasks: viewTasks, notes: viewNotes, chat: viewChat }[tab]();
  bind(v);
  if (tab === 'chat') scrollChat();
}

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
    <button class="mini" data-act="del-task" data-id="${t.id}" aria-label="Löschen" title="Löschen">✕</button>
  </div>`;
}
const quickAdd = (ph = 'Neue Aufgabe … (Enter)') => `<form class="quick" data-form="quick-task">
  <input type="text" name="title" placeholder="${ph}" autocomplete="off" required>
  <button class="btn" aria-label="Hinzufügen">＋</button></form>`;

function viewToday() {
  const open = S.tasks.filter(t => !t.done);
  const over = sortTasks(open.filter(isOverdue));
  const tod = sortTasks(open.filter(isToday));
  const next = sortTasks(open.filter(t => t.due > today())).slice(0, 5);
  const doneToday = S.tasks.filter(t => t.done && t.doneAt && iso(t.doneAt) === today()).length;
  const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<h1>${esc(greeting())}</h1><p class="sub">${date}</p>
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
  let list = S.tasks.filter(t => taskFilter === 'alle' || (taskFilter === 'offen' ? !t.done : t.done));
  if (catFilter !== 'Alle') list = list.filter(t => t.cat === catFilter);
  list = sortTasks(list);
  const chip = (val, cur, act) => `<button class="chip ${val === cur ? 'active' : ''}" data-act="${act}" data-v="${val}">${val[0].toUpperCase() + val.slice(1)}</button>`;
  return `<h1>Aufgaben</h1>
  ${quickAdd()}
  <div class="toolbar">
    <div class="chips">${['offen', 'erledigt', 'alle'].map(v => chip(v, taskFilter, 'tfilter')).join('')}</div>
    <div class="chips">${['Alle', 'Privat', 'Geschäftlich'].map(v => chip(v, catFilter, 'cfilter')).join('')}</div>
  </div>
  <div class="list">${list.map(taskRow).join('') || '<div class="card empty">Keine Aufgaben in dieser Ansicht.</div>'}</div>
  ${taskFilter !== 'offen' && S.tasks.some(t => t.done) ? '<p style="text-align:center"><button class="btn ghost" data-act="clear-done">Erledigte löschen</button></p>' : ''}`;
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
        else if (b.type === 'tool_use') parts.push(`<div class="msg tool">✦ ${esc(TOOL_LABEL[b.name] || b.name)}</div>`);
      }
    } else if (m.role === 'ui-error') parts.push(`<div class="msg err">${esc(m.text)}</div>`);
  }
  if (busy) parts.push(`<div class="msg bot" id="live"><span id="live-t">${esc(liveText)}</span><span class="typing"></span></div>`);
  const empty = !S.chat.length && !busy;
  return `<div class="chat-wrap"><div class="toolbar" style="justify-content:space-between;align-items:center;margin-top:0">
      <h1 style="margin:0">Claudia</h1>
      ${S.chat.length ? '<button class="btn ghost" data-act="new-chat">Neuer Chat</button>' : ''}</div>
    ${!getKey() ? `<div class="card" style="padding:14px;margin-bottom:12px">Für den Chat braucht Claudia einen Anthropic API-Key.
      <div style="margin-top:8px"><button class="btn" data-act="settings">API-Key eintragen</button></div></div>` : ''}
    ${empty ? `<p class="sub">Ich kenne deine Aufgaben und Notizen und kann neue anlegen, abhaken und suchen. Frag einfach.</p>
      <div class="suggest">${['Plane meinen Tag', 'Was ist diese Woche fällig?', 'Notiere: Reifenwechsel bis Ende November', 'Fasse meine Notizen zusammen'].map(s => `<button class="chip" data-act="ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <div class="chat">${parts.join('')}</div></div>
  <div class="composer"><form data-form="chat">
    <textarea name="q" placeholder="${rec ? 'Ich höre zu …' : 'Nachricht an Claudia … oder 🎙 tippen'}" rows="1" ${busy ? 'disabled' : ''}></textarea>
    <button type="button" class="btn mic ${rec ? 'listening' : ''}" data-act="dictate" ${busy ? 'disabled' : ''} aria-label="Diktieren" title="Diktieren">${rec ? '■' : '🎙'}</button>
    <button class="btn" ${busy ? 'disabled' : ''} aria-label="Senden">➤</button></form></div>`;
}

// ---------- Nachrichten-Entwürfe (WhatsApp) ----------
const DICT = '[Diktiert] ';
const norm = s => String(s || '').trim().toLowerCase();
// Nur angehakte (freigegebene) Kontakte sind für Claudia sichtbar
const allowed = () => S.contacts.filter(c => c.on !== false);
function findContact(name) {
  const n = norm(name); if (!n) return null;
  const list = allowed();
  const exact = list.find(c => norm(c.name) === n); if (exact) return exact;
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
  const who = c ? `<b>${esc(c.name)}</b> · ${esc(c.phone)}` : `<b>${esc(inp.recipient || 'Empfänger offen')}</b> · Nummer unbekannt, Kontakt wählst du in WhatsApp`;
  return `<div class="card draft">
    <div class="meta">✉︎ Nachricht an ${who}</div>
    <textarea data-draft="${b.id}" rows="4">${esc(S.draftEdits[b.id] ?? inp.text ?? '')}</textarea>
    <div class="actions">
      <button class="btn wa" data-act="wa" data-id="${b.id}">${sent ? '✓ Erneut in WhatsApp öffnen' : 'In WhatsApp öffnen'}</button>
      ${navigator.share ? `<button class="btn ghost" data-act="share" data-id="${b.id}">Teilen …</button>` : ''}
      <button class="btn ghost" data-act="copy" data-id="${b.id}">Kopieren</button>
    </div>
    ${sent ? '<div class="hint">An WhatsApp übergeben. Dort auf Senden tippen.</div>' : ''}</div>`;
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
  S.draftSent[id] = true; save();
  window.open(url, '_blank', 'noopener');
  render();
}

// ---------- Diktat (Spracherkennung des Browsers) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function startDictation() {
  if (tab !== 'chat') go('chat');
  if (rec) { rec.stop(); return; }
  if (busy) return;
  if (!SR) {
    toast('Spracherkennung fehlt hier. Nutze das Mikrofon auf der Tastatur.');
    $('form[data-form=chat] textarea')?.focus(); return;
  }
  speechSynthesis?.cancel();
  const r = new SR();
  r.lang = 'de-DE'; r.continuous = true; r.interimResults = true;
  const base = ($('form[data-form=chat] textarea')?.value.trim() || '');
  let heard = '';
  r.onresult = e => {
    // Bei jedem Ereignis komplett neu zusammensetzen (vermeidet doppelte Wörter auf Android)
    heard = [...e.results].map(x => x[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    const ta = $('form[data-form=chat] textarea'); if (ta) ta.value = (base ? base + ' ' : '') + heard;
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Mikrofon ist nicht erlaubt');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Spracherkennung: ' + e.error);
  };
  r.onend = () => {
    rec = null;
    const txt = (($('form[data-form=chat] textarea')?.value) || '').trim();
    if (heard && txt && S.settings.autoSend) sendChat(txt, false, true);
    else { render(); const ta = $('form[data-form=chat] textarea'); if (ta) { ta.value = txt; ta.focus(); } }
  };
  rec = r; render();
  const ta = $('form[data-form=chat] textarea'); if (ta) ta.value = base;
  try { r.start(); } catch { rec = null; render(); }
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
function scrollChat() { requestAnimationFrame(() => { const m = $('#view'); m.scrollTop = m.scrollHeight; }); }

// ---------- Events ----------
function bind(root) {
  root.querySelectorAll('textarea[data-draft]').forEach(ta => ta.addEventListener('input', () => { S.draftEdits[ta.dataset.draft] = ta.value; save(); }));
  root.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); act(el.dataset.act, el.dataset); }));
  root.querySelectorAll('form[data-form]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); submit(f.dataset.form, f); }));
  const nq = $('#note-q');
  if (nq) nq.addEventListener('input', () => { noteQuery = nq.value; const pos = nq.selectionStart; render(); const n = $('#note-q'); n.focus(); n.setSelectionRange(pos, pos); });
  const ta = root.querySelector('form[data-form=chat] textarea');
  if (ta) ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.form.requestSubmit(); } });
}
function act(a, d) {
  switch (a) {
    case 'goto': return go(d.tab);
    case 'toggle': { const t = toggleTask(d.id); if (t?.done) toast('Erledigt ✓'); return render(); }
    case 'del-task': S.tasks = S.tasks.filter(t => t.id !== d.id); save(); toast('Gelöscht'); return render();
    case 'edit-task': return taskDialog(S.tasks.find(t => t.id === d.id));
    case 'tfilter': taskFilter = d.v; return render();
    case 'cfilter': catFilter = d.v; return render();
    case 'clear-done': if (confirm('Alle erledigten Aufgaben löschen?')) { S.tasks = S.tasks.filter(t => !t.done); save(); render(); } return;
    case 'new-note': return noteDialog();
    case 'edit-note': return noteDialog(S.notes.find(n => n.id === d.id));
    case 'new-chat': S.chat = []; S.draftEdits = {}; S.draftSent = {}; save(); return render();
    case 'dictate': return startDictation();
    case 'wa': return openWhatsApp(d.id);
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
  dlg.innerHTML = `<form class="dlg" method="dialog">${html}</form>`;
  const f = dlg.querySelector('form');
  f.addEventListener('submit', e => { const r = onSubmit(e.submitter?.value, new FormData(f)); if (r === false) e.preventDefault(); else render(); });
  if (!dlg.open) dlg.showModal();
}
function taskDialog(t) {
  if (!t) return;
  openDialog(`<h3>Aufgabe bearbeiten</h3>
    <label>Titel<input type="text" name="title" value="${esc(t.title)}" required></label>
    <div class="row"><label>Fällig am<input type="date" name="due" value="${esc(t.due)}"></label>
    <label>Uhrzeit (Erinnerung)<input type="time" name="time" value="${esc(t.time)}"></label></div>
    <label>Kategorie<select name="cat">${['Privat', 'Geschäftlich'].map(c => `<option ${c === t.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="actions"><button class="btn ghost" value="cancel" formnovalidate>Abbrechen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => { if (v !== 'ok') return; Object.assign(t, { title: fd.get('title').trim(), due: fd.get('due'), time: fd.get('time'), cat: fd.get('cat') }); S.notified = S.notified.filter(x => x !== t.id); save(); });
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
  openDialog(`<h3>Einstellungen</h3>
    <label>Wie soll Claudia dich nennen?<input type="text" name="name" value="${esc(s.name)}"></label>
    <label>Anthropic API-Key<input type="password" name="key" value="${esc(getKey())}" placeholder="sk-ant-…" autocomplete="off"></label>
    <div class="hint">Wird nur auf diesem Gerät gespeichert und direkt an api.anthropic.com gesendet. Key erstellen: console.anthropic.com → API Keys.</div>
    <div class="row"><label>Modell<select name="model">${Object.entries(MODELS).map(([k, l]) => `<option value="${k}" ${k === s.model ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Gründlichkeit<select name="effort">${[['low', 'Schnell'], ['medium', 'Ausgewogen'], ['high', 'Gründlich']].map(([k, l]) => `<option value="${k}" ${k === s.effort ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <h3 style="margin-top:6px">Diktat & WhatsApp</h3>
    <label class="cb"><input type="checkbox" name="autoSend" ${s.autoSend ? 'checked' : ''}> Diktat nach dem Sprechen automatisch an Claudia senden</label>
    <label class="cb"><input type="checkbox" name="speak" ${s.speak ? 'checked' : ''}> Claudias Antwort nach einem Diktat vorlesen</label>
    <button class="btn ghost" value="contacts" formnovalidate>Kontakte für Claudia (${allowed().length} von ${S.contacts.length} freigegeben)</button>
    <h3 style="margin-top:6px">Erinnerungen</h3>
    <div class="hint">Benachrichtigung zur eingetragenen Uhrzeit, solange Claudia geöffnet ist (auch im Hintergrund-Tab).</div>
    <button class="btn ghost" value="notify" formnovalidate>${'Notification' in window && Notification.permission === 'granted' ? 'Benachrichtigungen sind aktiv ✓' : 'Benachrichtigungen erlauben'}</button>
    <h3 style="margin-top:6px">Daten (PC ↔ Handy)</h3>
    <div class="hint">Daten liegen lokal auf jedem Gerät. Zum Übertragen exportieren und auf dem anderen Gerät importieren (z. B. über OneDrive). Der API-Key wird nicht exportiert.</div>
    <div class="row"><button class="btn ghost" value="export" formnovalidate>Exportieren</button><button class="btn ghost" value="import" formnovalidate>Importieren</button></div>
    <div class="actions"><button class="btn ghost" value="cancel" formnovalidate>Schließen</button><button class="btn" value="ok">Speichern</button></div>`,
    (v, fd) => {
      if (v === 'export') return exportData(), false;
      if (v === 'import') return importData(), false;
      if (v === 'contacts') { setTimeout(contactsDialog); return; }
      if (v === 'notify') { Notification?.requestPermission().then(p => toast(p === 'granted' ? 'Benachrichtigungen aktiv' : 'Nicht erlaubt')); return false; }
      if (v !== 'ok') return;
      Object.assign(s, { name: fd.get('name').trim(), model: fd.get('model'), effort: fd.get('effort'), autoSend: fd.has('autoSend'), speak: fd.has('speak') });
      setKey(fd.get('key').trim()); save(); toast('Gespeichert');
    });
}
let contactQuery = '';
function contactsDialog() {
  const canPick = 'contacts' in navigator && 'select' in (navigator.contacts || {});
  const rows = [...S.contacts].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(c =>
    `<div class="crow ${c.on === false ? 'off' : ''}" data-q="${esc(norm(c.name + ' ' + c.phone))}">
       <label class="cb"><input type="checkbox" data-cid="${c.id}" ${c.on === false ? '' : 'checked'}>
       <span><b>${esc(c.name)}</b><span class="hint"> ${esc(c.phone)}${waNumber(c.phone) ? '' : ' ⚠︎ ohne +Ländervorwahl'}</span></span></label>
       <button class="mini" value="del:${c.id}" formnovalidate aria-label="Löschen">✕</button></div>`).join('');
  openDialog(`<h3>Kontakte für Claudia</h3>
    <div class="hint">Nur <b>angehakte</b> Kontakte kann Claudia sehen und als Empfänger nutzen. Alle anderen bleiben unsichtbar für sie und werden nie an die KI gesendet.</div>
    <div class="ccount hint" id="ccount"></div>
    ${S.contacts.length ? `<input type="search" id="cq" placeholder="Kontakt suchen …" value="${esc(contactQuery)}">
    <div class="chips"><button type="button" class="chip" data-call="1">Alle sichtbaren anhaken</button><button type="button" class="chip" data-call="0">Alle sichtbaren abwählen</button></div>` : ''}
    <div class="clist">${rows || '<div class="hint">Noch keine Kontakte. Importiere dein Adressbuch als vCard-Datei (.vcf) oder trag einzelne Kontakte ein.</div>'}</div>
    <div class="row"><input type="text" name="cname" placeholder="Name (z. B. Maria)"><input type="text" name="cphone" placeholder="+49 …" inputmode="tel"></div>
    <div class="actions">
    <button class="btn ghost" value="vcf" formnovalidate>Adressbuch importieren (.vcf)</button>
    ${canPick ? '<button class="btn ghost" value="pick" formnovalidate>Aus Handy-Kontakten</button>' : ''}
    <button class="btn ghost" value="add" formnovalidate>Hinzufügen</button><button class="btn" value="cancel" formnovalidate>Fertig</button></div>
    <div class="hint">vCard exportieren: Android-Kontakte → Einstellungen → Exportieren · iPhone: Kontakte am PC über icloud.com → Exportieren · Outlook/Google Kontakte → Exportieren (vCard). Importierte Kontakte sind zunächst <b>nicht</b> freigegeben; hake an, wen Claudia kennen darf.</div>`,
    (v, fd) => {
      if (v?.startsWith('del:')) { S.contacts = S.contacts.filter(c => c.id !== v.slice(4)); save(); setTimeout(contactsDialog); return; }
      if (v === 'add') {
        const name = fd.get('cname').trim(), phone = fd.get('cphone').trim();
        if (!name || !phone) { toast('Name und Nummer eintragen'); return false; }
        saveContact(name, phone, true); setTimeout(contactsDialog); return;
      }
      if (v === 'vcf') { importVcf(); return false; }
      if (v === 'pick') {
        navigator.contacts.select(['name', 'tel'], { multiple: true }).then(list => {
          let n = 0; for (const p of list) if (p.name?.[0] && p.tel?.[0]) { saveContact(p.name[0], p.tel[0], true); n++; }
          toast(`${n} Kontakt(e) übernommen und freigegeben`); contactsDialog();
        }).catch(() => {});
        return;
      }
    });
  // Häkchen sofort speichern, Suche filtert ohne Neuaufbau
  const count = () => { const el = $('#ccount'); if (el) el.textContent = `${allowed().length} von ${S.contacts.length} Kontakten freigegeben`; };
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
function saveContact(name, phone, on) {
  const c = S.contacts.find(x => norm(x.name) === norm(name));
  if (c) { c.phone = phone; if (on !== undefined) c.on = on; }
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
    if (key === 'BEGIN') cur = { fn: '', n: '', tels: [] };
    else if (!cur) continue;
    else if (key === 'FN') cur.fn = dec(val);
    else if (key === 'N') { const p = val.split(';').map(dec); cur.n = [p[1], p[0]].filter(Boolean).join(' '); }
    else if (key === 'TEL') cur.tels.push({ num: val.replace(/^tel:/i, '').trim(), mobile: /CELL|MOBILE|IPHONE/i.test(head) });
    else if (key === 'END') {
      const name = cur.fn || cur.n, tel = cur.tels.find(t => t.mobile) || cur.tels[0];
      // Deutsche Inlandsnummer (0171 …) → +49 171 …
      if (name && tel) out.push({ name, phone: /^0[1-9]/.test(tel.num) ? '+49 ' + tel.num.slice(1) : tel.num });
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
      for (const p of list) { const had = S.contacts.some(x => norm(x.name) === norm(p.name)); saveContact(p.name, p.phone); if (!had) { S.contacts[S.contacts.length - 1].on = false; neu++; } }
      save(); toast(`${list.length} Kontakte gelesen, ${neu} neu (noch nicht freigegeben)`); contactsDialog();
    } catch { toast('Keine Kontakte mit Telefonnummer in der Datei gefunden'); }
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
      if (Array.isArray(d.contacts)) for (const c of d.contacts) if (c?.name && c?.phone) saveContact(c.name, c.phone, c.on !== false);
      save(); dlg.close(); render(); toast(`Importiert: ${d.tasks.length} Aufgaben, ${d.notes.length} Notizen`);
    } catch { toast('Keine gültige Claudia-Datei'); }
  };
  inp.click();
}

// ---------- Claudia (Claude API) ----------
const TOOL_LABEL = { list_contacts: 'Kontakte angesehen', save_contact: 'Kontakt gespeichert', list_tasks: 'Aufgaben angesehen', add_task: 'Aufgabe angelegt', update_task: 'Aufgabe geändert', complete_task: 'Aufgabe abgehakt', add_note: 'Notiz gespeichert', search_notes: 'Notizen durchsucht' };
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
  { name: 'list_contacts', description: 'Listet die Kontakte, die der Nutzer für dich freigegeben hat (Name, ob eine Nummer vorhanden ist). Andere Kontakte siehst du bewusst nicht.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'save_contact', description: 'Speichert oder aktualisiert einen Kontakt mit Telefonnummer (international, z. B. +49…). Nur wenn der Nutzer eine Nummer nennt.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } }, required: ['name', 'phone'], additionalProperties: false } },
  { name: 'prepare_message', description: 'Zeigt dem Nutzer einen fertigen Nachrichtenentwurf mit Button "In WhatsApp öffnen". Der Nutzer prüft und sendet selbst; du kannst nicht selbst senden. Nur aufrufen, wenn der Nutzer die Nachricht verschicken will und der Empfänger feststeht.',
    input_schema: { type: 'object', properties: { recipient: { type: 'string', description: 'Name des Empfängers wie in den Kontakten' }, text: { type: 'string', description: 'Endgültiger, korrigierter Nachrichtentext' } }, required: ['recipient', 'text'], additionalProperties: false } },
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
    case 'list_contacts': return allowed().map(c => ({ name: c.name, hat_nummer: !!waNumber(c.phone) }));
    case 'save_contact': {
      need('name'); need('phone');
      if (!waNumber(inp.phone)) throw new Error('Nummer braucht die Ländervorwahl mit + (z. B. +49…). Frag den Nutzer nach dem Land.');
      const c = saveContact(inp.name, inp.phone, true); return { name: c.name, gespeichert: true };
    }
    case 'prepare_message': {
      need('recipient'); need('text'); if (!inp.text.trim()) throw new Error('Text leer');
      const c = findContact(inp.recipient);
      return { angezeigt: true, kontakt_gefunden: !!c, hinweis: c ? 'Der Nutzer tippt jetzt selbst auf Senden.' : 'Kontakt unbekannt: Der Nutzer wählt ihn in WhatsApp aus. Biete an, die Nummer zu speichern.' };
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
Sobald der Empfänger feststeht: list_contacts prüfen, dann prepare_message mit dem passenden Namen. Ist der Name unklar (mehrere Treffer), kurz nachfragen. Du verschickst nie selbst; der Nutzer tippt im Entwurf auf "In WhatsApp öffnen" und dort auf Senden. Halte Antworten nach einem Diktat besonders kurz, sie werden vorgelesen.
Heute ist ${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${today()}), ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`;
}

let sdk = null;
async function sendChat(text, prefillOnly = false, dictated = false) {
  if (prefillOnly) { render(); const ta = $('form[data-form=chat] textarea'); ta.value = text; ta.focus(); return; }
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
    for (let step = 0; step < 10; step++) {
      const params = {
        model, max_tokens: 16000, system: systemPrompt(), tools: TOOLS,
        messages: S.chat.filter(m => m.role === 'user' || m.role === 'assistant'),
        thinking: { type: 'adaptive' }, output_config: { effort: S.settings.effort || 'low' },
      };
      // Bei einer Sicherheits-Ablehnung springt automatisch ein anderes Modell ein (nicht für Haiku verfügbar).
      if (model !== 'claude-haiku-5-5') { params.fallbacks = 'default'; params.betas = ['server-side-fallback-2026-07-01']; }
      const stream = client.beta.messages.stream(params);
      liveText = '';
      stream.on('text', t => { liveText += t; const el = $('#live-t'); if (el) { el.textContent = liveText; scrollChat(); } });
      const msg = await stream.finalMessage();
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
  busy = false; liveText = ''; save(); render();
  if (dictated && S.settings.speak) speak(spoken.trim());
}

// ---------- Erinnerungen ----------
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date(), d = today(), hm = now.toTimeString().slice(0, 5);
  for (const t of S.tasks) {
    if (t.done || !t.time || !t.due || S.notified.includes(t.id)) continue;
    if (t.due < d || (t.due === d && t.time <= hm)) {
      try { new Notification('Claudia erinnert dich', { body: t.title, icon: 'icon.svg', tag: t.id }); } catch {}
      S.notified.push(t.id); save();
    }
  }
}

// ---------- Start ----------
document.querySelectorAll('.tabbar button, .topbar .avatar').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$('#btn-settings').addEventListener('click', settingsDialog);
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
window.addEventListener('storage', () => { S = load(); render(); });
render();
checkReminders(); setInterval(checkReminders, 60_000);
setInterval(() => { if (tab === 'today' && !dlg.open) render(); }, 5 * 60_000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
