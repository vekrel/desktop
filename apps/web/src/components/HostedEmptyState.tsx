import { NPM_LAUNCHER_PACKAGE_NAME } from "@vekrel/shared/cliPackage";
import type { MachineId } from "@vekrel/contracts";
import { Link } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { APP_DISPLAY_NAME, DESKTOP_DOWNLOAD_URL } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "../env";
import { isLocalMachineDisabled } from "../localMachine";
import { useRelayMachineDiscovery } from "../state/machines";
import { CommandBlock } from "./CommandBlock";
import { startAccountSignIn, useAuth } from "./account/accountAuth";
import { CloudMachineConnectRows } from "./cloud/CloudMachineConnectList";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** Home screen for the hosted app before any computer is added. */
export function HostedEmptyState() {
  const cloudEnabled = hasCloudPublicConfig();
  const localMachineOff = isLocalMachineDisabled();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {localMachineOff ? "This computer is off" : "No computer connected"}
            </EmptyTitle>
            <EmptyDescription>
              {localMachineOff
                ? "Turn it back on, or connect a different computer."
                : cloudEnabled
                  ? "Your agents run on your computer."
                  : "Your agents run on your computer. Start Vekrel there first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {localMachineOff ? (
              <Button render={<Link to="/settings/connections" />} size="sm">
                Open Connections
              </Button>
            ) : (
              <ol className="w-full space-y-4 text-left">
                {cloudEnabled ? <T3ConnectSteps /> : <PairingSteps />}
              </ol>
            )}
          </EmptyContent>
        </Empty>
      </div>
    </SidebarInset>
  );
}

function T3ConnectSteps() {
  const { isLoaded, isSignedIn } = useAuth();
  // Adding the first computer unmounts this screen. Wait for all health checks
  // so every compatible registration is queued before that happens.
  const [autoAddedComputers] = useState(() => new Set<MachineId>());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<MachineId>>(() => new Set());
  const discovered = [...useRelayMachineDiscovery().machines.values()];
  const discoverySettled =
    discovered.length > 0 && discovered.every(({ availability }) => availability !== "checking");
  return (
    <>
      <SetupStep number={1}>
        {isSignedIn ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <CheckIcon className="size-4" />
            Signed in
          </p>
        ) : (
          <Button size="sm" disabled={!isLoaded} onClick={() => startAccountSignIn()}>
            Sign in
          </Button>
        )}
      </SetupStep>
      <SetupStep number={2}>
        <RunOnComputer command={`npx ${NPM_LAUNCHER_PACKAGE_NAME} connect`} />
        {isSignedIn ? (
          <div className="mt-4 space-y-1.5">
            <CloudMachineConnectRows
              primaryMachineId={null}
              savedMachines={[]}
              refreshWhileEmpty
              selection={{
                ...(discoverySettled ? { autoSelectedComputers: autoAddedComputers } : {}),
                selectedIds,
                onChange: (machineId, selected) =>
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (selected) next.add(machineId);
                    else next.delete(machineId);
                    return next;
                  }),
              }}
              empty={<p className="text-xs text-muted-foreground">Waiting for your computer…</p>}
            />
          </div>
        ) : null}
      </SetupStep>
    </>
  );
}

function PairingSteps() {
  return (
    <>
      <SetupStep number={1}>
        <RunOnComputer command={`npx ${NPM_LAUNCHER_PACKAGE_NAME} pair`} />
      </SetupStep>
      <SetupStep number={2}>
        <Button render={<Link to="/settings/connections" />} size="sm">
          Add pairing link
        </Button>
      </SetupStep>
    </>
  );
}

function SetupStep({
  number,
  children,
}: {
  readonly number: number;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="w-2 shrink-0 pt-1 text-muted-foreground">{number}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function RunOnComputer({ command }: { readonly command: string }) {
  return (
    <>
      <p>Run on your computer:</p>
      <CommandBlock command={command} className="mt-2" />
      <a
        className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        Or download the desktop app
      </a>
    </>
  );
}
