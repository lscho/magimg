import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  findMsvcCrtDirectory,
  stageMsvcRuntime,
  toMsvcArchitecture
} from "./prepare-windows-runtime.mjs";

const requiredFiles = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

function createRuntimeDirectory(root, version, architecture, extraFiles = []) {
  const directory = join(root, version, architecture, "Microsoft.VC143.CRT");
  mkdirSync(directory, { recursive: true });
  for (const fileName of [...requiredFiles, ...extraFiles]) {
    writeFileSync(join(directory, fileName), fileName);
  }
  return directory;
}

describe("toMsvcArchitecture", () => {
  it("maps Rust and Node target architecture names", () => {
    assert.equal(toMsvcArchitecture("x86_64"), "x64");
    assert.equal(toMsvcArchitecture("aarch64"), "arm64");
    assert.equal(toMsvcArchitecture("x86"), "x86");
    assert.throws(() => toMsvcArchitecture("riscv64"), /Unsupported Windows architecture/u);
  });
});

describe("findMsvcCrtDirectory", () => {
  it("selects the newest complete runtime for the requested architecture", () => {
    const root = mkdtempSync(join(tmpdir(), "huanhua-msvc-search-"));
    createRuntimeDirectory(root, "14.38.33130", "x64");
    const newest = createRuntimeDirectory(root, "14.44.35211", "x64");
    createRuntimeDirectory(root, "14.44.35211", "arm64");

    assert.equal(findMsvcCrtDirectory([root], "x86_64"), newest);
  });

  it("rejects a directory missing a required runtime DLL", () => {
    const root = mkdtempSync(join(tmpdir(), "huanhua-msvc-incomplete-"));
    const directory = join(root, "x64", "Microsoft.VC143.CRT");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "msvcp140.dll"), "incomplete");

    assert.equal(findMsvcCrtDirectory([root], "x64"), null);
  });
});

describe("stageMsvcRuntime", () => {
  it("copies every CRT DLL and replaces stale staged files", () => {
    const root = mkdtempSync(join(tmpdir(), "huanhua-msvc-stage-"));
    const source = createRuntimeDirectory(root, "14.44.35211", "arm64", ["msvcp140_1.dll"]);
    const output = join(root, "output");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "stale.dll"), "stale");

    assert.deepEqual(stageMsvcRuntime(source, output), [
      "msvcp140.dll",
      "msvcp140_1.dll",
      "vcruntime140.dll",
      "vcruntime140_1.dll"
    ]);
    assert.equal(existsSync(join(output, "stale.dll")), false);
  });
});
