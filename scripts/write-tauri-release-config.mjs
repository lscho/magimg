import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const releaseVersion = requiredEnvironment("RELEASE_VERSION").replace(/^v/u, "");
const updateEndpoint = requiredEnvironment("UPDATE_ENDPOINT");
const publicKey = requiredEnvironment("TAURI_SIGNING_PUBLIC_KEY");
const runnerTemp = requiredEnvironment("RUNNER_TEMP");

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(releaseVersion)) {
  throw new Error(`Invalid semantic version: ${releaseVersion}`);
}

const endpointUrl = new URL(updateEndpoint);
if (endpointUrl.protocol !== "https:") throw new Error("UPDATE_ENDPOINT must use HTTPS");
if (!updateEndpoint.includes("{{target}}")) throw new Error("UPDATE_ENDPOINT must include {{target}}");

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
