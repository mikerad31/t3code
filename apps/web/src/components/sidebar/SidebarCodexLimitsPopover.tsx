import { GaugeIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import {
  parseCodexLimitMessage,
  type ParsedCodexLimitWindow,
} from "./SidebarCodexLimitsPopover.logic";

interface CodexLimitEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly provider: ServerProvider;
  readonly windows: ReadonlyArray<ParsedCodexLimitWindow>;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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
}: {
  readonly entry: CodexLimitEntry;
  readonly showEnvironment: boolean;
}) {
  const { provider, windows } = entry;
  const displayName = provider.displayName?.trim() || String(provider.instanceId);
  const instanceDetail =
    String(provider.instanceId) !== String(provider.driver) ? String(provider.instanceId) : null;
  const planLabel = provider.auth.label ?? provider.auth.type ?? null;

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
            {[planLabel, showEnvironment ? entry.environmentLabel : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {windows.length > 0 ? (
        <div className="grid gap-3">
          {windows.map((window) => (
            <CodexLimitWindowRow key={`${window.label}:${window.resetText ?? "none"}`} window={window} />
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          Subscription limits are unavailable for this account right now.
        </div>
      )}
    </section>
  );
}

export function SidebarCodexLimitsPopover() {
  const { environments } = useEnvironments();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const entries = useMemo<ReadonlyArray<CodexLimitEntry>>(
    () =>
      environments.flatMap((environment) =>
        (environment.serverConfig?.providers ?? []).flatMap((provider) =>
          String(provider.driver) === "codex"
            ? [
                {
                  environmentId: environment.environmentId,
                  environmentLabel: environment.label,
                  provider,
                  windows: parseCodexLimitMessage(provider.message),
                },
              ]
            : [],
        ),
      ),
    [environments],
  );

  const environmentIds = useMemo(
    () => [...new Set(entries.map((entry) => entry.environmentId))],
    [entries],
  );
  const showEnvironment = environmentIds.length > 1;

  const refresh = useCallback(() => {
    if (isRefreshing || environmentIds.length === 0) return;
    setIsRefreshing(true);
    void Promise.all(
      environmentIds.map((environmentId) =>
        refreshProviders({ environmentId, input: {} }),
      ),
    ).finally(() => setIsRefreshing(false));
  }, [environmentIds, isRefreshing, refreshProviders]);

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
                />
              ))}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
