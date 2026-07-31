import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COS_MULTIPART_CHUNK_SIZE,
  COS_MULTIPART_CONCURRENCY,
  COS_MULTIPART_THRESHOLD,
  createReleaseWebhookSignature,
  releaseAssetUrl,
  releaseObjectKey,
  rewriteManifestForCdn,
  uploadImmutableCosAsset,
  validateReleaseManifest
} from "./desktop-release-publisher.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");

function manifestFixture() {
  return {
    schemaVersion: 1,
    version: "1.2.3",
    tag: "v1.2.3",
    generatedAt: "2026-07-20T00:00:00.000Z",
    repository: "lscho/magimg",
    commitSha: "a".repeat(40),
    platforms: [
      ["windows-x86", "win-x64.exe", "win-x64.exe"],
      ["windows-arm", "win-arm64.exe", "win-arm64.exe"],
      ["macos-x86", "mac-x64.dmg", "mac-x64.app.tar.gz"],
      ["macos-arm", "mac-arm64.dmg", "mac-arm64.app.tar.gz"]
    ].map(([platform, installerName, updaterName]) => ({
      platform,
      installer: {
        fileName: installerName,
        fileSize: 100,
        sha256: sha256(`${platform}-installer`),
        sourceUrl: "https://github.example/installer"
      },
      updater: {
        fileName: updaterName,
        fileSize: 200,
        sha256: sha256(`${platform}-updater`),
        sourceUrl: "https://github.example/updater",
        signatureFileName: `${updaterName}.sig`,
        signature: `signature-${platform}`
      }
    }))
  };
}

describe("validateReleaseManifest", () => {
  it("accepts a complete four-platform manifest", () => {
    assert.equal(validateReleaseManifest(manifestFixture()).platforms.length, 4);
  });

  it("rejects duplicate platforms and missing updater signatures", () => {
    const duplicate = manifestFixture();
    duplicate.platforms[1].platform = "windows-x86";
    assert.throws(() => validateReleaseManifest(duplicate), /Duplicate or unsupported/);

    const unsigned = manifestFixture();
    unsigned.platforms[0].updater.signature = "";
    assert.throws(() => validateReleaseManifest(unsigned), /signature is invalid/);
  });

  it("rejects invalid SemVer prerelease identifiers", () => {
    for (const version of ["1.2.3-01", "1.2.3-.broken", "1.2.3-alpha..1"]) {
      const manifest = manifestFixture();
      manifest.version = version;
      manifest.tag = `v${version}`;
      assert.throws(() => validateReleaseManifest(manifest), /version is invalid/);
    }
  });
});

describe("release paths and manifest rewriting", () => {
  it("builds immutable versioned keys and encoded CDN URLs", () => {
    assert.equal(releaseObjectKey("v1.2.3", "幻画 AI.exe"), "desktop/releases/v1.2.3/幻画 AI.exe");
    assert.equal(
      releaseAssetUrl("https://download.example.com/client", "v1.2.3", "幻画 AI.exe"),
      "https://download.example.com/client/desktop/releases/v1.2.3/%E5%B9%BB%E7%94%BB%20AI.exe"
    );
  });

  it("rewrites installer, updater, and signature URLs", () => {
    const manifest = validateReleaseManifest(manifestFixture());
    const signatureMetadata = new Map(manifest.platforms.map(platform => [
      platform.platform,
      {
        fileName: platform.updater.signatureFileName,
        fileSize: 42,
        sha256: sha256(platform.updater.signature)
      }
    ]));
    const finalManifest = rewriteManifestForCdn(manifest, "https://download.example.com", signatureMetadata);
    assert.match(finalManifest.platforms[0].installer.sourceUrl, /desktop\/releases\/v1\.2\.3\/win-x64\.exe$/);
    assert.match(finalManifest.platforms[0].updater.signatureSourceUrl, /\.exe\.sig$/);
    assert.equal(finalManifest.platforms[0].updater.signatureFileSize, 42);
  });
});

describe("createReleaseWebhookSignature", () => {
  it("is deterministic and bound to the body", () => {
    const secret = "s".repeat(32);
    const first = createReleaseWebhookSignature('{"version":"1.2.3"}', "1784512345", secret);
    const second = createReleaseWebhookSignature('{"version":"1.2.4"}', "1784512345", secret);
    assert.match(first, /^v1=[0-9a-f]{64}$/u);
    assert.notEqual(first, second);
  });
});

describe("uploadImmutableCosAsset", () => {
  const asset = {
    path: new URL(import.meta.url),
    fileName: "release.exe",
    fileSize: 100,
    sha256: "a".repeat(64)
  };
  const config = {
    bucket: "bucket-123",
    region: "ap-guangzhou",
    tag: "v1.2.3"
  };

  it("uses multipart defaults suitable for every desktop binary", () => {
    assert.equal(COS_MULTIPART_THRESHOLD, 16 * 1024 * 1024);
    assert.equal(COS_MULTIPART_CHUNK_SIZE, 8 * 1024 * 1024);
    assert.equal(COS_MULTIPART_CONCURRENCY, 4);
  });

  it("skips an existing object only when immutable metadata matches", async () => {
    let putCalls = 0;
    const client = {
      headObject(_params, callback) {
        callback(null, {
          headers: {
            "content-length": "100",
            "x-cos-meta-sha256": asset.sha256
          }
        });
      },
      putObject() {
        putCalls += 1;
      }
    };
    assert.deepEqual(await uploadImmutableCosAsset(client, config, asset), {
      key: "desktop/releases/v1.2.3/release.exe",
      uploaded: false
    });
    assert.equal(putCalls, 0);
  });

  it("rejects an existing object with conflicting metadata", async () => {
    const client = {
      headObject(_params, callback) {
        callback(null, {
          headers: {
            "content-length": "101",
            "x-cos-meta-sha256": asset.sha256
          }
        });
      }
    };
    await assert.rejects(
      uploadImmutableCosAsset(client, config, asset),
      /already exists with different or incomplete metadata/
    );
  });

  it("uses COS overwrite protection and accepts a concurrent identical upload", async () => {
    let headCalls = 0;
    let putHeaders;
    const client = {
      headObject(_params, callback) {
        headCalls += 1;
        if (headCalls === 1) {
          callback({ statusCode: 404, code: "NoSuchKey" });
          return;
        }
        callback(null, {
          headers: {
            "content-length": "100",
            "x-cos-meta-sha256": asset.sha256
          }
        });
      },
      putObject(params, callback) {
        putHeaders = params.Headers;
        params.Body.destroy();
        callback({ statusCode: 409, code: "ObjectExists" });
      }
    };
    assert.deepEqual(await uploadImmutableCosAsset(client, config, asset), {
      key: "desktop/releases/v1.2.3/release.exe",
      uploaded: false
    });
    assert.equal(putHeaders["x-cos-forbid-overwrite"], "true");
    assert.equal(headCalls, 2);
  });

  it("uses retrying concurrent multipart upload for large assets", async () => {
    const multipartAsset = {
      ...asset,
      fileName: "large-release.exe",
      fileSize: 20
    };
    let headCalls = 0;
    let putCalls = 0;
    let uploadCalls = 0;
    let completeParams;
    const completedParts = [];
    const client = {
      headObject(_params, callback) {
        headCalls += 1;
        if (headCalls === 1) {
          callback({ statusCode: 404, code: "NoSuchKey" });
          return;
        }
        callback(null, {
          headers: {
            "content-length": String(multipartAsset.fileSize),
            "x-cos-meta-sha256": multipartAsset.sha256
          }
        });
      },
      putObject() {
        putCalls += 1;
      },
      multipartInit(params, callback) {
        assert.equal(params.Headers["x-cos-meta-sha256"], multipartAsset.sha256);
        callback(null, { UploadId: "upload-123" });
      },
      multipartUpload(params, callback) {
        uploadCalls += 1;
        params.Body.destroy();
        if (params.PartNumber === 1 && uploadCalls === 1) {
          callback({ statusCode: 400, code: "UserNetworkTooSlow" });
          return;
        }
        callback(null, { ETag: `etag-${params.PartNumber}` });
      },
      multipartComplete(params, callback) {
        completeParams = params;
        callback(null, {});
      },
      multipartAbort(_params, callback) {
        callback(null, {});
      }
    };
    assert.deepEqual(await uploadImmutableCosAsset(client, {
      ...config,
      multipartThreshold: 10,
      multipartChunkSize: 8,
      multipartConcurrency: 2,
      multipartRetryDelayMs: 0,
      onMultipartPartComplete: part => completedParts.push(part.partNumber)
    }, multipartAsset), {
      key: "desktop/releases/v1.2.3/large-release.exe",
      uploaded: true
    });
    assert.equal(putCalls, 0);
    assert.equal(uploadCalls, 4);
    assert.deepEqual(completeParams.Parts, [
      { PartNumber: 1, ETag: "etag-1" },
      { PartNumber: 2, ETag: "etag-2" },
      { PartNumber: 3, ETag: "etag-3" }
    ]);
    assert.equal(completeParams.Headers["x-cos-forbid-overwrite"], "true");
    assert.deepEqual(completedParts.sort(), [1, 2, 3]);
  });
});
