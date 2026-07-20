import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export const RELEASE_MANIFEST_FILE_NAME = "huanhua-desktop-release-manifest.json";
export const RELEASE_PLATFORMS = [
  "windows-x86",
  "windows-arm",
  "macos-x86",
  "macos-arm"
];

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_FILE_SIZE = 0xffffffff;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label, maxLength = 20000) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function requireFileMetadata(value, label, expectedSuffix) {
  const raw = requireObject(value, label);
  const fileName = requireString(raw.fileName, `${label}.fileName`, 255);
  if (
    basename(fileName) !== fileName
    || fileName.includes("\\")
    || fileName.includes("..")
    || !fileName.toLowerCase().endsWith(expectedSuffix)
  ) {
    throw new Error(`${label}.fileName is invalid`);
  }
  if (!Number.isSafeInteger(raw.fileSize) || raw.fileSize <= 0 || raw.fileSize > MAX_FILE_SIZE) {
    throw new Error(`${label}.fileSize is invalid`);
  }
  const sha256 = requireString(raw.sha256, `${label}.sha256`, 64).toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`${label}.sha256 is invalid`);
  return {
    ...raw,
    fileName,
    fileSize: raw.fileSize,
    sha256
  };
}

export function validateReleaseManifest(value) {
  const raw = requireObject(value, "manifest");
  if (raw.schemaVersion !== 1) throw new Error("Unsupported release manifest schema");

  const version = requireString(raw.version, "manifest.version", 50);
  if (!SEMVER_PATTERN.test(version)) throw new Error("manifest.version is invalid");
  const tag = requireString(raw.tag, "manifest.tag", 51);
  if (tag !== `v${version}`) throw new Error("manifest.tag does not match manifest.version");
  const repository = requireString(raw.repository, "manifest.repository", 200);
  const commitSha = requireString(raw.commitSha, "manifest.commitSha", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(commitSha)) throw new Error("manifest.commitSha is invalid");
  if (!Array.isArray(raw.platforms) || raw.platforms.length !== RELEASE_PLATFORMS.length) {
    throw new Error("manifest must contain exactly four platforms");
  }

  const seen = new Set();
  const platforms = raw.platforms.map((value, index) => {
    const platform = requireObject(value, `manifest.platforms[${index}]`);
    const name = requireString(platform.platform, `manifest.platforms[${index}].platform`, 20);
    if (!RELEASE_PLATFORMS.includes(name) || seen.has(name)) {
      throw new Error(`Duplicate or unsupported release platform: ${name}`);
    }
    seen.add(name);
    const installerSuffix = name.startsWith("windows-") ? ".exe" : ".dmg";
    const updaterSuffix = name.startsWith("windows-") ? ".exe" : ".app.tar.gz";
    const installer = requireFileMetadata(platform.installer, `${name}.installer`, installerSuffix);
    const updater = requireFileMetadata(platform.updater, `${name}.updater`, updaterSuffix);
    const signatureFileName = requireString(
      platform.updater.signatureFileName,
      `${name}.updater.signatureFileName`,
      259
    );
    if (signatureFileName !== `${updater.fileName}.sig`) {
      throw new Error(`${name}.updater.signatureFileName does not match the updater`);
    }
    const signature = requireString(platform.updater.signature, `${name}.updater.signature`);
    return {
      ...platform,
      platform: name,
      installer,
      updater: {
        ...updater,
        signatureFileName,
        signature
      }
    };
  });

  for (const platform of RELEASE_PLATFORMS) {
    if (!seen.has(platform)) throw new Error(`Missing release platform: ${platform}`);
  }

  return {
    ...raw,
    version,
    tag,
    repository,
    commitSha,
    platforms
  };
}

export async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function indexFilesByName(files) {
  const index = new Map();
  for (const path of files) {
    const name = basename(path);
    if (index.has(name)) throw new Error(`Duplicate artifact file name: ${name}`);
    index.set(name, path);
  }
  return index;
}

async function localAsset(fileIndex, metadata, label) {
  const path = fileIndex.get(metadata.fileName);
  if (!path) throw new Error(`Missing ${label}: ${metadata.fileName}`);
  const fileStat = await stat(path);
  if (fileStat.size !== metadata.fileSize) throw new Error(`${label} size does not match the manifest`);
  const sha256 = await sha256File(path);
  if (sha256 !== metadata.sha256) throw new Error(`${label} SHA-256 does not match the manifest`);
  return { path, fileName: metadata.fileName, fileSize: fileStat.size, sha256 };
}

export async function collectReleaseAssets(manifest, artifactsDirectory) {
  const files = await findFiles(artifactsDirectory);
  const fileIndex = indexFilesByName(
    files.filter(path => basename(path) !== RELEASE_MANIFEST_FILE_NAME)
  );
  const assets = new Map();

  function addAsset(asset) {
    const existing = assets.get(asset.fileName);
    if (existing) {
      if (existing.fileSize !== asset.fileSize || existing.sha256 !== asset.sha256) {
        throw new Error(`Conflicting metadata for artifact: ${asset.fileName}`);
      }
      return;
    }
    assets.set(asset.fileName, asset);
  }

  const signatureMetadata = new Map();
  for (const platform of manifest.platforms) {
    addAsset(await localAsset(fileIndex, platform.installer, `${platform.platform} installer`));
    addAsset(await localAsset(fileIndex, platform.updater, `${platform.platform} updater`));

    const signaturePath = fileIndex.get(platform.updater.signatureFileName);
    if (!signaturePath) throw new Error(`Missing updater signature: ${platform.updater.signatureFileName}`);
    const signatureText = (await readFile(signaturePath, "utf8")).trim();
    if (signatureText !== platform.updater.signature) {
      throw new Error(`${platform.platform} updater signature does not match the manifest`);
    }
    const signatureStat = await stat(signaturePath);
    const signatureAsset = {
      path: signaturePath,
      fileName: platform.updater.signatureFileName,
      fileSize: signatureStat.size,
      sha256: await sha256File(signaturePath)
    };
    addAsset(signatureAsset);
    signatureMetadata.set(platform.platform, signatureAsset);
  }

  return { assets: [...assets.values()], signatureMetadata };
}

function normalizeHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(requireString(value, label, 1000));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment`);
  }
  return url;
}

export function releaseObjectKey(tag, fileName) {
  if (!/^v[0-9A-Za-z.+-]+$/u.test(tag)) throw new Error("Release tag is invalid");
  if (basename(fileName) !== fileName || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("Artifact file name is invalid");
  }
  return `desktop/releases/${tag}/${fileName}`;
}

export function releaseAssetUrl(cdnBaseUrl, tag, fileName) {
  const url = normalizeHttpsUrl(cdnBaseUrl, "DESKTOP_RELEASE_CDN_BASE_URL");
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}/${releaseObjectKey(tag, fileName)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  return url.toString();
}

export function rewriteManifestForCdn(manifest, cdnBaseUrl, signatureMetadata) {
  return {
    ...manifest,
    platforms: manifest.platforms.map(platform => {
      const signature = signatureMetadata.get(platform.platform);
      if (!signature) throw new Error(`Missing signature metadata for ${platform.platform}`);
      return {
        ...platform,
        installer: {
          ...platform.installer,
          sourceUrl: releaseAssetUrl(cdnBaseUrl, manifest.tag, platform.installer.fileName)
        },
        updater: {
          ...platform.updater,
          sourceUrl: releaseAssetUrl(cdnBaseUrl, manifest.tag, platform.updater.fileName),
          signatureSourceUrl: releaseAssetUrl(cdnBaseUrl, manifest.tag, signature.fileName),
          signatureFileSize: signature.fileSize,
          signatureSha256: signature.sha256
        }
      };
    })
  };
}

function contentType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".sig")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".app.tar.gz")) return "application/gzip";
  if (lower.endsWith(".dmg")) return "application/x-apple-diskimage";
  return "application/octet-stream";
}

function callCos(client, method, params) {
  return new Promise((resolvePromise, rejectPromise) => {
    client[method](params, (error, data) => {
      if (error) rejectPromise(error);
      else resolvePromise(data);
    });
  });
}

function responseHeaders(value) {
  const headers = value?.headers && typeof value.headers === "object" ? value.headers : {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, headerValue]) => [key.toLowerCase(), String(headerValue)])
  );
}

function assertStoredMetadata(headers, asset, label) {
  const length = Number(headers["content-length"]);
  const sha256 = headers["x-cos-meta-sha256"]?.toLowerCase();
  if (length !== asset.fileSize || sha256 !== asset.sha256) {
    throw new Error(`${label} already exists with different or incomplete metadata`);
  }
}

function isMissingObject(error) {
  return error?.statusCode === 404 || error?.code === "NoSuchKey" || error?.code === "NoSuchResource";
}

function isObjectConflict(error) {
  return error?.statusCode === 409
    || error?.statusCode === 412
    || error?.code === "ObjectExists"
    || error?.code === "PreconditionFailed";
}

export async function uploadImmutableCosAsset(client, config, asset) {
  const key = releaseObjectKey(config.tag, asset.fileName);
  const baseParams = {
    Bucket: config.bucket,
    Region: config.region,
    Key: key
  };
  try {
    const existing = await callCos(client, "headObject", baseParams);
    assertStoredMetadata(responseHeaders(existing), asset, asset.fileName);
    return { key, uploaded: false };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
  }

  try {
    await callCos(client, "putObject", {
      ...baseParams,
      Body: createReadStream(asset.path),
      ContentLength: asset.fileSize,
      ContentType: contentType(asset.fileName),
      CacheControl: "public, max-age=31536000, immutable",
      Headers: {
        "x-cos-forbid-overwrite": "true",
        "x-cos-meta-sha256": asset.sha256
      }
    });
  } catch (error) {
    if (!isObjectConflict(error)) throw error;
    const concurrent = await callCos(client, "headObject", baseParams);
    assertStoredMetadata(responseHeaders(concurrent), asset, asset.fileName);
    return { key, uploaded: false };
  }
  const uploaded = await callCos(client, "headObject", baseParams);
  assertStoredMetadata(responseHeaders(uploaded), asset, asset.fileName);
  return { key, uploaded: true };
}

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

export async function verifyCdnAsset(url, asset, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) !== asset.fileSize) {
        throw new Error("Content-Length mismatch");
      }
      if (response.headers.get("x-cos-meta-sha256")?.toLowerCase() !== asset.sha256) {
        throw new Error("x-cos-meta-sha256 mismatch");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }
  throw new Error(`CDN validation failed for ${url}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

export function createReleaseWebhookSignature(rawBody, timestamp, secret) {
  if (!/^\d{10}$/u.test(timestamp)) throw new Error("Release timestamp is invalid");
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("DESKTOP_RELEASE_WEBHOOK_SECRET must contain at least 32 characters");
  }
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  return `v1=${createHmac("sha256", secret).update(`${timestamp}\n${bodySha256}`).digest("hex")}`;
}

export async function notifyDesktopRelease(apiUrl, rawBody, secret) {
  const url = normalizeHttpsUrl(apiUrl, "DESKTOP_RELEASE_API_URL");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-release-timestamp": timestamp,
      "x-release-signature": createReleaseWebhookSignature(rawBody, timestamp, secret)
    },
    body: rawBody,
    signal: AbortSignal.timeout(30_000)
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Desktop release API returned HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
  }
  return responseBody ? JSON.parse(responseBody) : null;
}

export async function writeFinalManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  const rawBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path, rawBody, "utf8");
  const fileStat = await stat(path);
  return {
    rawBody,
    asset: {
      path,
      fileName: RELEASE_MANIFEST_FILE_NAME,
      fileSize: fileStat.size,
      sha256: await sha256File(path)
    }
  };
}

export async function loadReleaseManifest(artifactsDirectory) {
  const files = await findFiles(resolve(artifactsDirectory));
  const manifests = files.filter(path => basename(path) === RELEASE_MANIFEST_FILE_NAME);
  if (manifests.length !== 1) {
    throw new Error(`Expected exactly one release manifest, found ${manifests.length}`);
  }
  return validateReleaseManifest(JSON.parse(await readFile(manifests[0], "utf8")));
}
