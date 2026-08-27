import { GaugeIcon, LoaderIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import {
  parseCodexBankedResetCount,
  parseCodexLimitMessage,
  resolveCodexAccountLabel,
  type ParsedCodexLimitWindow,
} from "./SidebarCodexLimitsPopover.logic";

interface CodexLimitEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly accountLabel: string;
  readonly provider: ServerProvider;
  readonly windows: ReadonlyArray<ParsedCodexLimitWindow>;
  readonly bankedResetCount: number | null;
}

interface ResetAttemptState {
  readonly idempotencyKey: string;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly message: string | null;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function resetAttemptKey(entry: CodexLimitEntry): string {
  return `${entry.environmentId}:${entry.provider.instanceId}`;
}

function resetOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "reset":
      return "Banked reset applied. Limits are refreshing.";
    case "nothingToReset":
      return "No active limit needed resetting, so no banked reset was used.";
    case "noCredit":
      return "Codex reports that no banked reset is available.";
    case "alreadyRedeemed":
      return "This redemption attempt was already applied. Limits are refreshing.";
    default:
      return "Codex returned an unknown reset result. Refresh limits before trying again.";
  }
}

function CodexLimitWindowRow({ window }: { readonly window: ParsedCodexLimitWindow }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className="shrink-0 font-mono tabular-nums text-foreground/85">
          {formatPercent(window.remainingPercent)}% left
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${window.label} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.remainingPercent}
      >
        <div
          className="h-full rounded-full bg-foreground/65 transition-[width] duration-300"
          style={{ width: `${window.remainingPercent}%` }}
        />
      </div>
      <div className="min-h-4 text-[11px] text-muted-foreground">
        {window.resetText ? `Resets ${window.resetText}` : "Reset time unavailable"}
      </div>
    </div>
  );
}

function CodexLimitProviderCard({
  entry,
  showEnvironment,
  resetAttempt,
  onUseReset,
}: {
  readonly entry: CodexLimitEntry;
  readonly showEnvironment: boolean;
  readonly resetAttempt: ResetAttemptState | undefined;
  readonly onUseReset: (entry: CodexLimitEntry) => void;
}) {
  const { provider, windows } = entry;
  const displayName = entry.accountLabel;
  const instanceDetail =
    String(provider.instanceId) !== String(provider.driver) ? String(provider.instanceId) : null;
  const planLabel = provider.auth.label ?? provider.auth.type ?? null;
  const canUseReset = (entry.bankedResetCount ?? 0) > 0;

  return (
    <section className="grid gap-3 rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={displayName}
          accentColor={provider.accentColor}
          showBadge={Boolean(provider.accentColor)}
          className="size-5"
          iconClassName="size-4"
          badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-[7px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
            {instanceDetail ? (
              <code className="truncate rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">
                {instanceDetail}
              </code>
            ) : null}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {[planLabel, showEnvironment ? entry.environmentLabel : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>

      {windows.length > 0 ? (
        <div className="grid gap-3">
          {windows.map((window) => (
            <CodexLimitWindowRow
              key={`${window.label}:${window.resetText ?? "none"}`}
              window={window}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          Subscription limits are unavailable for this account right now.
        </div>
      )}

      {entry.bankedResetCount !== null ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2.5">
          <div className="text-[11px] text-muted-foreground">
            Banked resets:{" "}
            <span className="font-mono text-foreground/85">{entry.bankedResetCount}</span>
          </div>
          {canUseReset ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={resetAttempt?.pending === true}
              onClick={() => onUseReset(entry)}
            >
              {resetAttempt?.pending ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <RotateCcwIcon className="size-3.5" />
              )}
              {resetAttempt?.failed ? "Retry reset" : "Use reset"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {resetAttempt?.message ? (
        <div
          className={`rounded-md px-2.5 py-2 text-[11px] ${
            resetAttempt.failed
              ? "bg-destructive/10 text-destructive"
              : "bg-muted/40 text-muted-foreground"
          }`}
        >
          {resetAttempt.message}
        </div>
      ) : null}
    </section>
  );
}

export function SidebarCodexLimitsPopover() {
  const { environments } = useEnvironments();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const consumeRateLimitResetCredit = useAtomCommand(
    serverEnvironment.consumeRateLimitResetCredit,
    { reportFailure: false },
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resetAttempts, setResetAttempts] = useState<Readonly<Record<string, ResetAttemptState>>>(
    {},
  );

  const entries = useMemo<ReadonlyArray<CodexLimitEntry>>(() => {
    const discovered = environments.flatMap((environment) =>
      (environment.serverConfig?.providers ?? []).flatMap((provider) =>
        String(provider.driver) === "codex"
          ? [
              {
                environmentId: environment.environmentId,
                environmentLabel: environment.label,
                provider,
                windows: parseCodexLimitMessage(provider.message),
                bankedResetCount: parseCodexBankedResetCount(provider.message),
              },
            ]
          : [],
      ),
    );

    return discovered.map((entry, ordinal) => ({
      ...entry,
      accountLabel: resolveCodexAccountLabel({
        displayName: entry.provider.displayName,
        ordinal,
        accountCount: discovered.length,
      }),
    }));
  }, [environments]);

  const environmentIds = useMemo(
    () => [...new Set(entries.map((entry) => entry.environmentId))],
    [entries],
  );
  const showEnvironment = environmentIds.length > 1;

  const refresh = useCallback(() => {
    if (isRefreshing || environmentIds.length === 0) return;
    setIsRefreshing(true);
    void Promise.all(
      environmentIds.map((environmentId) => refreshProviders({ environmentId, input: {} })),
    ).finally(() => setIsRefreshing(false));
  }, [environmentIds, isRefreshing, refreshProviders]);

  const useReset = useCallback(
    (entry: CodexLimitEntry) => {
      const targetKey = resetAttemptKey(entry);
      const previousAttempt = resetAttempts[targetKey];
      if (previousAttempt?.pending) return;

      const confirmed = window.confirm(
        `Use one banked Codex reset for ${entry.accountLabel}?\n\n` +
          "This asks Codex to redeem one earned reset for this exact account. " +
          "If no active limit needs resetting, Codex reports that without using a credit.",
      );
      if (!confirmed) return;

      // A failed transport/RPC attempt keeps its UUID so a retry cannot redeem
      // a second credit if the first response was merely lost after redemption.
      const idempotencyKey =
        previousAttempt?.failed === true
          ? previousAttempt.idempotencyKey
          : `quota-reset:${Effect.runSync(Random.next).toString(36).slice(2)}`;
      setResetAttempts((current) => ({
        ...current,
        [targetKey]: {
          idempotencyKey,
          pending: true,
          failed: false,
          message: null,
        },
      }));

      void consumeRateLimitResetCredit({
        environmentId: entry.environmentId,
        input: {
          instanceId: entry.provider.instanceId,
          idempotencyKey,
        },
      }).then((settled) => {
        const result = Option.getOrNull(AsyncResult.value(settled));
        if (result === null) {
          setResetAttempts((current) => ({
            ...current,
            [targetKey]: {
              idempotencyKey,
              pending: false,
              failed: true,
              message:
                "Reset request failed. Retry will reuse the same redemption attempt for safety.",
            },
          }));
          return;
        }

        setResetAttempts((current) => ({
          ...current,
          [targetKey]: {
            idempotencyKey,
            pending: false,
            failed: false,
            message: resetOutcomeMessage(result.outcome),
          },
        }));
      });
    },
    [consumeRateLimitResetCredit, resetAttempts],
  );

  if (entries.length === 0) return null;

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              aria-label="Codex subscription limits"
              title="Codex subscription limits"
              size="icon"
            />
          }
        >
          <GaugeIcon />
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="start"
          sideOffset={8}
          className="w-[min(22rem,calc(100vw-1rem))]"
          viewportClassName="p-3!"
        >
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3 px-0.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">Codex limits</div>
                <div className="text-[11px] text-muted-foreground">
                  ChatGPT subscription windows across configured accounts
                </div>
              </div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                disabled={isRefreshing}
                onClick={refresh}
                aria-label="Refresh Codex subscription limits"
                title="Refresh limits"
              >
                {isRefreshing ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3.5" />
                )}
              </Button>
            </div>

            <div className="grid gap-2">
              {entries.map((entry) => (
                <CodexLimitProviderCard
                  key={`${entry.environmentId}:${entry.provider.instanceId}`}
                  entry={entry}
                  showEnvironment={showEnvironment}
                  resetAttempt={resetAttempts[resetAttemptKey(entry)]}
                  onUseReset={useReset}
                />
              ))}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
