import { resolve } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import {
  collectReleaseAssets,
  loadReleaseManifest,
  notifyDesktopRelease,
  releaseAssetUrl,
  rewriteManifestForCdn,
  uploadImmutableCosAsset,
  verifyCdnAsset,
  writeFinalManifest
} from "./desktop-release-publisher.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const artifactsDirectory = resolve(requiredEnvironment("RELEASE_ARTIFACTS_DIR"));
const finalManifestPath = resolve(requiredEnvironment("FINAL_RELEASE_MANIFEST_PATH"));
const secretId = requiredEnvironment("TENCENT_COS_SECRET_ID");
const secretKey = requiredEnvironment("TENCENT_COS_SECRET_KEY");
const bucket = requiredEnvironment("TENCENT_COS_BUCKET");
const region = requiredEnvironment("TENCENT_COS_REGION");
const cdnBaseUrl = requiredEnvironment("DESKTOP_RELEASE_CDN_BASE_URL");
const apiUrl = requiredEnvironment("DESKTOP_RELEASE_API_URL");
const webhookSecret = requiredEnvironment("DESKTOP_RELEASE_WEBHOOK_SECRET");

const manifest = await loadReleaseManifest(artifactsDirectory);
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== manifest.repository) {
  throw new Error("GITHUB_REPOSITORY does not match the release manifest");
}
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA.toLowerCase() !== manifest.commitSha) {
  throw new Error("GITHUB_SHA does not match the release manifest");
}

const { assets, signatureMetadata } = await collectReleaseAssets(manifest, artifactsDirectory);
const finalManifest = rewriteManifestForCdn(manifest, cdnBaseUrl, signatureMetadata);
const { rawBody, asset: manifestAsset } = await writeFinalManifest(finalManifestPath, finalManifest);
const allAssets = [...assets, manifestAsset];

const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
for (const asset of allAssets) {
  const result = await uploadImmutableCosAsset(cos, {
    bucket,
    region,
    tag: manifest.tag,
    onMultipartStart: ({ fileName, partCount, chunkSize, concurrency }) => {
      console.log(`Starting multipart upload for ${fileName}: ${partCount} chunks, ${chunkSize} bytes each, concurrency ${concurrency}`);
    },
    onMultipartPartComplete: ({ fileName, partNumber, partCount }) => {
      console.log(`Uploaded multipart chunk ${partNumber}/${partCount} for ${fileName}`);
    }
  }, asset);
  console.log(`${result.uploaded ? "Uploaded" : "Verified"} ${result.key}`);
}

for (const asset of allAssets) {
  await verifyCdnAsset(releaseAssetUrl(cdnBaseUrl, manifest.tag, asset.fileName), asset);
  console.log(`Validated CDN asset ${asset.fileName}`);
}

const result = await notifyDesktopRelease(apiUrl, rawBody, webhookSecret);
console.log(`Backend draft registered for ${result?.version || manifest.version}`);
