import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";

function appDataDirectory() {
  if (platform() === "darwin") {
    return join(homedir(), "Library/Application Support/ai.magimg.desktop");
  }
  if (platform() === "win32") {
    const appDataRoot = process.env.APPDATA?.trim();
    if (!appDataRoot) throw new Error("Windows APPDATA 目录不可用。");
    return join(appDataRoot, "ai.magimg.desktop");
  }
  const dataRoot = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local/share");
  return join(dataRoot, "ai.magimg.desktop");
}

const APP_DATA = appDataDirectory();
const STORE_PATH = join(APP_DATA, "auto-layer-selections.json");
const cloud = process.argv.includes("--cloud");
const cloudTaskArgument = process.argv.find(argument => argument.startsWith("--cloud-task="));
const cloudTaskId = cloudTaskArgument?.slice("--cloud-task=".length).trim() || undefined;
const forceCloudInput = cloud || process.argv.includes("--cloud-input");
const skipQualityGate = process.argv.includes("--skip-quality-gate");
const caseArgument = process.argv.find(argument => argument.startsWith("--case="));
const casePath = resolve(caseArgument?.slice("--case=".length) || "tests/auto-layer.case.json");
const qualityCase = JSON.parse(await readFile(casePath, "utf8"));
const recordArgument = process.argv.find(argument => argument.startsWith("--record="));
const recordId = recordArgument?.slice("--record=".length) || qualityCase.recordId || await defaultRecordId();
const runId = randomUUID();
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const outputDirectory = resolve(
  "tests/output/auto-layer",
  `run-${timestamp}${cloud ? "-cloud" : forceCloudInput ? "-cloud-input" : "-local"}`
);
await mkdir(outputDirectory, { recursive: true });

async function defaultRecordId() {
  const store = JSON.parse(await readFile(STORE_PATH, "utf8"));
  const records = Array.isArray(store.items) ? store.items : [];
  if (!records.length) throw new Error(`没有找到自动分层选区记录：${STORE_PATH}`);
  return records[0].id;
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "PUT, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extra
  };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function resolveOutput(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = resolve(outputDirectory, normalized);
  if (target !== outputDirectory && !target.startsWith(`${outputDirectory}${sep}`)) {
    throw new Error("回归产物路径越界。");
  }
  return target;
}

let completed = false;
let completionResolve;
const completion = new Promise(resolveCompletion => { completionResolve = resolveCompletion; });
const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "PUT" && url.pathname.startsWith("/files/")) {
      const relativePath = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = resolveOutput(relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await requestBody(request));
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (request.method === "POST" && (url.pathname === "/complete" || url.pathname === "/error")) {
      const body = await requestBody(request);
      const filename = url.pathname === "/complete" ? "complete.json" : "error.json";
      await writeFile(join(outputDirectory, filename), body);
      completed = url.pathname === "/complete";
      completionResolve();
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/status") {
      const status = JSON.parse((await requestBody(request)).toString("utf8"));
      const message = status.message ?? "运行中";
      console.log(`[自动分层回归] ${message}`);
      await appendFile(
        join(outputDirectory, "status.log"),
        `${new Date().toISOString()} ${message}\n`,
        "utf8"
      );
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    response.writeHead(404, corsHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, corsHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end(error instanceof Error ? error.message : String(error));
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("无法启动自动分层产物收集器。");
const collectorUrl = `http://127.0.0.1:${address.port}`;
const vitePort = await availablePort();

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const probeAddress = probe.address();
  if (!probeAddress || typeof probeAddress === "string") throw new Error("无法分配自动分层测试端口。");
  await new Promise(resolveClose => probe.close(resolveClose));
  return probeAddress.port;
}

console.log(`自动分层回归记录：${recordId}`);
console.log(`质量用例：${casePath}`);
console.log(`运行 ID：${runId}`);
console.log(`产物目录：${outputDirectory}`);
console.log(cloud
  ? cloudTaskId
    ? `模式：本地推理 + 复用云端任务 ${cloudTaskId}（不重复扣积分）`
    : "模式：本地推理 + 一次云端修复（20 积分）"
  : forceCloudInput
    ? "模式：生成真实云端输入，不提交任务、不扣积分"
    : "模式：仅本地推理，不扣积分");
if (skipQualityGate) console.log("质量门禁：仅记录报告，不阻断本次调试运行");

const tauriConfig = JSON.stringify({
  build: {
    beforeDevCommand: `npm run dev -- --port ${vitePort} --strictPort`,
    devUrl: `http://localhost:${vitePort}`
  }
});
const child = spawn("npm", [
  "run", "tauri", "--", "dev", "--no-watch", "--config", tauriConfig
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_AUTO_LAYER_REGRESSION_URL: collectorUrl,
    VITE_AUTO_LAYER_REGRESSION_RECORD_ID: recordId,
    VITE_AUTO_LAYER_REGRESSION_CLOUD: String(cloud),
    VITE_AUTO_LAYER_REGRESSION_CLOUD_TASK_ID: cloudTaskId ?? "",
    VITE_AUTO_LAYER_REGRESSION_FORCE_CLOUD_INPUT: String(forceCloudInput),
    VITE_AUTO_LAYER_REGRESSION_SKIP_QUALITY_GATE: String(skipQualityGate),
    VITE_AUTO_LAYER_REGRESSION_RUN_ID: runId,
    VITE_AUTO_LAYER_REGRESSION_CASE: JSON.stringify(qualityCase)
  },
  stdio: "inherit"
});

let timedOut = false;
let childExitCode = null;
child.once("exit", code => {
  childExitCode = code;
  if (!completed) completionResolve();
});
const timeout = setTimeout(() => {
  timedOut = true;
  completionResolve();
}, 30 * 60 * 1000);
await completion;
clearTimeout(timeout);
await new Promise(resolveExit => {
  if (child.exitCode !== null) return resolveExit();
  const force = setTimeout(() => child.kill("SIGTERM"), 5000);
  child.once("exit", () => {
    clearTimeout(force);
    resolveExit();
  });
});
await new Promise(resolveClose => server.close(resolveClose));

if (!completed) {
  const errorPath = join(outputDirectory, "error.json");
  let detail = "自动分层回归未完成。";
  try {
    detail = JSON.parse(await readFile(errorPath, "utf8")).message || detail;
  } catch {}
  if (timedOut) detail = `${detail}（30 分钟超时）`;
  else if (childExitCode !== null) detail = `${detail}（Tauri 退出码 ${childExitCode}）`;
  throw new Error(detail);
}

console.log(`自动分层回归完成：${outputDirectory}`);
