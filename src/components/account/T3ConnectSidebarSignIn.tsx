import { LogInIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Button } from "../ui/button";
import { startAccountSignIn, useAuth } from "./accountAuth";
import { AccountProfileDialog } from "./T3ConnectAccountPages";

export function T3ConnectSidebarSignIn() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarSignIn />;
}

export function T3ConnectSidebarAvatar() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredT3ConnectSidebarAvatar />;
}

function ConfiguredT3ConnectSidebarAvatar() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || !isSignedIn) return null;

  return <AccountAvatarButton />;
}

function AccountAvatarButton() {
  const { email } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={email ? `Account ${email}` : "Account"}
        title={email ?? undefined}
        onClick={() => setOpen(true)}
      >
        <UserIcon />
      </Button>
      <AccountProfileDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ConfiguredT3ConnectSidebarSignIn() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || isSignedIn) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => startAccountSignIn()}>
          <LogInIcon />
          <span>Sign in to Vekrel Connect</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
