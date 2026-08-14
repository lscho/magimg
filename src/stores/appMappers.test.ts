import { describe, expect, it } from "vitest";
import type { GeneratedImage } from "@/types";
import {
  generationErrorDetails,
  isPersistedSession,
  mergeServerImage,
  parseSize,
  toGenerationMode,
  toTaskStatus
} from "./appMappers";

describe("appMappers", () => {
  it("在客户端与服务端生成枚举之间转换", () => {
    expect(toGenerationMode("imageToImage")).toBe("image-to-image");
    expect(toTaskStatus("queued")).toBe("pending");
    expect(toTaskStatus("succeeded")).toBe("succeeded");
  });

  it("只接受结构完整且未过期的持久化会话", () => {
    expect(isPersistedSession({
      accessToken: "token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: "user-1", nickname: "用户" }
    })).toBe(true);
    expect(isPersistedSession({
      accessToken: "token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      user: { id: "user-1", nickname: "用户" }
    })).toBe(false);
  });

  it("服务端资源只合并相同 asset id 的本地路径", () => {
    const serverImage: GeneratedImage = {
      id: "asset-new",
      remoteUrl: "https://example.com/new.png",
      width: 1024,
      height: 1024,
      mimeType: "image/png"
    };
    const localImages: GeneratedImage[] = [
      { ...serverImage, id: "asset-old", localPath: "/tmp/old.png" },
      { ...serverImage, localPath: "/tmp/new.png" }
    ];

    expect(mergeServerImage(serverImage, localImages).localPath).toBe("/tmp/new.png");
    expect(mergeServerImage(serverImage, localImages.slice(0, 1)).localPath).toBeUndefined();
  });

  it("解析固定尺寸并归一化生成错误", () => {
    expect(parseSize("1536x1024")).toEqual({ width: 1536, height: 1024 });
    expect(parseSize("auto")).toEqual({});
    expect(generationErrorDetails(new Error("账户积分不足"))).toEqual({
      kind: "insufficientCredits",
      message: "积分不足，请充值后继续生成。"
    });
  });
});
