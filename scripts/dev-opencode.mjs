import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

const serverUrl = new URL(process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4098");
if (serverUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname)) {
  throw new Error("The OpenCode development server must use a local HTTP address.");
}
const port = Number(process.env.PORT || 3000);
const appUrl = `http://127.0.0.1:${port}`;
const children = [];
const nextEnv = {
  ...process.env,
  CHALK_SOLVER: "opencode",
  OPENCODE_SERVER_URL: serverUrl.origin,
  OPENCODE_PROVIDER_ID: process.env.OPENCODE_PROVIDER_ID || "opencode-go",
  OPENCODE_MODEL: process.env.OPENCODE_MODEL || "deepseek-v4-flash",
  OPENCODE_VISION_MODEL: process.env.OPENCODE_VISION_MODEL || "kimi-k2.6",
};
async function health() {
  try {
    const response = await fetch(`${serverUrl.origin}/global/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).healthy === true;
  } catch { return false; }
}
async function appListening() {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}
function launch(command, args, env) {
  const child = spawn(command, args, { env, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.on("error", error => { console.error(error.message); shutdown(1); });
  return child;
}
function shutdown(code = 0) {
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

if (!(await health())) {
  const command = process.platform === "win32"
    ? join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
    : "opencode";
  if (process.platform === "win32" && !existsSync(command)) {
    throw new Error("OpenCode is not installed at the standard npm location. Install or start OpenCode serve on port 4098 first.");
  }
  const serverEnv = { ...process.env };
  for (const name of Object.keys(serverEnv)) {
    if (/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(name)) delete serverEnv[name];
  }
  const server = launch(command, ["--pure", "serve", "--hostname", "127.0.0.1", "--port", serverUrl.port || "4098"], serverEnv);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await health()) break;
    if (server.exitCode !== null) throw new Error("OpenCode stopped before becoming ready.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!(await health())) throw new Error("OpenCode did not start within 30 seconds.");
}
console.log(`OpenCode is ready at ${serverUrl.origin}. Using ${nextEnv.OPENCODE_PROVIDER_ID}/${nextEnv.OPENCODE_MODEL}.`);
if (await appListening()) {
    console.log(`A development server already listens at ${appUrl}; reusing it.`);
    if (children.length) console.log("Keep this terminal open for the local model server.");
    else process.exit(0);
} else {
  const next = launch(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], nextEnv);
  next.on("exit", code => shutdown(code || 0));
  console.log(`Starting Chalk at ${appUrl}.`);
}
