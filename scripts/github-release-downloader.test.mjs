import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  downloadGithubDesktopRelease,
  githubReleaseAssetUrl,
  releaseAssetDescriptors
} from "./download-github-desktop-release.mjs";

const commitSha = "b".repeat(40);
const sha256 = value => createHash("sha256").update(value).digest("hex");

function metadata(fileName, content) {
  return {
    fileName,
    fileSize: Buffer.byteLength(content),
    sha256: sha256(content),
    sourceUrl: `https://github.example/${encodeURIComponent(fileName)}`
  };
}

function releaseFixture() {
  const files = new Map([
    ["win-x64.exe", "windows-x64"],
    ["win-x64.exe.sig", "signature-windows-x64\n"],
    ["win-arm64.exe", "windows-arm64"],
    ["win-arm64.exe.sig", "signature-windows-arm64\n"],
    ["mac-x64.dmg", "macos-x64-installer"],
    ["mac-x64.app.tar.gz", "macos-x64-updater"],
    ["mac-x64.app.tar.gz.sig", "signature-macos-x64\n"],
    ["mac-arm64.dmg", "macos-arm64-installer"],
    ["mac-arm64.app.tar.gz", "macos-arm64-updater"],
    ["mac-arm64.app.tar.gz.sig", "signature-macos-arm64\n"]
  ]);
  const platform = (name, installerName, updaterName) => ({
    platform: name,
    installer: metadata(installerName, files.get(installerName)),
    updater: {
      ...metadata(updaterName, files.get(updaterName)),
      signatureFileName: `${updaterName}.sig`,
      signature: files.get(`${updaterName}.sig`).trim()
    }
  });
  const manifest = {
    schemaVersion: 1,
    version: "1.2.3",
    tag: "v1.2.3",
    generatedAt: "2026-07-31T00:00:00.000Z",
    repository: "lscho/magimg",
    commitSha,
    platforms: [
      platform("windows-x86", "win-x64.exe", "win-x64.exe"),
      platform("windows-arm", "win-arm64.exe", "win-arm64.exe"),
      platform("macos-x86", "mac-x64.dmg", "mac-x64.app.tar.gz"),
      platform("macos-arm", "mac-arm64.dmg", "mac-arm64.app.tar.gz")
    ]
  };
  files.set("huanhua-desktop-release-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest };
}

describe("GitHub desktop release downloader", () => {
  it("constructs encoded public release asset URLs", () => {
    assert.equal(
      githubReleaseAssetUrl("lscho/magimg", "v1.2.3", "幻画 AI.exe"),
      "https://github.com/lscho/magimg/releases/download/v1.2.3/%E5%B9%BB%E7%94%BB%20AI.exe"
    );
  });

  it("deduplicates Windows installer/updater files", () => {
    const { manifest } = releaseFixture();
    assert.equal(releaseAssetDescriptors(manifest).length, 10);
  });

  it("downloads only manifest-declared assets and verifies their content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huanhua-github-release-"));
    const { files } = releaseFixture();
    const requested = [];
    try {
      const result = await downloadGithubDesktopRelease({
        repository: "lscho/magimg",
        tag: "v1.2.3",
        sha: commitSha,
        outputDirectory: directory,
        fetchImpl: async url => {
          const fileName = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
          requested.push(fileName);
          const content = files.get(fileName);
          return content === undefined
            ? new Response("missing", { status: 404 })
            : new Response(content, { headers: { "content-length": String(Buffer.byteLength(content)) } });
        }
      });
      assert.equal(result.assets.length, 10);
      assert.equal(new Set(requested).size, 11);
      assert.equal(await readFile(join(directory, "mac-arm64.dmg"), "utf8"), "macos-arm64-installer");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a release manifest from a different commit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huanhua-github-release-"));
    const { files } = releaseFixture();
    try {
      await assert.rejects(
        downloadGithubDesktopRelease({
          repository: "lscho/magimg",
          tag: "v1.2.3",
          sha: "c".repeat(40),
          outputDirectory: directory,
          fetchImpl: async url => {
            const fileName = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
            return new Response(files.get(fileName));
          }
        }),
        /commit does not match/
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
