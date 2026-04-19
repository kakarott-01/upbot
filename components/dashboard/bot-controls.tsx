"use client";

import { memo, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBotStatusQuery } from "@/lib/use-bot-status-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  AlertTriangle,
  Loader2,
  Power,
  Square,
} from "lucide-react";
import {
  BotControlsModals,
  type BotControlsModalsRef,
} from "@/components/dashboard/bot-controls-modals";
import { useActionLocks } from "@/components/dashboard/bot-controls/useActionLocks";
import { useBotControlMutations } from "@/components/dashboard/bot-controls/useBotControlMutations";
import MarketRow from "@/components/dashboard/bot-controls/MarketRow";
import { POLL_INTERVALS } from "@/lib/polling-config";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToastStore } from "@/lib/toast-store";
import { apiFetch } from "@/lib/api-client";

const MARKETS = [
  { id: "crypto", label: "Crypto", shortLabel: "Crypto" },
  { id: "indian", label: "Indian", shortLabel: "Indian" },
  { id: "global", label: "Forex", shortLabel: "Forex" },
  { id: "commodities", label: "Commodities", shortLabel: "Commodities" },
] as const;

// Modal UI moved to BotControlsModals to avoid re-rendering the entire controls

type MarketId = (typeof MARKETS)[number]["id"];

type SessionItem = {
  market: string;
  status: "running" | "stopping" | "stopped" | "error";
};

type ModeDataResponse = {
  markets?: Array<{ marketType: MarketId; mode: "paper" | "live" }>;
};

type StrategyConfigDataResponse = {
  markets?: Array<{
    marketType: MarketId;
    strategyKeys?: string[];
    conflictWarnings?: Array<{ message: string }>;
  }>;
};

// StopAllModal moved to components/modals and lazy-loaded

// StartMarketModal moved to components/modals and lazy-loaded

// MarketStopModal moved to components/modals and lazy-loaded

// ── Main component ────────────────────────────────────────────────────────────
export const BotControls = memo(function BotControls() {
  const pushToast = useToastStore((s) => s.push);
  const modalsRef = useRef<BotControlsModalsRef | null>(null);
  const { lockAction, unlockAction, isLocked } = useActionLocks();

  const { data, dataUpdatedAt } = useBotStatusQuery({
    select: (snapshot) => ({
      status: snapshot.status,
      openTradeCount: snapshot.openTradeCount,
      sessions: snapshot.sessions.map((session) => ({
        market: session.market,
        status: session.status,
      })),
      activeMarkets: snapshot.activeMarkets,
      errorMessage: snapshot.errorMessage,
      perMarketOpenTrades: snapshot.perMarketOpenTrades,
    }),
  });

  const { data: modeData } = useQuery({
    queryKey: QUERY_KEYS.MARKET_MODES,
    queryFn: () => apiFetch<ModeDataResponse>("/api/mode"),
    staleTime: POLL_INTERVALS.MARKET_MODES,
  });

  const { data: strategyConfigData } = useQuery({
    queryKey: QUERY_KEYS.STRATEGY_CONFIGS,
    queryFn: () => apiFetch<StrategyConfigDataResponse>("/api/strategy-config"),
    select: (d) => d,
    staleTime: POLL_INTERVALS.STRATEGY,
  });

  const status: string = data?.status ?? "stopped";
  const openTradeCount: number = data?.openTradeCount ?? 0;
  // FIX: Stable empty arrays — don't use ?? [] inline
  const sessions: SessionItem[] = useMemo(() => data?.sessions ?? [], [data?.sessions]);
  const activeMarkets: string[] = useMemo(() => data?.activeMarkets ?? [], [data?.activeMarkets]);
  const botErrorMessage: string | null = data?.errorMessage ?? null;
  const isStopping = status === "stopping";

  const perMarketOpenTrades: Record<string, number> =
    data?.perMarketOpenTrades ?? {};

  const hasLiveMarkets = (modeData?.markets ?? []).some(
    (m: any) => m.mode === "live" && activeMarkets.includes(m.marketType),
  );

  // FIX: Stable memo — sessions reference only changes when actual data changes
  const sessionByMarket = useMemo(
    () => new Map(sessions.map((s) => [s.market, s])),
    [sessions],
  );

  // FIX: Stable memo for configByMarket
  const strategyMarkets = strategyConfigData?.markets;
  const configByMarket = useMemo(
    () => new Map((strategyMarkets ?? []).map((m: any) => [m.marketType, m])),
    [strategyMarkets],
  );

  const { syncMutation, stopAllMutation, stopMarketMutation } =
    useBotControlMutations({
      modalsRef,
      unlockAction,
      pushToast,
    });

  const isStarting = syncMutation.isPending && status !== "running";

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function isMarketLive(marketId: MarketId): boolean {
    const market = (modeData?.markets ?? []).find(
      (m: any) => m.marketType === marketId,
    );
    return market?.mode === "live";
  }

  function marketOpenTrades(marketId: MarketId): number {
    return perMarketOpenTrades[marketId] ?? 0;
  }

  const marketWarningsMap = useMemo(() => {
    return new Map(MARKETS.map((m) => {
      const cfg = configByMarket.get(m.id) as any;
      return [m.id, (cfg?.conflictWarnings ?? []).map((w: any) => w.message)];
    }));
  }, [configByMarket]);

  // ── Click handler ────────────────────────────────────────────────────────────

  const handleMarketClick = useCallback(
    (marketId: string) => {
      if (
        syncMutation.isPending ||
        stopAllMutation.isPending ||
        stopMarketMutation.isPending ||
        isStopping
      )
        return;

      const isActive = activeMarkets.includes(marketId);

      if (isActive) {
        modalsRef.current?.openStopModal?.(marketId as MarketId);
      } else {
        modalsRef.current?.openStartModal?.(marketId as MarketId);
      }
    },
    [
      syncMutation.isPending,
      stopAllMutation.isPending,
      stopMarketMutation.isPending,
      isStopping,
      activeMarkets,
    ],
  );

  function confirmStart(marketId: MarketId) {
    const actionId = `start-market:${marketId}`;
    if (isLocked(actionId)) return;
    lockAction(actionId);
    const nextMarkets = [...activeMarkets, marketId];
    syncMutation.mutate({ markets: nextMarkets });
  }

  function confirmMarketStop(
    marketId: MarketId,
    mode: "graceful" | "close_all",
  ) {
    const actionId = `stop-market:${marketId}`;
    if (isLocked(actionId)) return;
    lockAction(actionId);
    stopMarketMutation.mutate({ marketType: marketId, mode });
  }

  function handleStopAll(mode: "graceful" | "close_all") {
    const actionId = `stop-all:${mode}`;
    if (isLocked(actionId)) return;
    lockAction(actionId);
    stopAllMutation.mutate(mode);
  }

  const ALL_MARKETS = MARKETS;

  return (
    <>
      <BotControlsModals
        ref={modalsRef}
        confirmStart={confirmStart}
        confirmMarketStop={confirmMarketStop}
        handleStopAll={handleStopAll}
      />

      <div className="surface-panel w-full max-w-md p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Bot Status
            </p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge
                tone={
                  isStarting
                    ? "info"
                    : status === "running"
                      ? "success"
                      : status === "stopping"
                        ? "warning"
                        : status === "error"
                          ? "danger"
                          : "neutral"
                }
              >
                {isStarting ? "STARTING" : status.toUpperCase()}
              </StatusBadge>
              <span className="text-xs text-gray-500">
                {activeMarkets.length} active market
                {activeMarkets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {dataUpdatedAt
                ? `Last updated: ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : "Last updated: -"}
            </div>
          </div>
          <StatusBadge tone={hasLiveMarkets ? "danger" : "info"}>
            {hasLiveMarkets ? "Live capital at risk" : "Paper mode only"}
          </StatusBadge>
        </div>

        <div className="mt-4 space-y-2">
          {ALL_MARKETS.map((market) => {
            const session = sessionByMarket.get(market.id);
            const isActive = activeMarkets.includes(market.id);
            const config = configByMarket.get(market.id) as any;
            const warnings = marketWarningsMap.get(market.id) ?? [];
            const isLive = isMarketLive(market.id);
            const openTrades = marketOpenTrades(market.id);

            const isThisMarketMutating =
              stopMarketMutation.isPending &&
              stopMarketMutation.variables?.marketType === market.id;
            const hasStrategies = (config?.strategyKeys ?? []).length > 0;
            const disabled =
              isStopping ||
              !hasStrategies ||
              stopAllMutation.isPending ||
              isThisMarketMutating;

            return (
              <MarketRow
                key={market.id}
                market={market}
                session={session}
                isActive={isActive}
                config={config}
                warnings={warnings}
                isLive={isLive}
                openTrades={openTrades}
                isThisMarketMutating={isThisMarketMutating}
                disabled={disabled}
                onClick={handleMarketClick}
              />
            );
          })}
        </div>

        {botErrorMessage && (
          <InlineAlert tone="danger" title="Bot error" className="mt-4">
            {botErrorMessage}
          </InlineAlert>
        )}

        {!activeMarkets.length && !isStopping && (
          <InlineAlert tone="info" title="No markets running" className="mt-4">
            Click any market to start it. Each market runs independently — you
            can start and stop them one at a time.
          </InlineAlert>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            {openTradeCount > 0
              ? `${openTradeCount} open trade${openTradeCount === 1 ? "" : "s"} across active sessions`
              : "No open trades"}
          </div>
          <Button
            variant="danger"
            className="min-w-[8.5rem]"
            disabled={
              stopAllMutation.isPending ||
              syncMutation.isPending ||
              (!activeMarkets.length && !openTradeCount)
            }
            onClick={() => modalsRef.current?.openStopAll?.()}
          >
            {stopAllMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Stopping…
              </>
            ) : (
              <>
                <Square className="h-4 w-4" />
                Stop All
              </>
            )}
          </Button>
        </div>

        {isStopping && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <Power className="h-3.5 w-3.5" />
            Graceful stop is in progress. Market toggles are temporarily locked.
          </div>
        )}

        {(strategyConfigData?.markets ?? []).some(
          (m: any) => m.executionMode === "AGGRESSIVE",
        ) && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            At least one market is configured for AGGRESSIVE mode. Capital is
            managed per strategy and lower-priority entries can be blocked when
            exposure tightens.
          </div>
        )}
      </div>
    </>
  );
});

BotControls.displayName = "BotControls";
