import { startDaemon, stopDaemon, daemonStatus } from "../ollama/manager.js";
import { fmt } from "./format.js";

export async function daemonStart(): Promise<void> {
  const before = await daemonStatus();
  if (before.running && before.reachable) {
    console.log(fmt.ok(`Daemon already running (pid ${before.pid}, port ${before.port})`));
    return;
  }
  const after = await startDaemon();
  if (after.reachable) {
    console.log(fmt.ok(`Daemon started (pid ${after.pid}, port ${after.port})`));
  } else {
    console.log(fmt.err(`Daemon did not become reachable on port ${after.port}`));
    process.exitCode = 1;
  }
}

export async function daemonStop(): Promise<void> {
  await stopDaemon();
  console.log(fmt.ok("Daemon stopped"));
}

export async function daemonStatusCmd(): Promise<void> {
  const s = await daemonStatus();
  const lines = [
    `Running:        ${s.running ? "yes" : "no"}`,
    `PID:            ${s.pid ?? "—"}`,
    `Port:           ${s.port}`,
    `Reachable:      ${s.reachable ? "yes" : "no"}`,
    `Managed by user: ${s.managedByUser ? "yes" : "no (cctx-managed)"}`,
  ];
  console.log(lines.join("\n"));
}

export async function daemonRestart(): Promise<void> {
  await stopDaemon();
  await startDaemon();
  const s = await daemonStatus();
  if (s.reachable) {
    console.log(fmt.ok(`Daemon restarted (pid ${s.pid}, port ${s.port})`));
  } else {
    console.log(fmt.err("Daemon did not come back up cleanly"));
    process.exitCode = 1;
  }
}
