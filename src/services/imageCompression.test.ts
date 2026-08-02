import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopRuntime } from "@/services/imageCompression";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("image compression desktop boundary", () => {
  it("does not expose native compression in a browser window", () => {
    vi.stubGlobal("window", {});
    expect(isDesktopRuntime()).toBe(false);
  });

  it("recognizes the Tauri runtime marker", () => {
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("window", {});
    expect(isDesktopRuntime()).toBe(true);
  });

  it("recognizes a Tauri desktop build before runtime globals are available", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
    vi.stubGlobal("window", {});
    expect(isDesktopRuntime()).toBe(true);
  });
});
