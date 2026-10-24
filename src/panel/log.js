const LEVELS = ['info', 'warn', 'error'];
const list = document.getElementById('log');
const count = document.getElementById('count');
let shown = 0;

function nearBottom() {
  return list.scrollTop + list.clientHeight >= list.scrollHeight - 48;
}

function add(entry) {
  const stick = nearBottom();
  const li = document.createElement('li');
  li.className = LEVELS.includes(entry.level) ? entry.level : 'info';
  li.textContent = `${String(entry.t).slice(11, 23)}  ${entry.msg}`;
  li.title = entry.data ? JSON.stringify(entry.data, null, 2) : entry.msg;
  list.append(li);
  shown += 1;
  count.textContent = `${shown} lines`;
  if (stick) list.scrollTop = list.scrollHeight;
}

document.getElementById('clear').addEventListener('click', () => {
  list.replaceChildren();
  shown = 0;
  count.textContent = '0 lines';
});

(async () => {
  for (const entry of await window.bot.getLog()) add(entry);
  list.scrollTop = list.scrollHeight;
  window.bot.onLog(add);
})().catch((e) => add({ t: new Date().toISOString(), level: 'error', msg: `log window: ${e.message}` }));
