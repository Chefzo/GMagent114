// Tiny structured logger. Keeps job output readable in the terminal and in
// GitHub Actions logs without pulling in a logging dependency.

type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"];

function emit(level: Level, msg: string, extra?: unknown): void {
  if (order[level] < threshold) return;
  const stamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  if (extra !== undefined) {
    console.log(`${stamp} ${tag} ${msg}`, extra);
  } else {
    console.log(`${stamp} ${tag} ${msg}`);
  }
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
