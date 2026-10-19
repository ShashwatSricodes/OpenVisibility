import { describe, expect, it } from "vitest";
import { DecryptError, decrypt, encrypt } from "./crypto";

const SECRET = "a-test-secret-that-is-at-least-32-characters";

describe("encrypt / decrypt", () => {
  it("round-trips, with a different ciphertext every time", () => {
    const a = encrypt("bd-key-1234", "ws-1", SECRET);
    const b = encrypt("bd-key-1234", "ws-1", SECRET);
    expect(a).not.toBe(b);
    expect(a).not.toContain("bd-key");
    expect(a.startsWith("v1.")).toBe(true);
    expect(decrypt(a, "ws-1", SECRET)).toBe("bd-key-1234");
  });

  it("refuses a ciphertext moved to another workspace", () => {
    const stored = encrypt("bd-key-1234", "ws-1", SECRET);
    expect(() => decrypt(stored, "ws-2", SECRET)).toThrow(DecryptError);
  });

  it("refuses a different secret or a tampered value", () => {
    const stored = encrypt("bd-key-1234", "ws-1", SECRET);
    expect(() => decrypt(stored, "ws-1", SECRET + "x")).toThrow(DecryptError);
    const [v, iv, tag, body] = stored.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "BA" : "AA");
    expect(() => decrypt([v, iv, tag, flipped].join("."), "ws-1", SECRET)).toThrow(DecryptError);
    expect(() => decrypt("not-a-value", "ws-1", SECRET)).toThrow(DecryptError);
  });
});
