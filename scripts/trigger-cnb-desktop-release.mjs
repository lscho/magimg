import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const RELEASE_EVENT = "api_trigger_desktop_release";
const RELEASE_MANIFEST_PATH = "release-manifest-final/huanhua-desktop-release-manifest.json";
const SEMVER_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const TERMINAL_STATUSES = new Set(["success", "error", "cancel"]);

function requiredString(value, label) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required environment variable: ${label}`);
  return normalized;
}

export function validateRepository(value, label = "repository") {
  const repository = requiredString(value, label);
  if (!REPOSITORY_PATTERN.test(repository) || repository.includes("..")) {
    throw new Error(`${label} must use the owner/repository format`);
  }
  return repository;
}

export function validateReleaseTag(value) {
  const tag = requiredString(value, "RELEASE_TAG");
  if (!SEMVER_TAG_PATTERN.test(tag)) throw new Error("RELEASE_TAG must be a v-prefixed SemVer tag");
  return tag;
}

export function validateCommitSha(value) {
  const sha = requiredString(value, "RELEASE_SHA").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error("RELEASE_SHA must be a full 40-character commit SHA");
  return sha;
}

export function createStartBuildRequest({ tag, sha, githubRepository }) {
  const releaseTag = validateReleaseTag(tag);
  const releaseSha = validateCommitSha(sha);
  const sourceRepository = validateRepository(githubRepository, "GITHUB_RELEASE_REPOSITORY");
  return {
    event: RELEASE_EVENT,
    tag: releaseTag,
    sha: releaseSha,
    title: `Publish desktop release ${releaseTag}`,
    sync: "false",
    env: {
      GITHUB_REPOSITORY: sourceRepository,
      GITHUB_SHA: releaseSha,
      RELEASE_TAG: releaseTag,
      RELEASE_ARTIFACTS_DIR: "release-artifacts",
      FINAL_RELEASE_MANIFEST_PATH: RELEASE_MANIFEST_PATH
    }
  };
}

function repositoryApiPath(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

async function readJsonResponse(response, label) {
  const rawBody = await response.text();
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(`${label} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${body.message || rawBody.slice(0, 500)}`);
  }
  return body?.data && typeof body.data === "object" ? body.data : body;
}

export async function triggerCnbBuild({
  token,
  cnbRepository,
  request,
  fetchImpl = fetch,
  apiBaseUrl = "https://api.cnb.cool"
}) {
  const repository = validateRepository(cnbRepository, "CNB_REPOSITORY");
  const response = await fetchImpl(`${apiBaseUrl}/${repositoryApiPath(repository)}/-/build/start`, {
    method: "POST",
    headers: {
      accept: "application/vnd.cnb.api+json",
      authorization: `Bearer ${requiredString(token, "CNB_TRIGGER_TOKEN")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000)
  });
  const result = await readJsonResponse(response, "CNB StartBuild");
  if (!result.success || typeof result.sn !== "string" || !result.sn.trim()) {
    throw new Error(`CNB rejected the build trigger: ${result.message || "missing build number"}`);
  }
  return result;
}

export async function waitForCnbBuild({
  token,
  cnbRepository,
  sn,
  fetchImpl = fetch,
  apiBaseUrl = "https://api.cnb.cool",
  pollIntervalMs = 15_000,
  timeoutMs = 50 * 60_000,
  sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)),
  onStatus = () => {}
}) {
  const repository = validateRepository(cnbRepository, "CNB_REPOSITORY");
  const buildNumber = requiredString(sn, "CNB build number");
  const accessToken = requiredString(token, "CNB_TRIGGER_TOKEN");
  const deadline = Date.now() + timeoutMs;
  let previousStatus;

  while (Date.now() < deadline) {
    const response = await fetchImpl(
      `${apiBaseUrl}/${repositoryApiPath(repository)}/-/build/status/${encodeURIComponent(buildNumber)}`,
      {
        headers: {
          accept: "application/vnd.cnb.api+json",
          authorization: `Bearer ${accessToken}`
        },
        signal: AbortSignal.timeout(30_000)
      }
    );
    const result = await readJsonResponse(response, "CNB GetBuildStatus");
    const status = typeof result.status === "string" ? result.status.toLowerCase() : "unknown";
    if (status !== previousStatus) {
      onStatus(status, result);
      previousStatus = status;
    }
    if (TERMINAL_STATUSES.has(status)) {
      if (status !== "success") throw new Error(`CNB release publishing finished with status: ${status}`);
      return result;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for CNB build ${buildNumber}`);
}

export async function main() {
  const token = requiredString(process.env.CNB_TRIGGER_TOKEN, "CNB_TRIGGER_TOKEN");
  const cnbRepository = validateRepository(process.env.CNB_REPOSITORY, "CNB_REPOSITORY");
  const request = createStartBuildRequest({
    tag: process.env.RELEASE_TAG,
    sha: process.env.RELEASE_SHA,
    githubRepository: process.env.GITHUB_RELEASE_REPOSITORY
  });
  const build = await triggerCnbBuild({ token, cnbRepository, request });
  console.log(`CNB accepted build ${build.sn}: ${build.buildLogUrl || "build URL unavailable"}`);
  await waitForCnbBuild({
    token,
    cnbRepository,
    sn: build.sn,
    onStatus: status => console.log(`CNB build ${build.sn} status: ${status}`)
  });
  console.log(`CNB release publishing completed: ${build.buildLogUrl || build.sn}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
