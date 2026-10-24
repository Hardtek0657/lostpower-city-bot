const $ = (s) => document.querySelector(s);
let state = null;

const LEVELS = ['info', 'warn', 'error'];

function paintStatus() {
  const pill = $('#status');
  const s = state.status?.state ?? 'idle';
  const detail = state.status?.detail ?? '';
  pill.className = `status ${s}`;
  pill.title = detail;
  $('#statusText').textContent = s;

  const notice = $('#notice');
  const show = detail && (s === 'paused' || s === 'error');
  notice.hidden = !show;
  notice.textContent = show ? detail : '';
}

function settingRow(id, schema, value) {
  const row = document.createElement('label');
  row.className = 'row';

  const name = document.createElement('span');
  name.textContent = schema.label;

  let input;
  if (schema.type === 'bool') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
  } else if (schema.type === 'select') {
    input = document.createElement('select');
    for (const opt of schema.options) {
      const o = document.createElement('option');
      const value = opt && typeof opt === 'object' ? opt.value : opt;
      o.value = String(value);
      o.textContent = opt && typeof opt === 'object' ? opt.label : String(opt);
      input.append(o);
    }
    input.value = String(value);
  } else {
    input = document.createElement('input');
    input.type = 'number';
    input.min = schema.min;
    input.max = schema.max;
    input.value = value;
  }

  input.addEventListener('change', async () => {
    const v =
      schema.type === 'bool' ? input.checked
      : schema.type === 'number' ? Number(input.value)
      : input.value;
    const r = await window.bot.patch({ features: { [id]: { [schema.key]: v } } });
    state.config = r.config;
    state.features = r.features;
  });

  row.append(name, input);
  return row;
}

const expanded = new Set();
let accountOpen = false;

function summaryOf(f, cfg) {
  const parts = [];
  if (cfg.variant) parts.push(String(cfg.variant));
  if (cfg.stat) parts.push(String(cfg.stat));
  if (cfg.privateGym) parts.push('private gym');
  if (cfg.bet != null) parts.push(`bet ${cfg.bet}`);
  if (cfg.maxHands != null) parts.push(`${cfg.maxHands} hands`);
  if (cfg.maxSets != null) parts.push(`${cfg.maxSets} sets`);
  return parts.join(' · ');
}

function renderFeatures() {
  const box = $('#features');
  box.replaceChildren();

  for (const f of [...state.features].sort((a, b) => a.label.localeCompare(b.label))) {
    const cfg = state.config.features?.[f.id] ?? {};
    const open = expanded.has(f.id);
    const card = document.createElement('div');
    card.className = `feature${f.enabled ? ' on' : ''}${open ? ' open' : ''}`;

    const head = document.createElement('div');
    head.className = 'head';

    const disc = document.createElement('button');
    disc.type = 'button';
    disc.className = 'disclosure';
    disc.setAttribute('aria-expanded', String(open));
    disc.setAttribute('aria-controls', `set-${f.id}`);
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▸';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.label;
    disc.append(chev, name);
    disc.addEventListener('click', () => {
      if (expanded.has(f.id)) expanded.delete(f.id);
      else expanded.add(f.id);
      renderFeatures();
    });

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = f.enabled;
    toggle.title = `${f.enabled ? 'stop' : 'start'} ${f.label}`;
    toggle.addEventListener('change', async () => {
      if (toggle.checked) expanded.add(f.id);
      const r = await window.bot.setEnabled(f.id, toggle.checked);
      state.features = r.features;
      if (r.status) state.status = r.status;
      renderFeatures();
      paintStatus();
    });
    head.append(disc, toggle);

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = f.description;

    const summary = document.createElement('p');
    summary.className = 'summary';
    summary.textContent = summaryOf(f, cfg);
    if (cfg.dryRun) {
      const dry = document.createElement('span');
      dry.className = 'dry';
      dry.textContent = ' · DRY RUN';
      summary.append(dry);
    }

    const settings = document.createElement('div');
    settings.className = 'settings';
    settings.id = `set-${f.id}`;
    for (const schema of f.settings) settings.append(settingRow(f.id, schema, cfg[schema.key]));

    card.append(head, desc, summary, settings);
    box.append(card);
  }
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

function paintStats(stats) {
  const box = $('#session');
  if (!stats) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('#st-hands').textContent = stats.hands ?? 0;

  const pl = stats.pl ?? 0;
  const plEl = $('#st-pl');
  plEl.textContent = `${pl > 0 ? '+' : ''}${pl}`;
  plEl.className = pl > 0 ? 'up' : pl < 0 ? 'down' : '';

  $('#st-tokens').textContent = fmtTokens(stats.tokens?.total);

  const pct = stats.llm ? Math.round((stats.agree / stats.llm) * 100) : null;
  $('#st-agree').textContent = pct == null ? '–' : `${pct}%`;

  const last = stats.last;
  $('#st-last').textContent = last
    ? `${last.hand} · ${last.action} [${last.source}]${last.result ? ` · ${last.result.split('.')[0]}` : ''}`
    : 'waiting for the first hand…';
}

function paintAccount() {
  const g = state.config?.game ?? {};
  $('#autoLogin').checked = Boolean(g.autoLogin);
  $('#gUser').value = g.username ?? '';
  $('#gPass').value = '';
  $('#gPass').placeholder = g.hasPassword ? '•••• saved' : 'not set';
  $('#authState').textContent = g.hasPassword ? 'password saved' : '';
  $('#acctSummary').textContent = [g.username, g.hasPassword ? 'password saved' : 'no saved login']
    .filter(Boolean)
    .join(' · ');
  $('#account').classList.toggle('open', accountOpen);
  $('#acctToggle').setAttribute('aria-expanded', String(accountOpen));
}

function addLog(entry) {
  const li = document.createElement('li');
  li.className = LEVELS.includes(entry.level) ? entry.level : 'info';
  const time = String(entry.t).slice(11, 19);
  li.textContent = `${time} ${entry.msg}`;
  li.title = entry.data ? JSON.stringify(entry.data) : entry.msg;
  const ol = $('#log');
  ol.append(li);
  while (ol.children.length > 400) ol.firstChild.remove();
  ol.scrollTop = ol.scrollHeight;
}

async function init() {
  state = await window.bot.getState();
  renderFeatures();
  paintStatus();
  paintStats(state.stats ?? null);
  paintAccount();
  for (const entry of state.log) addLog(entry);

  window.bot.onLog(addLog);
  window.bot.onStatus((s) => {
    state.status = s;
    paintStatus();
  });
  window.bot.onStats((s) => paintStats(s));
  window.bot.onFeatures((f) => {
    state.features = f;
    renderFeatures();
  });
  $('#clearLog').addEventListener('click', () => $('#log').replaceChildren());
  $('#popLog').addEventListener('click', () => window.bot.popoutLog());
  $('#acctToggle').addEventListener('click', () => {
    accountOpen = !accountOpen;
    paintAccount();
  });
  $('#clearAuth').addEventListener('click', async () => {
    if (!window.confirm('Forget the saved username and password?')) return;
    const res = await window.bot.clearAuth();
    state.config = res.config;
    paintAccount();
    $('#authState').textContent = 'cleared';
  });
  $('#saveAuth').addEventListener('click', async () => {
    const res = await window.bot.saveAuth({
      autoLogin: $('#autoLogin').checked,
      username: $('#gUser').value.trim(),
      password: $('#gPass').value,
    });
    state.config = res.config;
    paintAccount();
    $('#authState').textContent = 'saved';
  });
}

init();
