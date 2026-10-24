import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { AccountCallbackSurface } from "../components/account/AccountCallbackSurface";

export const Route = createFileRoute("/auth/callback")({
  beforeLoad: () => {
    if (!hasCloudPublicConfig()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AccountCallbackSurface,
});
