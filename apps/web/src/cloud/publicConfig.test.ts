import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { hasCloudPublicConfig, resolveCloudPublicConfig } from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hasCloudPublicConfig", () => {
  it("is off without a relay URL", () => {
    vi.stubEnv("VITE_VEKREL_RELAY_URL", "");

    expect(hasCloudPublicConfig()).toBe(false);
  });

  it.each(["http://relay.example.test", "https://user:pw@relay.example.test", "not a url"])(
    "rejects an insecure or malformed relay URL: %s",
    (relayUrl) => {
      vi.stubEnv("VITE_VEKREL_RELAY_URL", relayUrl);

      expect(resolveCloudPublicConfig().relayUrl).toBeNull();
      expect(hasCloudPublicConfig()).toBe(false);
    },
  );

  describe("hosted relay", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_VEKREL_RELAY_URL", "https://relay.example.com");
    });

    it.each(["https://example.com", "https://nightly.app.example.com:443"])(
      "enables sign-in on the relay's domain and its subdomains: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(true);
      },
    );

    it.each(["http://localhost:3773", "https://machine.example.ts.net"])(
      "disables sign-in on private browser origins: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["http://app.example.com:443", "https://app.example.com:3773"])(
      "rejects unsupported schemes and ports even on the relay's domain: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["https://notexample.com", "https://example.com.evil.test"])(
      "rejects domain lookalikes: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it("never treats a bare top-level domain as the app's domain", () => {
      vi.stubEnv("VITE_VEKREL_RELAY_URL", "https://example.com");
      vi.stubGlobal("window", { location: new URL("https://evil.com") });

      expect(hasCloudPublicConfig()).toBe(false);
    });

    it("stays off in the desktop shell until it signs in through a deep link", () => {
      vi.stubGlobal("window", { location: new URL("file:///app/index.html"), desktopBridge: {} });

      expect(hasCloudPublicConfig()).toBe(false);
    });
  });

  describe("local relay", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_VEKREL_RELAY_URL", "http://localhost:8787");
    });

    it("enables sign-in on the same loopback host (same site, so the cookie is sent)", () => {
      vi.stubGlobal("window", { location: new URL("http://localhost:5733/") });

      expect(hasCloudPublicConfig()).toBe(true);
    });

    it("disables sign-in on another loopback name (another site)", () => {
      vi.stubGlobal("window", { location: new URL("http://127.0.0.1:5733/") });

      expect(hasCloudPublicConfig()).toBe(false);
    });
  });
});
