// Building blocks shared by the pages: cards, labelled fields, inputs that edit numbers without
// fighting the cursor, status dots and a small level meter.

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MeterTuple } from '../src/summary.ts';

export function Page(props: {
  readonly title: string;
  readonly intro?: ComponentChildren;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="page" aria-labelledby="page-title">
      <header class="page-header">
        <h1 id="page-title">{props.title}</h1>
        {props.intro !== undefined && <p class="intro">{props.intro}</p>}
      </header>
      {props.children}
    </section>
  );
}

export function Card(props: {
  readonly title: string;
  readonly id?: string;
  readonly actions?: ComponentChildren;
  readonly children: ComponentChildren;
  readonly wide?: boolean;
}): JSX.Element {
  return (
    <section class={props.wide === true ? 'card wide' : 'card'} id={props.id}>
      <header class="card-header">
        <h2>{props.title}</h2>
        {props.actions !== undefined && <div class="card-actions">{props.actions}</div>}
      </header>
      {props.children}
    </section>
  );
}

/** A label, the control, and an optional line of help below. */
export function Field(props: {
  readonly label: string;
  readonly help?: ComponentChildren;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      <span class="field-control">{props.children}</span>
      {props.help !== undefined && <span class="field-help">{props.help}</span>}
    </label>
  );
}

/**
 * A number input that keeps what is typed while it is not a number yet ("-" or an empty box)
 * and passes on every valid number.
 */
export function NumberInput(props: {
  readonly value: number;
  readonly onChange: (n: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly id?: string;
  readonly label?: string;
}): JSX.Element {
  const [text, setText] = useState(String(props.value));
  useEffect(() => {
    if (Number(text) !== props.value) setText(String(props.value));
    // Only follows changes from outside: typing keeps the text as it is.
  }, [props.value]);
  return (
    <span class="number">
      <input
        type="number"
        id={props.id}
        aria-label={props.label}
        value={text}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          const n = Number(t);
          if (t.trim() !== '' && Number.isFinite(n)) props.onChange(n);
        }}
      />
      {props.unit !== undefined && <span class="unit">{props.unit}</span>}
    </span>
  );
}

export function TextInput(props: {
  readonly value: string;
  readonly onChange: (s: string) => void;
  readonly placeholder?: string;
  readonly label?: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <input
      type="text"
      class={props.mono === true ? 'mono' : undefined}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      spellcheck={false}
      onInput={(e) => {
        props.onChange(e.currentTarget.value);
      }}
    />
  );
}

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Select<T extends string>(props: {
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  readonly onChange: (v: T) => void;
  readonly label?: string;
}): JSX.Element {
  return (
    <select
      value={props.value}
      aria-label={props.label}
      onChange={(e) => {
        props.onChange(e.currentTarget.value as T);
      }}
    >
      {props.choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function Check(props: {
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.currentTarget.checked);
        }}
      />
      <span>{props.children}</span>
    </label>
  );
}

export type DotState = 'ok' | 'busy' | 'fail' | 'off' | 'info';

export function Dot(props: { readonly state: DotState; readonly label?: string }): JSX.Element {
  return <span class={`dot ${props.state}`} role="img" aria-label={props.label ?? props.state} />;
}

/** A horizontal level meter from -60 to 0 dBFS, with a peak tick and a clip lamp. */
export function Meter(props: {
  readonly levels: readonly (MeterTuple | undefined)[];
}): JSX.Element {
  const pos = (db: number): number => Math.max(0, Math.min(1, (db + 60) / 60)) * 100;
  return (
    <span class="meter" aria-hidden="true">
      {props.levels.map((m, i) => (
        <span class="meter-bar" key={i}>
          <span class="meter-fill" style={{ width: `${String(pos(m?.[0] ?? -100))}%` }} />
          <span class="meter-peak" style={{ left: `${String(pos(m?.[1] ?? -100))}%` }} />
          <span class={m?.[2] === 1 ? 'meter-clip on' : 'meter-clip'} />
        </span>
      ))}
    </span>
  );
}

export function Button(props: {
  readonly onClick: () => void;
  readonly children: ComponentChildren;
  readonly kind?: 'primary' | 'danger' | 'quiet';
  readonly disabled?: boolean;
  readonly title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class={props.kind ?? ''}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
