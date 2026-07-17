import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const releaseVersion = requiredEnvironment("RELEASE_VERSION").replace(/^v/u, "");
const apiBaseUrl = requiredEnvironment("VITE_API_BASE_URL");
const publicKey = requiredEnvironment("TAURI_SIGNING_PUBLIC_KEY");
const runnerTemp = requiredEnvironment("RUNNER_TEMP");

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(releaseVersion)) {
  throw new Error(`Invalid semantic version: ${releaseVersion}`);
}

const apiBase = new URL(apiBaseUrl);
if (apiBase.protocol !== "https:") throw new Error("VITE_API_BASE_URL must use HTTPS");
apiBase.search = "";
apiBase.hash = "";
const normalizedApiPath = apiBase.pathname.replace(/\/+$/u, "");
apiBase.pathname = normalizedApiPath.endsWith("/api/client/v1")
  ? normalizedApiPath
  : `${normalizedApiPath}/api/client/v1`;
const updateEndpoint = `${apiBase.toString().replace(/\/$/u, "")}/version/latest/tauri?platform={{target}}`;

const outputDirectory = join(runnerTemp, "huanhua-release");
const outputPath = join(outputDirectory, "tauri.release.conf.json");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      version: releaseVersion,
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          endpoints: [updateEndpoint],
          pubkey: publicKey,
          windows: { installMode: "passive" }
        }
      }
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(outputPath);
