import { LogOutIcon, ServerIcon, SmartphoneIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { signOutAccount, useAuth } from "./accountAuth";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { T3ConnectUserProfilePage } from "./T3ConnectUserProfilePage";

export const VEKREL_CONNECT_ACCOUNT_PAGES = [
  {
    label: "Vekrel Connect",
    url: "vekrel-connect",
    icon: <ServerIcon className="size-4" />,
    content: <T3ConnectUserProfilePage />,
  },
  {
    label: "Mobile clients",
    url: "mobile-clients",
    icon: <SmartphoneIcon className="size-4" />,
    content: <MobileClientsUserProfilePage />,
  },
] as const;

type AccountPageUrl = (typeof VEKREL_CONNECT_ACCOUNT_PAGES)[number]["url"];

/** The account profile: email, sign out, and the Vekrel Connect and mobile client pages. */
export function AccountProfileDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { email } = useAuth();
  const [page, setPage] = useState<AccountPageUrl>("vekrel-connect");
  const [signingOut, setSigningOut] = useState(false);
  const current = VEKREL_CONNECT_ACCOUNT_PAGES.find((entry) => entry.url === page)!;

  const signOut = () => {
    setSigningOut(true);
    signOutAccount().then(
      () => {
        setSigningOut(false);
        onOpenChange(false);
      },
      (error: unknown) => {
        setSigningOut(false);
        toastManager.add({
          type: "error",
          title: "Could not sign out",
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-h-[80dvh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>{email ?? "Signed in"}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-wrap items-center gap-1">
            {VEKREL_CONNECT_ACCOUNT_PAGES.map((entry) => (
              <Button
                key={entry.url}
                size="sm"
                variant={entry.url === page ? "secondary" : "ghost"}
                aria-pressed={entry.url === page}
                onClick={() => setPage(entry.url)}
              >
                {entry.icon}
                {entry.label}
              </Button>
            ))}
            <Button
              className="ms-auto"
              size="sm"
              variant="outline"
              disabled={signingOut}
              onClick={signOut}
            >
              <LogOutIcon />
              Sign out
            </Button>
          </div>
          {current.content}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** `open` is null while signed out; the caller keeps `portals` rendered. */
export function useT3ConnectAccountPage(): {
  readonly open: (() => void) | null;
  readonly portals: ReactNode;
} {
  const { isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);

  return {
    open: isSignedIn ? () => setOpen(true) : null,
    portals: isSignedIn ? <AccountProfileDialog open={open} onOpenChange={setOpen} /> : null,
  };
}
