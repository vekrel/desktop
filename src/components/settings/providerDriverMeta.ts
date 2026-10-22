import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@vekrel/contracts";
import { acpRegistryClient } from "@vekrel/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@vekrel/provider-core/client";
import { cursorClient } from "@vekrel/provider-cursor/client";
import { grokClient } from "@vekrel/provider-grok/client";
import { museClient } from "@vekrel/provider-muse/client";
import { openCodeClient } from "@vekrel/provider-opencode/client";
import { piClient } from "@vekrel/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
