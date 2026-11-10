// The virtual deck's web page: a Stream Deck XL drawn in HTML. Key images arrive as server-sent
// events; pressing a key (mouse or touch) posts key down and key up, so long presses, double
// taps and held ± keys work as on the hardware.

const STYLE = `
:root { color-scheme: dark; --key: 96px; --gap: 14px; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  background: #0d0e10; color: #c9ccd1; font: 14px/1.4 system-ui, sans-serif;
}
main { display: grid; gap: 16px; justify-items: start; padding: 16px; }
nav { display: flex; gap: 8px; align-items: center; }
nav button {
  font: inherit; color: inherit; background: #1c1e22; border: 1px solid #2c2f35;
  border-radius: 8px; padding: 6px 14px; cursor: pointer;
}
nav button[aria-pressed="true"] { background: #2b4a7a; border-color: #4b7bd0; color: #fff; }
#link { margin-left: 12px; color: #80868f; }
#toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 16px;
  background: #172433; border: 1px solid #355a85; border-radius: 10px; box-shadow: 0 12px 30px #0009;
}
#toast[hidden] { display: none; }
#toast a { color: #8fc1ff; }
#deck {
  display: grid; grid-template-columns: repeat(8, var(--key)); gap: var(--gap);
  padding: 26px 30px; background: #1b1d21; border-radius: 26px;
  box-shadow: 0 20px 50px #0008, inset 0 1px 0 #ffffff10;
}
.key {
  position: relative; width: var(--key); height: var(--key); padding: 0; border: 0;
  border-radius: 10px; background: #000; overflow: hidden; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.key img { display: block; width: 100%; height: 100%; pointer-events: none; }
.key.down { transform: scale(0.96); filter: brightness(1.15); }
.key::after {
  content: ""; position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 44px; font-weight: 700; opacity: 0; transition: opacity 0.15s;
}
.key.alert::after { content: "!"; background: #c62828cc; color: #fff; opacity: 1; }
.key.ok::after { content: "\\2713"; background: #2e7d32cc; color: #fff; opacity: 1; }
`;

const SCRIPT = `
const deck = document.getElementById('deck');
const link = document.getElementById('link');
const tabs = document.querySelectorAll('nav button[data-profile]');
const keys = new Map();
let state;

function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function build(s) {
  state = s;
  deck.textContent = '';
  keys.clear();
  for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.profile === s.profile));
  const present = new Set(s.keys);
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.columns; col++) {
      const id = s.profile + ':' + col + ',' + row;
      const key = document.createElement('button');
      key.className = 'key';
      key.dataset.column = String(col);
      key.dataset.row = String(row);
      if (present.has(id)) {
        key.dataset.id = id;
        const img = document.createElement('img');
        img.alt = '';
        if (s.images[id]) img.src = s.images[id];
        key.append(img);
        keys.set(id, key);
        let down = false;
        const release = () => {
          if (!down) return;
          down = false;
          key.classList.remove('down');
          post('/api/key', { id, action: 'up' });
        };
        key.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          key.setPointerCapture(e.pointerId);
          down = true;
          key.classList.add('down');
          post('/api/key', { id, action: 'down' });
        });
        key.addEventListener('pointerup', release);
        key.addEventListener('pointercancel', release);
        key.addEventListener('lostpointercapture', release);
        key.addEventListener('contextmenu', (e) => e.preventDefault());
      } else {
        key.disabled = true;
      }
      deck.append(key);
    }
  }
  document.body.dataset.ready = 'true';
}

function flash(id, cls) {
  const key = keys.get(id);
  if (!key) return;
  key.classList.add(cls);
  setTimeout(() => key.classList.remove(cls), 600);
}

for (const t of tabs) t.addEventListener('click', () => post('/api/profile', { profile: t.dataset.profile }));

const events = new EventSource('/events');
events.addEventListener('state', (e) => build(JSON.parse(e.data)));
// Another profile: its keys and their images come with the state.
events.addEventListener('profile', () => {
  fetch('/api/state').then((r) => r.json()).then(build);
});
events.addEventListener('image', (e) => {
  const { id, image } = JSON.parse(e.data);
  if (state) state.images[id] = image;
  const img = keys.get(id)?.querySelector('img');
  if (img) img.src = image;
});
events.addEventListener('alert', (e) => flash(JSON.parse(e.data).id, 'alert'));
events.addEventListener('ok', (e) => flash(JSON.parse(e.data).id, 'ok'));
events.onopen = () => { link.textContent = 'connected'; };
events.onerror = () => { link.textContent = 'reconnecting…'; };

// The window opens on the click; its one-time link follows.
document.getElementById('cc').addEventListener('click', () => {
  const w = window.open('', '_blank');
  fetch('/api/control-center').then((r) => r.json()).then(({ url }) => {
    if (w) w.location.href = url; else location.href = url;
  });
});

// A tap on the Status key: the browser opens no window without a click, so offer the link.
const toast = document.getElementById('toast');
let toastTimer;
events.addEventListener('open', (e) => {
  toast.querySelector('a').href = JSON.parse(e.data).url;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 15000);
});
toast.querySelector('a').addEventListener('click', () => { toast.hidden = true; });
`;

export function page(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Faderlight virtual deck</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <nav>
    <button data-profile="console" aria-pressed="false">Console</button>
    <button data-profile="own" aria-pressed="false">My page</button>
    <button id="cc">Control Center</button>
    <span id="link">connecting…</span>
  </nav>
  <div id="deck" role="grid" aria-label="Stream Deck XL"></div>
</main>
<p id="toast" role="status" hidden><a target="_blank" rel="noopener">Open the Control Center</a></p>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
