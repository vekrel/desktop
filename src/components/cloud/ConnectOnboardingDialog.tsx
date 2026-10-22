import { useAuth } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import { AuthRelayReadScope, AuthRelayWriteScope, type AuthSessionState } from "@vekrel/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import {
  CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY,
  ConnectOnboardingOptOutSchema,
  EMPTY_CONNECT_ONBOARDING_OPT_OUT_STATE,
} from "~/cloud/connectOnboarding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useCloudLinkController } from "~/cloud/useCloudLinkController";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isHostedStaticApp } from "~/hostedPairing";
import {
  useMachines,
  usePrimaryMachine,
  usePrimaryMachineId,
} from "~/state/machines";
import { machineSession, readMachineScope, useMachineScope } from "~/state/session";
import { CloudMachineConnectRows } from "./CloudMachineConnectList";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";

export function ConnectOnboardingDialog() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredConnectOnboardingDialog />;
}

type OnboardingStep = "publish" | "devices";

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

function ConfiguredConnectOnboardingDialog() {
  // Mirrors ManagedRelayAuthProvider: a pending Clerk session must not read as
  // signed-out, or its later activation would look like a fresh sign-in.
  const { isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const [optOutState, setOptOutState] = useLocalStorage(
    CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY,
    EMPTY_CONNECT_ONBOARDING_OPT_OUT_STATE,
    ConnectOnboardingOptOutSchema,
  );

  const { machines, isReady: machinesReady } = useMachines();
  // The empty hosted home already adds account computers after sign-in.
  const homeScreenAddsComputers =
    isHostedStaticApp() && machinesReady && machines.length === 0;
  const primaryMachineId = usePrimaryMachineId();
  const primarySessionState = useAtomValue(
    primaryMachineId === null
      ? EMPTY_SESSION_STATE_ATOM
      : machineSession.sessionStateAtom(primaryMachineId),
  );
  const canReadRelay = useMachineScope(primaryMachineId, AuthRelayReadScope);
  const canWriteRelay = useMachineScope(primaryMachineId, AuthRelayWriteScope);
  const canManageRelay = canReadRelay && canWriteRelay;
  const sessionScopesKnown =
    primaryMachineId === null ? machinesReady : primarySessionState._tag !== "Initial";

  const controller = useCloudLinkController();
  const showPublishStep = canManageRelay && controller.linkState.target !== null;
  const steps: ReadonlyArray<OnboardingStep> = showPublishStep
    ? ["publish", "devices"]
    : ["devices"];

  const [requestedAccount, setRequestedAccount] = useState<string | null>(null);
  const [openForAccount, setOpenForAccount] = useState<string | null>(null);
  const [step, setStep] = useState<OnboardingStep>("devices");
  const [exposeMachine, setExposeMachine] = useState(true);
  const [publishAgentActivity, setPublishAgentActivity] = useState(true);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [prefilledFromLinkState, setPrefilledFromLinkState] = useState(false);
  // undefined until auth first settles, so the account already signed in at load
  // never reads as a fresh sign-in.
  const [observedAccount, setObservedAccount] = useState<string | null | undefined>(undefined);

  if (step === "publish" && sessionScopesKnown && !showPublishStep && !isApplying) {
    setStep("devices");
  }

  const optOutAccounts = optOutState.optOutAccounts;

  // A loaded-but-incomplete snapshot (signed in, user id not yet populated)
  // must not be recorded as signed-out — the next render would then look
  // like a fresh sign-in on a cold load.
  if (isLoaded && !(isSignedIn && !userId)) {
    const nextAccount = isSignedIn && userId ? userId : null;
    if (nextAccount !== observedAccount) {
      setObservedAccount(nextAccount);
      if (observedAccount !== undefined && nextAccount !== null) {
        setRequestedAccount(nextAccount);
      }
    }
  }

  if (openForAccount !== null && (!isSignedIn || userId !== openForAccount)) {
    setOpenForAccount(null);
  }
  if (requestedAccount !== null && (!isSignedIn || userId !== requestedAccount)) {
    setRequestedAccount(null);
  }

  // A manageable session implies a primary machine, so when the scopes
  // allow publishing, wait for the connection target too — otherwise the
  // wizard could open on the devices step moments before the publish step
  // becomes available and freeze there.
  const publishStepDecided = !canManageRelay || controller.linkState.target !== null;

  if (requestedAccount !== null && openForAccount === null) {
    if (homeScreenAddsComputers || optOutAccounts.includes(requestedAccount)) {
      setRequestedAccount(null);
    } else if (sessionScopesKnown && publishStepDecided) {
      setRequestedAccount(null);
      setPrefilledFromLinkState(false);
      setExposeMachine(true);
      setPublishAgentActivity(true);
      setDontShowAgain(false);
      setStep(canManageRelay && controller.linkState.target !== null ? "publish" : "devices");
      setOpenForAccount(requestedAccount);
    }
  }

  const linkStateData = controller.linkState.data;
  if (openForAccount !== null && !prefilledFromLinkState && linkStateData !== null) {
    setPrefilledFromLinkState(true);
    if (
      linkStateData.linked &&
      linkStateData.linkRevoked !== true &&
      linkStateData.cloudUserId === openForAccount
    ) {
      setExposeMachine(linkStateData.managedTunnelActive ?? linkStateData.linked);
      setPublishAgentActivity(linkStateData.publishAgentActivity);
    }
  }

  const complete = () => {
    if (isApplying) return;
    const account = openForAccount;
    setOpenForAccount(null);
    if (account !== null && dontShowAgain) {
      setOptOutState((state) =>
        state.optOutAccounts.includes(account)
          ? state
          : { optOutAccounts: [...state.optOutAccounts, account] },
      );
    }
  };

  const applyPublishSelection = async () => {
    if (isApplying) return;
    if (
      primaryMachineId === null ||
      !readMachineScope(primaryMachineId, AuthRelayReadScope) ||
      !readMachineScope(primaryMachineId, AuthRelayWriteScope)
    ) {
      setStep("devices");
      return;
    }
    if (linkStateData === null || controller.linkState.error !== null) return;
    // The wizard only ever enables — with both toggles off there is nothing to
    // apply, and an existing link must not be torn down from onboarding.
    if (!exposeMachine && !publishAgentActivity) {
      setStep("devices");
      return;
    }
    setIsApplying(true);
    const ok = await controller.reconcileCloudState({
      managedTunnel: exposeMachine,
      publish: publishAgentActivity,
    });
    setIsApplying(false);
    if (!ok) return;
    toastManager.add({
      type: "success",
      title: "T3 Connect enabled",
      description: exposeMachine
        ? "This machine is available to your other devices through T3 Connect."
        : "This machine publishes agent activity to your mobile clients.",
    });
    setStep("devices");
  };

  return (
    <Dialog
      open={openForAccount !== null}
      onOpenChange={(open) => {
        if (!open && !isApplying) complete();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title="Set up T3 Connect"
          description={
            <>
              Mesh your devices together — publish this machine and connect the rest, all in one
              place.
            </>
          }
        >
          {steps.length > 1 ? (
            <WizardSteps
              steps={steps.map((id) => STEP_LABELS[id])}
              currentStep={steps.indexOf(step)}
              isStepDisabled={() => isApplying}
              onStepChange={(index) => {
                const next = steps[index];
                if (
                  next === "publish" &&
                  (primaryMachineId === null ||
                    !readMachineScope(primaryMachineId, AuthRelayReadScope) ||
                    !readMachineScope(primaryMachineId, AuthRelayWriteScope))
                )
                  return;
                if (next) setStep(next);
              }}
            />
          ) : null}
        </WizardHeader>
        <WizardPanel>
          {step === "publish" ? (
            <PublishStep
              exposeMachine={exposeMachine}
              publishAgentActivity={publishAgentActivity}
              disabled={isApplying || !canManageRelay || linkStateData === null}
              operationError={controller.operationError ?? controller.linkState.error}
              onExposeMachineChange={(enabled) => {
                if (
                  primaryMachineId !== null &&
                  readMachineScope(primaryMachineId, AuthRelayReadScope) &&
                  readMachineScope(primaryMachineId, AuthRelayWriteScope)
                )
                  setExposeMachine(enabled);
              }}
              onPublishAgentActivityChange={(enabled) => {
                if (
                  primaryMachineId !== null &&
                  readMachineScope(primaryMachineId, AuthRelayReadScope) &&
                  readMachineScope(primaryMachineId, AuthRelayWriteScope)
                )
                  setPublishAgentActivity(enabled);
              }}
            />
          ) : (
            <DevicesStep />
          )}
        </WizardPanel>
        <WizardFooter
          leading={
            <label className="flex cursor-pointer items-center gap-2 self-start text-xs text-muted-foreground sm:self-center">
              <Checkbox
                checked={dontShowAgain}
                onCheckedChange={(checked) => setDontShowAgain(checked === true)}
              />
              Don&apos;t show this again
            </label>
          }
        >
          {step === "publish" ? (
            <>
              <Button variant="ghost" disabled={isApplying} onClick={() => setStep("devices")}>
                Not now
              </Button>
              <Button
                disabled={isApplying || !canManageRelay || linkStateData === null}
                onClick={() => void applyPublishSelection()}
              >
                {isApplying ? "Enabling…" : "Continue"}
              </Button>
            </>
          ) : (
            <Button disabled={isApplying} onClick={complete}>
              Done
            </Button>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

const STEP_LABELS: Record<OnboardingStep, string> = {
  publish: "Publish",
  devices: "Connect devices",
};

function PublishStep({
  exposeMachine,
  publishAgentActivity,
  disabled,
  operationError,
  onExposeMachineChange,
  onPublishAgentActivityChange,
}: {
  readonly exposeMachine: boolean;
  readonly publishAgentActivity: boolean;
  readonly disabled: boolean;
  readonly operationError: string | null;
  readonly onExposeMachineChange: (enabled: boolean) => void;
  readonly onPublishAgentActivityChange: (enabled: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <OnboardingToggleRow
          title="Publish this machine"
          description="Make this machine available to your other devices through T3 Connect."
          checked={exposeMachine}
          disabled={disabled}
          onCheckedChange={onExposeMachineChange}
        />
        <OnboardingToggleRow
          title="Publish agent activity"
          description="Send activity from this machine to your mobile clients for push notifications and Live Activities."
          checked={publishAgentActivity}
          disabled={disabled}
          onCheckedChange={onPublishAgentActivityChange}
        />
      </div>
      {operationError ? <p className="text-xs text-destructive">{operationError}</p> : null}
    </div>
  );
}

function OnboardingToggleRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onCheckedChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/60 px-4 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function DevicesStep() {
  const { machines } = useMachines();
  const primaryMachine = usePrimaryMachine();
  const savedMachines = machines.filter(
    (machine) => machine.entry.target._tag !== "PrimaryConnectionTarget",
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <CloudMachineConnectRows
        primaryMachineId={primaryMachine?.machineId ?? null}
        savedMachines={savedMachines}
        showSavedMachines
        empty={
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No other machines are published to your account yet. Publish one from another device
            and it will show up here.
          </p>
        }
      />
    </div>
  );
}
