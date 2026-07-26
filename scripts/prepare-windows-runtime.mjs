import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRT_DIRECTORY_NAME = "Microsoft.VC143.CRT";
const REQUIRED_RUNTIME_FILES = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasRequiredRuntimeFiles(path) {
  return isDirectory(path) && REQUIRED_RUNTIME_FILES.every(fileName => existsSync(join(path, fileName)));
}

export function toMsvcArchitecture(architecture) {
  const normalized = architecture?.trim().toLowerCase();
  if (normalized === "x86_64" || normalized === "x64") return "x64";
  if (normalized === "aarch64" || normalized === "arm64") return "arm64";
  if (normalized === "i686" || normalized === "x86") return "x86";
  throw new Error(`Unsupported Windows architecture: ${architecture || "unknown"}`);
}

function versionDirectories(root) {
  if (!isDirectory(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, entry.name))
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
}

export function findMsvcCrtDirectory(searchRoots, architecture) {
  const msvcArchitecture = toMsvcArchitecture(architecture);

  for (const root of searchRoots.filter(Boolean).map(path => resolve(path))) {
    const candidates = [
      root,
      join(root, msvcArchitecture, CRT_DIRECTORY_NAME),
      ...versionDirectories(root).map(versionRoot =>
        join(versionRoot, msvcArchitecture, CRT_DIRECTORY_NAME)
      )
    ];
    const match = candidates.find(hasRequiredRuntimeFiles);
    if (match) return match;
  }

  return null;
}

function visualStudioInstallationPath(environment) {
  const programFilesX86 = environment["ProgramFiles(x86)"];
  if (!programFilesX86) return null;

  const vswherePath = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswherePath)) return null;

  try {
    return execFileSync(
      vswherePath,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Redist.14.Latest",
        "-property",
        "installationPath"
      ],
      { encoding: "utf8", windowsHide: true }
    ).trim() || null;
  } catch {
    return null;
  }
}

export function runtimeSearchRoots(environment = process.env) {
  const installationPath = visualStudioInstallationPath(environment);
  return [
    environment.MSVC_CRT_DIR,
    environment.VCToolsRedistDir,
    environment.VCINSTALLDIR ? join(environment.VCINSTALLDIR, "Redist", "MSVC") : null,
    installationPath ? join(installationPath, "VC", "Redist", "MSVC") : null,
    environment.ProgramFiles
      ? join(environment.ProgramFiles, "Microsoft Visual Studio", "2022", "Enterprise", "VC", "Redist", "MSVC")
      : null,
    environment.ProgramFiles
      ? join(environment.ProgramFiles, "Microsoft Visual Studio", "2022", "Professional", "VC", "Redist", "MSVC")
      : null,
    environment.ProgramFiles
      ? join(environment.ProgramFiles, "Microsoft Visual Studio", "2022", "Community", "VC", "Redist", "MSVC")
      : null,
    environment.ProgramFiles
      ? join(environment.ProgramFiles, "Microsoft Visual Studio", "2022", "BuildTools", "VC", "Redist", "MSVC")
      : null
  ].filter(Boolean);
}

export function stageMsvcRuntime(sourceDirectory, outputDirectory) {
  if (!hasRequiredRuntimeFiles(sourceDirectory)) {
    throw new Error(`MSVC runtime directory is incomplete: ${sourceDirectory}`);
  }

  const runtimeFiles = readdirSync(sourceDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".dll"))
    .map(entry => entry.name)
    .sort();

  rmSync(outputDirectory, { force: true, recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  for (const fileName of runtimeFiles) {
    copyFileSync(join(sourceDirectory, fileName), join(outputDirectory, fileName));
  }

  return runtimeFiles;
}

function windowsTarget(environment) {
  if (environment.TAURI_ENV_PLATFORM) return environment.TAURI_ENV_PLATFORM === "windows";
  if (environment.TAURI_ENV_TARGET_TRIPLE) {
    return environment.TAURI_ENV_TARGET_TRIPLE.includes("windows");
  }
  return process.platform === "win32";
}

function targetArchitecture(environment) {
  return environment.TAURI_ENV_ARCH
    || environment.TAURI_ENV_TARGET_TRIPLE?.split("-")[0]
    || process.arch;
}

export function prepareWindowsRuntime(environment = process.env) {
  if (!windowsTarget(environment)) {
    console.log("Skipping MSVC runtime staging for a non-Windows target.");
    return [];
  }

  const architecture = targetArchitecture(environment);
  const sourceDirectory = findMsvcCrtDirectory(runtimeSearchRoots(environment), architecture);
  if (!sourceDirectory) {
    throw new Error(
      `Microsoft.VC143.CRT for ${toMsvcArchitecture(architecture)} was not found. `
      + "Install the MSVC v143 C++ build tools, or set MSVC_CRT_DIR to the architecture-specific CRT directory."
    );
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outputDirectory = join(projectRoot, "src-tauri", "windows-runtime");
  const runtimeFiles = stageMsvcRuntime(sourceDirectory, outputDirectory);
  console.log(
    `Staged ${runtimeFiles.length} MSVC runtime DLLs for ${toMsvcArchitecture(architecture)} from ${sourceDirectory}.`
  );
  return runtimeFiles;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  prepareWindowsRuntime();
}
