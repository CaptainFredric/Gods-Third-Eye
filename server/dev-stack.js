import { spawn } from "node:child_process";

const DRY_RUN = process.env.DRY_RUN_STACK === "1";
const children = [];

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function startProcess(label, args, extraEnv = {}) {
  const command = getNpmCommand();
  if (DRY_RUN) {
    console.log(`[stack:dry-run] ${label}: ${command} ${args.join(" ")}`);
    return null;
  }

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["inherit", "pipe", "pipe"]
  });

  const prefix = `[${label}] `;
  child.stdout.on("data", chunk => process.stdout.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`).replace(`${prefix}$`, "")));
  child.stderr.on("data", chunk => process.stderr.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`).replace(`${prefix}$`, "")));
  child.on("exit", code => {
    if (code && code !== 0) {
      console.error(`${prefix}exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  while (children.length) {
    const child = children.pop();
    if (child && !child.killed) child.kill("SIGTERM");
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

startProcess("relay", ["run", "relay"]);
startProcess("dev", ["run", "dev", "--", "--host", "127.0.0.1"]);

if (DRY_RUN) {
  process.exit(0);
}