// Logging without a dependency on where logs go: the plugin passes the Stream Deck SDK's logger
// (which writes the plugin's logs/ folder), tests and tools pass their own or none.

export interface Logger {
  error(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  debug(message: string, ...details: unknown[]): void;
}

const ignore = (): void => undefined;

export const SILENT: Logger = { error: ignore, warn: ignore, info: ignore, debug: ignore };
