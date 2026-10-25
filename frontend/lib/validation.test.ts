import { describe, expect, it } from "vitest";
import { serverSchema } from "./validation";

const valid = { name: "My Hermes", host: "203.0.113.10", port: 22, username: "root" };
describe("server profiles", () => {
  it.each(["https://example.com", "host; reboot", "host\nwhoami", "-oProxyCommand=command"])(
    "rejects malformed host %s",
    (host) => {
      expect(serverSchema.safeParse({ ...valid, host }).success).toBe(false);
    },
  );
  it.each([0, 65536, 22.5, Number.NaN])("rejects invalid port %s", (port) => {
    expect(serverSchema.safeParse({ ...valid, port }).success).toBe(false);
  });
  it("accepts IPv6 without requiring a protocol or brackets", () => {
    expect(serverSchema.safeParse({ ...valid, host: "2001:db8::1" }).success).toBe(true);
  });
});
