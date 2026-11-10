// Files the page hands to the browser (a download) or gets from it (a file picked to import).

/** Offers `data` as a JSON file to save. */
export function download(name: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Asks for a JSON file and reads it; undefined when none was picked. Call it from a click: the
 * browser shows a file picker only for one.
 */
export function readJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(undefined);
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(undefined);
        return;
      }
      file.text().then(
        (text) => {
          try {
            resolve(JSON.parse(text) as unknown);
          } catch {
            reject(new Error(`${file.name} is not a JSON file`));
          }
        },
        (e: unknown) => {
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
    input.click();
  });
}
