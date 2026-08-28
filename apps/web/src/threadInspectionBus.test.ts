import { describe, expect, it } from "vite-plus/test";

import {
  publishThreadDisclosureCommand,
  subscribeThreadDisclosureCommands,
  type ThreadInspectionDisclosureCommand,
} from "./threadInspectionBus";

describe("thread inspection disclosure bus", () => {
  it("scopes commands by thread and stops delivering after unsubscribe", () => {
    const receivedA: ThreadInspectionDisclosureCommand[] = [];
    const receivedB: ThreadInspectionDisclosureCommand[] = [];
    const unsubscribeA = subscribeThreadDisclosureCommands("env-a:thread-a", (command) => {
      receivedA.push(command);
    });
    const unsubscribeB = subscribeThreadDisclosureCommands("env-a:thread-b", (command) => {
      receivedB.push(command);
    });

    publishThreadDisclosureCommand("env-a:thread-a", "expand-all");
    publishThreadDisclosureCommand("env-a:thread-b", "collapse-all");

    expect(receivedA).toEqual(["expand-all"]);
    expect(receivedB).toEqual(["collapse-all"]);

    unsubscribeA();
    publishThreadDisclosureCommand("env-a:thread-a", "collapse-all");
    expect(receivedA).toEqual(["expand-all"]);

    unsubscribeB();
  });
});
