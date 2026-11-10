// Console interaction: prompts for the person running the capture, or scripted answers in tests.

import { createInterface, type Interface } from 'node:readline';

export type EnterResult = 'done' | 'skip' | 'quit';

export interface Io {
  /** False when nobody can answer prompts (no TTY, --no-prompts, or tests). */
  readonly interactive: boolean;
  print(text?: string): void;
  heading(text: string): void;
  ok(text: string): void;
  warn(text: string): void;
  dim(text: string): void;
  /** Free-text question; returns `fallback` when not interactive or the answer is empty. */
  ask(question: string, fallback: string): Promise<string>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  /** Waits for Enter (done), "s" (skip) or "q" (quit). Not interactive: "skip". */
  waitForEnter(prompt: string): Promise<EnterResult>;
  /** Called on Ctrl+C. */
  onInterrupt(handler: () => void): void;
  close(): void;
}

function colours(
  enabled: boolean,
): Record<'bold' | 'green' | 'yellow' | 'grey', (s: string) => string> {
  const wrap =
    (open: number, close: number) =>
    (s: string): string =>
      enabled ? `\x1b[${String(open)}m${s}\x1b[${String(close)}m` : s;
  return { bold: wrap(1, 22), green: wrap(32, 39), yellow: wrap(33, 39), grey: wrap(90, 39) };
}

export class ConsoleIo implements Io {
  readonly interactive: boolean;
  private rl: Interface | undefined;
  private readonly c: ReturnType<typeof colours>;
  private interruptHandler: (() => void) | undefined;

  constructor(options: { prompts: boolean }) {
    this.interactive = options.prompts && process.stdin.isTTY && process.stdout.isTTY;
    this.c = colours(process.stdout.isTTY && process.env.NO_COLOR === undefined);
    process.on('SIGINT', () => {
      this.interrupt();
    });
  }

  print(text = ''): void {
    process.stdout.write(text + '\n');
  }

  heading(text: string): void {
    this.print('\n' + this.c.bold(text));
  }

  ok(text: string): void {
    this.print(this.c.green(text));
  }

  warn(text: string): void {
    this.print(this.c.yellow(text));
  }

  dim(text: string): void {
    this.print(this.c.grey(text));
  }

  async ask(question: string, fallback: string): Promise<string> {
    if (!this.interactive) return fallback;
    const answer = (await this.question(`${question} `)).trim();
    return answer === '' ? fallback : answer;
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    if (!this.interactive) return fallback;
    const hint = fallback ? '[Y/n]' : '[y/N]';
    for (;;) {
      const answer = (await this.question(`${question} ${hint} `)).trim().toLowerCase();
      if (answer === '') return fallback;
      if (answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
    }
  }

  async waitForEnter(prompt: string): Promise<EnterResult> {
    if (!this.interactive) return 'skip';
    for (;;) {
      const answer = (await this.question(this.c.bold(prompt) + ' ')).trim().toLowerCase();
      if (answer === '') return 'done';
      if (answer === 's' || answer === 'skip') return 'skip';
      if (answer === 'q' || answer === 'quit') return 'quit';
    }
  }

  onInterrupt(handler: () => void): void {
    this.interruptHandler = handler;
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }

  private interrupt(): void {
    if (this.interruptHandler) this.interruptHandler();
    else process.exit(130);
  }

  private question(text: string): Promise<string> {
    if (!this.rl) {
      this.rl = createInterface({ input: process.stdin, output: process.stdout });
      // readline swallows Ctrl+C while it owns the terminal.
      this.rl.on('SIGINT', () => {
        this.interrupt();
      });
    }
    const rl = this.rl;
    return new Promise((resolve) => {
      rl.question(text, resolve);
    });
  }
}

/** Test double: answers prompts from a queue and keeps the output. */
export class ScriptedIo implements Io {
  readonly interactive: boolean;
  readonly output: string[] = [];
  private readonly answers: string[];
  private interruptHandler: (() => void) | undefined;
  /** Called before each answer is returned (lets a test act like a person at TotalMix). */
  beforeAnswer: ((prompt: string) => Promise<void>) | undefined;

  constructor(answers: readonly string[] = [], interactive = true) {
    this.answers = [...answers];
    this.interactive = interactive;
  }

  print(text = ''): void {
    this.output.push(text);
  }

  heading(text: string): void {
    this.output.push(text);
  }

  ok(text: string): void {
    this.output.push(text);
  }

  warn(text: string): void {
    this.output.push(`WARN ${text}`);
  }

  dim(text: string): void {
    this.output.push(text);
  }

  async ask(question: string, fallback: string): Promise<string> {
    if (!this.interactive) return fallback;
    const a = (await this.next(question)).trim();
    return a === '' ? fallback : a;
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    if (!this.interactive) return fallback;
    const a = (await this.next(question)).trim().toLowerCase();
    return a === '' ? fallback : a.startsWith('y');
  }

  async waitForEnter(prompt: string): Promise<EnterResult> {
    if (!this.interactive) return 'skip';
    const a = (await this.next(prompt)).trim().toLowerCase();
    return a === '' ? 'done' : a.startsWith('s') ? 'skip' : 'quit';
  }

  onInterrupt(handler: () => void): void {
    this.interruptHandler = handler;
  }

  interrupt(): void {
    this.interruptHandler?.();
  }

  close(): void {
    // Nothing to release.
  }

  private async next(prompt: string): Promise<string> {
    this.output.push(`? ${prompt}`);
    if (this.beforeAnswer) await this.beforeAnswer(prompt);
    return this.answers.shift() ?? '';
  }
}
