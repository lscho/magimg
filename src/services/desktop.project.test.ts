// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/")))
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: mocks.exists,
  mkdir: mocks.mkdir,
  readFile: vi.fn(),
  writeFile: mocks.writeFile
}));
vi.mock("@tauri-apps/api/path", () => ({ join: mocks.join }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn(() => "macos") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));

describe("automatic-layer project directory export", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mocks.open.mockResolvedValue("/chosen");
    mocks.exists.mockResolvedValue(false);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("grants recursive access before creating the project and assets directories", async () => {
    const { saveProjectDirectory } = await import("@/services/desktop");
    await saveProjectDirectory("demo-layers", [
      { relativePath: "assets/item.png", contents: new Blob(["asset"]) }
    ]);

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      directory: true,
      recursive: true
    }));
    expect(mocks.mkdir).toHaveBeenCalledWith("/chosen/demo-layers/assets", { recursive: true });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/chosen/demo-layers/assets/item.png",
      expect.any(Uint8Array)
    );
  });
});
