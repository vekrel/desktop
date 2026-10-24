import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopAccount from "../../app/DesktopAccount.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { getAccessToken, signOut, startSignIn } from "./account.ts";

const mainFrame = { url: "vekrel-dev://app/settings" };
const mainWindow = {
  isDestroyed: () => false,
  webContents: { id: 7, mainFrame },
};

describe("account IPC", () => {
  it.effect("answers only the main window's top frame on the app origin", () => {
    const calls: Array<string> = [];
    const call = (
      method: typeof getAccessToken,
      event: Parameters<(typeof getAccessToken)["handler"]>[1],
    ) => Effect.exit(method.handler(undefined, event));
    return Effect.gen(function* () {
      const refused = [
        undefined,
        { sender: { id: 8 }, senderFrame: mainFrame },
        { sender: { id: 7 } },
        { sender: { id: 7 }, senderFrame: null },
        // A subframe of the main window, even on the app origin.
        { sender: { id: 7 }, senderFrame: { url: "vekrel-dev://app/" } },
      ];
      for (const event of refused) {
        for (const method of [getAccessToken, startSignIn, signOut]) {
          assert.isTrue(Exit.isFailure(yield* call(method, event)));
        }
      }
      // The main frame after it navigated to another origin.
      const navigated = mainFrame.url;
      mainFrame.url = "https://evil.example/";
      assert.isTrue(
        Exit.isFailure(yield* call(getAccessToken, { sender: { id: 7 }, senderFrame: mainFrame })),
      );
      mainFrame.url = navigated;
      assert.deepEqual(calls, []);

      const trusted = { sender: { id: 7 }, senderFrame: mainFrame };
      assert.deepEqual(yield* call(getAccessToken, trusted), Exit.succeed("access-token"));
      assert.isTrue(Exit.isSuccess(yield* call(startSignIn, trusted)));
      assert.isTrue(Exit.isSuccess(yield* call(signOut, trusted)));
      assert.deepEqual(calls, ["getAccessToken", "startSignIn", "signOut"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
            isDevelopment: true,
          } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
          Layer.succeed(ElectronWindow.ElectronWindow, {
            main: Effect.succeed(Option.some(mainWindow)),
          } as unknown as ElectronWindow.ElectronWindow["Service"]),
          Layer.succeed(
            DesktopAccount.DesktopAccount,
            DesktopAccount.DesktopAccount.of({
              startSignIn: Effect.sync(() => void calls.push("startSignIn")),
              receiveCallback: () => false,
              getAccessToken: Effect.sync(() => {
                calls.push("getAccessToken");
                return "access-token";
              }),
              signOut: Effect.sync(() => void calls.push("signOut")),
            }),
          ),
        ),
      ),
    );
  });
});
