import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStartBuildRequest,
  triggerCnbBuild,
  waitForCnbBuild
} from "./trigger-cnb-desktop-release.mjs";

const sha = "a".repeat(40);

describe("CNB desktop release trigger", () => {
  it("binds the CNB build to the GitHub tag, commit, and repository", () => {
    assert.deepEqual(createStartBuildRequest({
      tag: "v1.2.3",
      sha,
      githubRepository: "lscho/magimg"
    }), {
      event: "api_trigger_desktop_release",
      tag: "v1.2.3",
      sha,
      title: "Publish desktop release v1.2.3",
      sync: "false",
      env: {
        GITHUB_REPOSITORY: "lscho/magimg",
        GITHUB_SHA: sha,
        RELEASE_TAG: "v1.2.3",
        RELEASE_ARTIFACTS_DIR: "release-artifacts",
        FINAL_RELEASE_MANIFEST_PATH: "release-manifest-final/huanhua-desktop-release-manifest.json"
      }
    });
  });

  it("rejects ambiguous tags, repositories, and abbreviated SHAs", () => {
    assert.throws(
      () => createStartBuildRequest({ tag: "1.2.3", sha, githubRepository: "lscho/magimg" }),
      /v-prefixed SemVer/
    );
    assert.throws(
      () => createStartBuildRequest({ tag: "v1.2.3", sha: "abc123", githubRepository: "lscho/magimg" }),
      /40-character/
    );
    assert.throws(
      () => createStartBuildRequest({ tag: "v1.2.3", sha, githubRepository: "https:\/\/github.com\/lscho\/magimg" }),
      /owner\/repository/
    );
  });

  it("starts the requested CNB build without exposing the token in the body", async () => {
    let received;
    const result = await triggerCnbBuild({
      token: "secret-token",
      cnbRepository: "atmomo/huanhua-client",
      request: createStartBuildRequest({ tag: "v1.2.3", sha, githubRepository: "lscho/magimg" }),
      fetchImpl: async (url, options) => {
        received = { url, options };
        return new Response(JSON.stringify({ success: true, sn: "cnb-123", buildLogUrl: "https://cnb.cool/build/123" }));
      }
    });
    assert.equal(result.sn, "cnb-123");
    assert.equal(received.url, "https://api.cnb.cool/atmomo/huanhua-client/-/build/start");
    assert.equal(received.options.headers.authorization, "Bearer secret-token");
    assert.doesNotMatch(received.options.body, /secret-token/u);
  });

  it("waits through pending state and reports a failed CNB pipeline", async () => {
    const statuses = ["pending", "error"];
    await assert.rejects(
      waitForCnbBuild({
        token: "secret-token",
        cnbRepository: "atmomo/huanhua-client",
        sn: "cnb-123",
        fetchImpl: async () => new Response(JSON.stringify({ status: statuses.shift() })),
        pollIntervalMs: 0,
        timeoutMs: 10_000,
        sleep: async () => {}
      }),
      /status: error/
    );
  });
});
