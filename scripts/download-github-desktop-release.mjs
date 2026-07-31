import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  RELEASE_MANIFEST_FILE_NAME,
  sha256File,
  validateReleaseManifest
} from "./desktop-release-publisher.mjs";

const MAX_MANIFEST_SIZE = 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 4;
const DOWNLOAD_CONCURRENCY = 3;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function validateGithubRepository(value) {
  const repository = value?.trim();
  if (!repository || !REPOSITORY_PATTERN.test(repository) || repository.includes("..")) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format");
  }
  return repository;
}

export function githubReleaseAssetUrl(repository, tag, fileName) {
  const normalizedRepository = validateGithubRepository(repository);
  if (!/^v[0-9A-Za-z.+-]+$/u.test(tag)) throw new Error("Release tag is invalid");
  if (basename(fileName) !== fileName || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("Release asset file name is invalid");
  }
  return `https://github.com/${normalizedRepository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

export function assertManifestIdentity(manifest, { repository, tag, sha }) {
  if (manifest.repository !== repository) throw new Error("Release manifest repository does not match GITHUB_REPOSITORY");
  if (manifest.tag !== tag) throw new Error("Release manifest tag does not match RELEASE_TAG");
  if (manifest.commitSha !== sha.toLowerCase()) throw new Error("Release manifest commit does not match GITHUB_SHA");
}

export function releaseAssetDescriptors(manifest) {
  const descriptors = new Map();
  const add = descriptor => {
    const existing = descriptors.get(descriptor.fileName);
    if (existing) {
      if (
        existing.kind !== descriptor.kind
        || existing.fileSize !== descriptor.fileSize
        || existing.sha256 !== descriptor.sha256
        || existing.signature !== descriptor.signature
      ) {
        throw new Error(`Conflicting release asset metadata: ${descriptor.fileName}`);
      }
      return;
    }
    descriptors.set(descriptor.fileName, descriptor);
  };

  for (const platform of manifest.platforms) {
    add({
      kind: "binary",
      fileName: platform.installer.fileName,
      fileSize: platform.installer.fileSize,
      sha256: platform.installer.sha256
    });
    add({
      kind: "binary",
      fileName: platform.updater.fileName,
      fileSize: platform.updater.fileSize,
      sha256: platform.updater.sha256
    });
    add({
      kind: "signature",
      fileName: platform.updater.signatureFileName,
      updaterFileName: platform.updater.fileName,
      signature: platform.updater.signature
    });
  }
  return [...descriptors.values()];
}

function validatedReleaseAsset(value, repository, tag) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub release contains invalid asset metadata");
  }
  const name = typeof value.name === "string" ? value.name : "";
  if (!name || basename(name) !== name || name.includes("\\") || name.includes("..")) {
    throw new Error("GitHub release asset name is invalid");
  }
  if (!Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new Error(`GitHub release asset size is invalid: ${name}`);
  }
  const digest = typeof value.digest === "string" ? value.digest.toLowerCase() : "";
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`GitHub release asset digest is missing or invalid: ${name}`);
  }
  let downloadUrl;
  try {
    downloadUrl = new URL(value.browser_download_url);
  } catch {
    throw new Error(`GitHub release asset URL is invalid: ${name}`);
  }
  const expectedPathPrefix = `/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  if (
    downloadUrl.protocol !== "https:"
    || downloadUrl.hostname !== "github.com"
    || !downloadUrl.pathname.startsWith(expectedPathPrefix)
    || downloadUrl.search
    || downloadUrl.hash
  ) {
    throw new Error(`GitHub release asset URL is outside the expected release: ${name}`);
  }
  return { name, size: value.size, digest, downloadUrl: downloadUrl.toString() };
}

export function createReleaseDownloadPlan(manifest, release, repository, tag) {
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new Error("GitHub release metadata is invalid");
  }
  if (release.tag_name !== tag || release.draft === true) {
    throw new Error("GitHub release metadata does not match the requested published tag");
  }
  if (!Array.isArray(release.assets)) throw new Error("GitHub release assets are missing");
  const releaseAssets = release.assets.map(asset => validatedReleaseAsset(asset, repository, tag));
  const matchedBinaries = new Map();

  function binaryAsset(descriptor) {
    const matches = releaseAssets.filter(asset =>
      asset.size === descriptor.fileSize && asset.digest === `sha256:${descriptor.sha256}`
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one GitHub release asset matching ${descriptor.fileName}, found ${matches.length}`);
    }
    matchedBinaries.set(descriptor.fileName, matches[0]);
    return matches[0];
  }

  return releaseAssetDescriptors(manifest).map(descriptor => {
    if (descriptor.kind === "binary") {
      const asset = binaryAsset(descriptor);
      return { ...descriptor, releaseFileName: asset.name, downloadUrl: asset.downloadUrl };
    }
    const updaterAsset = matchedBinaries.get(descriptor.updaterFileName);
    if (!updaterAsset) throw new Error(`Missing matched updater asset for ${descriptor.fileName}`);
    const expectedSignatureName = `${updaterAsset.name}.sig`;
    const matches = releaseAssets.filter(asset => asset.name === expectedSignatureName);
    if (matches.length !== 1) {
      throw new Error(`Expected one GitHub updater signature ${expectedSignatureName}, found ${matches.length}`);
    }
    return {
      ...descriptor,
      releaseFileName: matches[0].name,
      downloadUrl: matches[0].downloadUrl
    };
  });
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(url, fetchImpl, attempts = DOWNLOAD_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.retryable = isRetryableStatus(response.status);
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || error?.retryable === false) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 1000));
    }
  }
  throw lastError;
}

async function fetchManifest(url, fetchImpl) {
  const response = await fetchWithRetry(url, fetchImpl);
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_SIZE) {
    throw new Error("GitHub release manifest is too large");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_MANIFEST_SIZE) throw new Error("GitHub release manifest is too large");
  return new TextDecoder().decode(body);
}

async function fetchReleaseMetadata(repository, tag, fetchImpl) {
  const url = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetchWithRetry(url, fetchImpl);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_MANIFEST_SIZE) throw new Error("GitHub release metadata is too large");
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("GitHub release metadata returned invalid JSON");
  }
}

async function downloadAsset(url, destination, descriptor, fetchImpl) {
  const partialPath = `${destination}.part-${process.pid}`;
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    await rm(partialPath, { force: true });
    try {
      const response = await fetchWithRetry(url, fetchImpl, 1);
      const contentLength = response.headers.get("content-length");
      const declaredLength = contentLength === null ? null : Number(contentLength);
      if (
        descriptor.kind === "binary"
        && declaredLength !== null
        && Number.isFinite(declaredLength)
        && declaredLength !== descriptor.fileSize
      ) {
        throw new Error(`Content-Length does not match the manifest for ${descriptor.fileName}`);
      }
      if (!response.body) throw new Error(`GitHub returned an empty body for ${descriptor.fileName}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath, { flags: "wx" }));

      if (descriptor.kind === "binary") {
        const fileStat = await stat(partialPath);
        if (fileStat.size !== descriptor.fileSize) throw new Error(`File size does not match for ${descriptor.fileName}`);
        if (await sha256File(partialPath) !== descriptor.sha256) {
          throw new Error(`SHA-256 does not match for ${descriptor.fileName}`);
        }
      } else if ((await readFile(partialPath, "utf8")).trim() !== descriptor.signature) {
        throw new Error(`Updater signature does not match for ${descriptor.fileName}`);
      }

      await rename(partialPath, destination);
      return;
    } catch (error) {
      lastError = error;
      await rm(partialPath, { force: true });
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  let firstError;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!firstError && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        await worker(items[index]);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

export async function downloadGithubDesktopRelease({
  repository,
  tag,
  sha,
  outputDirectory,
  fetchImpl = fetch
}) {
  const sourceRepository = validateGithubRepository(repository);
  if (!/^v[0-9A-Za-z.+-]+$/u.test(tag)) throw new Error("RELEASE_TAG is invalid");
  if (!/^[0-9a-f]{40}$/iu.test(sha)) throw new Error("GITHUB_SHA must be a full commit SHA");
  const destinationDirectory = resolve(outputDirectory);
  await mkdir(destinationDirectory, { recursive: true });

  const manifestUrl = githubReleaseAssetUrl(sourceRepository, tag, RELEASE_MANIFEST_FILE_NAME);
  const rawManifest = await fetchManifest(manifestUrl, fetchImpl);
  const manifest = validateReleaseManifest(JSON.parse(rawManifest));
  assertManifestIdentity(manifest, { repository: sourceRepository, tag, sha });

  const manifestPath = join(destinationDirectory, RELEASE_MANIFEST_FILE_NAME);
  const partialManifestPath = `${manifestPath}.part-${process.pid}`;
  await writeFile(partialManifestPath, rawManifest, { encoding: "utf8", flag: "wx" });
  await rename(partialManifestPath, manifestPath);

  const release = await fetchReleaseMetadata(sourceRepository, tag, fetchImpl);
  const descriptors = createReleaseDownloadPlan(manifest, release, sourceRepository, tag);
  await mapWithConcurrency(descriptors, DOWNLOAD_CONCURRENCY, async descriptor => {
    await downloadAsset(
      descriptor.downloadUrl,
      join(destinationDirectory, descriptor.fileName),
      descriptor,
      fetchImpl
    );
    const renamed = descriptor.releaseFileName === descriptor.fileName
      ? descriptor.fileName
      : `${descriptor.releaseFileName} -> ${descriptor.fileName}`;
    console.log(`Downloaded and verified ${renamed}`);
  });
  return { manifest, assets: descriptors };
}

export async function main() {
  const result = await downloadGithubDesktopRelease({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    tag: requiredEnvironment("RELEASE_TAG"),
    sha: requiredEnvironment("GITHUB_SHA"),
    outputDirectory: process.env.RELEASE_ARTIFACTS_DIR?.trim() || "release-artifacts"
  });
  console.log(`Verified GitHub Release ${result.manifest.tag} at ${result.manifest.commitSha}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
