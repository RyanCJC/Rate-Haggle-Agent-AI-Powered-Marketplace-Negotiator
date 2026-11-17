import { beforeEach, describe, expect, it, vi } from "vitest";

describe("getProfileId", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps a valid stored profile id", async () => {
    const { getProfileId } = await import("./profile");
    const id = "a".repeat(32);
    const storage = {
      getItem: vi.fn(() => id),
      setItem: vi.fn(),
    };

    expect(getProfileId(storage)).toBe(id);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("replaces an invalid stored profile id", async () => {
    const { getProfileId } = await import("./profile");
    const storage = {
      getItem: vi.fn(() => "INVALID"),
      setItem: vi.fn(),
    };
    const makeId = vi.fn(() => "b".repeat(32));

    expect(getProfileId(storage, makeId)).toBe("b".repeat(32));
    expect(storage.setItem).toHaveBeenCalledWith("haggle.profileId", "b".repeat(32));
  });

  it("uses a stable in-memory id when storage access throws", async () => {
    const { getProfileId } = await import("./profile");
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
      setItem: vi.fn(),
    };
    const makeId = vi.fn(() => "c".repeat(32));

    expect(getProfileId(storage, makeId)).toBe("c".repeat(32));
    expect(getProfileId(storage, makeId)).toBe("c".repeat(32));
    expect(makeId).toHaveBeenCalledTimes(1);
  });

  it("keeps the generated id in memory when writing storage throws", async () => {
    const { getProfileId } = await import("./profile");
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
    };
    const makeId = vi.fn(() => "d".repeat(32));

    expect(getProfileId(storage, makeId)).toBe("d".repeat(32));
    expect(getProfileId(storage, makeId)).toBe("d".repeat(32));
    expect(makeId).toHaveBeenCalledTimes(1);
  });

  it("creates and stores a 32-character lowercase hexadecimal id", async () => {
    const { getProfileId } = await import("./profile");
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };

    const id = getProfileId(storage);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(storage.setItem).toHaveBeenCalledWith("haggle.profileId", id);
  });
});
