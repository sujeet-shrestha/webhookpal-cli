// Wraps console.{log,error,warn,info,debug} so every line is prefixed with a
// local timestamp like "[2026-07-19 14:03:22.481] ". Call installTimestampedConsole()
// once at process startup.

import pc from "picocolors";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function localTimestamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

let installed = false;

export function installTimestampedConsole(): void {
  if (installed) return;
  installed = true;

  const wrap =
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      fn(pc.dim(`[${localTimestamp()}]`), ...args);
    };

  // eslint-disable-next-line no-console
  console.log = wrap(console.log.bind(console));
  // eslint-disable-next-line no-console
  console.error = wrap(console.error.bind(console));
  // eslint-disable-next-line no-console
  console.warn = wrap(console.warn.bind(console));
  // eslint-disable-next-line no-console
  console.info = wrap(console.info.bind(console));
  // eslint-disable-next-line no-console
  console.debug = wrap(console.debug.bind(console));
}
