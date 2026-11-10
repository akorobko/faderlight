// The Property Inspector: the panel the Stream Deck app shows below its canvas for the selected
// key. It draws what the plugin sends (packages/deck/src/inspector.ts) and sends back each
// choice; the plugin checks it, stores the action's settings and answers with the new view.
// So the page has no rules of its own, and it keeps no settings: the plugin is the only writer.
//
// The app loads the page from the plugin folder and calls connectElgatoStreamDeckSocket() with
// the port of its WebSocket and the key's identity.

import type {
  InspectorField,
  InspectorRequest,
  InspectorUpdate,
  InspectorValue,
  InspectorView,
} from '@faderlight/deck';

interface ActionInfo {
  readonly action: string;
  readonly context: string;
}

type Connect = (
  port: number | string,
  uuid: string,
  registerEvent: string,
  info: string,
  actionInfo: string,
) => void;

const root = (): HTMLElement => {
  const el = document.getElementById('pi');
  if (!el) throw new Error('no #pi element');
  return el;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Option values travel as JSON, so a number stays a number and null means "not set". */
const encode = (v: InspectorValue): string => JSON.stringify(v);
const decode = (s: string): InspectorValue => JSON.parse(s) as InspectorValue;

class Inspector {
  private readonly send: (request: InspectorRequest) => void;
  private readonly fields = new Map<string, { row: HTMLElement; options: string }>();
  private readonly title = element('h1');
  private readonly summary = element('p', 'summary');
  private readonly note = element('p', 'note');
  private readonly form = element('div', 'fields');
  private readonly dot = element('span', 'dot off');
  private readonly statusText = element('span', 'status-text', 'Waiting for the plugin…');
  private readonly open = element('button', 'open', 'Open Control Center');

  constructor(send: (request: InspectorRequest) => void) {
    this.send = send;
    this.open.type = 'button';
    this.open.addEventListener('click', () => {
      this.send({ event: 'openControlCenter' });
    });
    const header = element('header');
    header.append(this.title, this.summary, this.note);
    const status = element('p', 'status');
    status.setAttribute('role', 'status');
    status.append(this.dot, this.statusText);
    const footer = element('footer');
    footer.append(status, this.open);
    root().replaceChildren(header, this.form, footer);
  }

  show(view: InspectorView): void {
    this.title.textContent = view.title;
    this.summary.textContent = view.summary;
    this.note.textContent = view.note ?? '';
    this.dot.className = `dot ${view.status.state}`;
    this.statusText.textContent = view.status.text;
    const keys = view.fields.map((f) => f.key);
    for (const [key, { row }] of this.fields) {
      if (!keys.includes(key)) {
        row.remove();
        this.fields.delete(key);
      }
    }
    // Rows are updated in place and only moved when the order changed: a list the person has
    // open stays open.
    view.fields.forEach((field, i) => {
      const row = this.row(field);
      if (this.form.children[i] !== row) this.form.insertBefore(row, this.form.children[i] ?? null);
    });
    document.body.dataset.ready = 'true';
  }

  private row(field: InspectorField): HTMLElement {
    const id = `field-${field.key}`;
    let entry = this.fields.get(field.key);
    if (!entry) {
      const row = element('div', 'field');
      const label = element('label', 'label', field.label);
      label.htmlFor = id;
      const select = element('select');
      select.id = id;
      select.addEventListener('change', () => {
        this.send({ event: 'set', key: field.key, value: decode(select.value) });
      });
      row.append(label, select, element('p', 'help'));
      entry = { row, options: '' };
      this.fields.set(field.key, entry);
    }
    const { row } = entry;
    const select = row.querySelector('select');
    const help = row.querySelector('.help');
    if (!select || !help) return row;
    const options = JSON.stringify(field.options);
    if (options !== entry.options) {
      entry.options = options;
      select.replaceChildren(...optionsOf(field));
    }
    if (document.activeElement !== select) select.value = encode(field.value);
    help.textContent = field.help ?? '';
    return row;
  }
}

function optionsOf(field: InspectorField): HTMLElement[] {
  const out: HTMLElement[] = [];
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const o of field.options) {
    const option = element('option', undefined, o.label);
    option.value = encode(o.value);
    if (o.group === undefined) {
      out.push(option);
      continue;
    }
    let group = groups.get(o.group);
    if (!group) {
      group = element('optgroup');
      group.label = o.group;
      groups.set(o.group, group);
      out.push(group);
    }
    group.append(option);
  }
  return out;
}

const connect: Connect = (port, uuid, registerEvent, _info, actionInfo) => {
  const action = JSON.parse(actionInfo) as ActionInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}`);
  const send = (payload: InspectorRequest): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({ event: 'sendToPlugin', action: action.action, context: uuid, payload }),
    );
  };
  const inspector = new Inspector(send);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    send({ event: 'hello' });
  });
  socket.addEventListener('message', (e: MessageEvent<string>) => {
    const m = JSON.parse(e.data) as { event?: string; payload?: Partial<InspectorUpdate> };
    if (m.event === 'sendToPropertyInspector' && m.payload?.event === 'view' && m.payload.view) {
      inspector.show(m.payload.view);
    }
  });
};

// The app looks for this function on the page.
Object.assign(globalThis, { connectElgatoStreamDeckSocket: connect });
