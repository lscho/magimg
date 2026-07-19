import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const PLATFORM_ARTIFACTS = [
  {
    platform: "windows-x86",
    artifactDirectory: "huanhua-windows-x64",
    installerSuffix: ".exe",
    updaterSuffix: ".nsis.zip"
  },
  {
    platform: "windows-arm",
    artifactDirectory: "huanhua-windows-arm64",
    installerSuffix: ".exe",
    updaterSuffix: ".nsis.zip"
  },
  {
    platform: "macos-x86",
    artifactDirectory: "huanhua-macos-x64",
    installerSuffix: ".dmg",
    updaterSuffix: ".app.tar.gz"
  },
  {
    platform: "macos-arm",
    artifactDirectory: "huanhua-macos-arm64",
    installerSuffix: ".dmg",
    updaterSuffix: ".app.tar.gz"
  }
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeVersion(value) {
  const version = value.replace(/^v/u, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Invalid semantic version: ${value}`);
  }
  return version;
}

function filesUnder(directory) {
  if (!existsSync(directory)) throw new Error(`Missing artifact directory: ${directory}`);

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function exactlyOne(files, predicate, description) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${description}, found ${matches.length}: ${matches.map(basename).join(", ")}`);
  }
  return matches[0];
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function assetUrl(baseUrl, fileName) {
  return baseUrl ? `${baseUrl.replace(/\/$/u, "")}/${encodeURIComponent(fileName)}` : null;
}

async function fileMetadata(path, sourceAssetBaseUrl) {
  const fileName = basename(path);
  return {
    fileName,
    fileSize: statSync(path).size,
    sha256: await sha256(path),
    sourceUrl: assetUrl(sourceAssetBaseUrl, fileName)
  };
}

const version = normalizeVersion(requiredEnvironment("RELEASE_VERSION"));
const releaseTag = process.env.RELEASE_TAG?.trim();
const tag = releaseTag ? `v${releaseTag.replace(/^v/u, "")}` : `v${version}`;
if (normalizeVersion(tag) !== version) throw new Error(`Release tag ${tag} does not match version ${version}`);
const artifactsDirectory = resolve(process.env.RELEASE_ARTIFACTS_DIR?.trim() || "release-artifacts");
const outputPath = resolve(
  process.env.RELEASE_MANIFEST_PATH?.trim() || join(artifactsDirectory, "huanhua-desktop-release-manifest.json")
);
const repository = process.env.GITHUB_REPOSITORY?.trim() || null;
const commitSha = process.env.GITHUB_SHA?.trim() || null;
const githubServerUrl = process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
const publishGitHubRelease = process.env.PUBLISH_GITHUB_RELEASE === "true";
const sourceAssetBaseUrl =
  publishGitHubRelease && repository
    ? `${githubServerUrl.replace(/\/$/u, "")}/${repository}/releases/download/${encodeURIComponent(tag)}`
    : null;
const usedAssetNames = new Set();

const platforms = [];
for (const definition of PLATFORM_ARTIFACTS) {
  const directory = join(artifactsDirectory, definition.artifactDirectory);
  const files = filesUnder(directory);
  const updaterPath = exactlyOne(
    files,
    (path) => basename(path).endsWith(definition.updaterSuffix),
    `${definition.platform} updater package (${definition.updaterSuffix})`
  );
  const updaterFileName = basename(updaterPath);
  const installerPath = exactlyOne(
    files,
    (path) => basename(path).endsWith(definition.installerSuffix),
    `${definition.platform} installer (${definition.installerSuffix})`
  );
  const signaturePath = exactlyOne(
    files,
    (path) => basename(path) === `${updaterFileName}.sig`,
    `${definition.platform} updater signature (${updaterFileName}.sig)`
  );
  const signature = readFileSync(signaturePath, "utf8").trim();
  if (!signature) throw new Error(`Updater signature is empty: ${signaturePath}`);

  for (const path of [installerPath, updaterPath, signaturePath]) {
    const fileName = basename(path);
    if (usedAssetNames.has(fileName)) throw new Error(`Duplicate GitHub Release asset name: ${fileName}`);
    usedAssetNames.add(fileName);
  }

  platforms.push({
    platform: definition.platform,
    installer: await fileMetadata(installerPath, sourceAssetBaseUrl),
    updater: {
      ...(await fileMetadata(updaterPath, sourceAssetBaseUrl)),
      signatureFileName: basename(signaturePath),
      signature
    }
  });
}

const manifest = {
  schemaVersion: 1,
  version,
  tag,
  generatedAt: new Date().toISOString(),
  repository,
  commitSha,
  platforms
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(outputPath);
