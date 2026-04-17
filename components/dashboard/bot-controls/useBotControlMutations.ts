"use client";

import type { RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BOT_STATUS_QUERY_KEY, isValidBotSnapshot, type BotStatusSnapshot } from "@/lib/bot-status-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { apiFetch } from "@/lib/api-client";
import type { ToastItem } from "@/lib/toast-store";
import type { BotControlsModalsRef } from "@/components/dashboard/bot-controls-modals";

type MarketId = "crypto" | "indian" | "global" | "commodities";

type StopMarketResponse = {
  stoppedMarket: MarketId;
  mode: "graceful" | "close_all";
  openPositionsClosed?: number;
};

type Args = {
  modalsRef: RefObject<BotControlsModalsRef | null>;
  unlockAction: (id: string) => void;
  pushToast: (toast: Omit<ToastItem, "id">) => void;
};

const MARKET_LABELS: Record<MarketId, string> = {
  crypto: "Crypto",
  indian: "Indian",
  global: "Forex",
  commodities: "Commodities",
};

function fallbackSnapshot(status: "running" | "stopping", stopMode: "graceful" | "close_all" | null = null): BotStatusSnapshot {
  return {
    status,
    stopMode,
    activeMarkets: [],
    started_at: null,
    stopped_at: null,
    stopping_at: null,
    last_heartbeat: null,
    errorMessage: null,
    openTradeCount: 0,
    perMarketOpenTrades: {},
    timeoutWarning: false,
    sessions: [],
  };
}

export function useBotControlMutations({ modalsRef, unlockAction, pushToast }: Args) {
  const qc = useQueryClient();

  const syncMutation = useMutation({
    mutationKey: ["bot-start"],
    mutationFn: ({ markets }: { markets: string[] }) =>
      apiFetch("/api/bot/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markets }),
      }),
    onMutate: async (vars: { markets: string[] }) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY);
      const optimisticStartedAt = new Date().toISOString();

      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = old && isValidBotSnapshot(old) ? old : (previous ?? fallbackSnapshot("running"));
        const nextActive = Array.from(new Set([...(base.activeMarkets ?? []), ...vars.markets]));
        return {
          ...base,
          status: "running",
          activeMarkets: nextActive,
          started_at: base.status === "running" || base.status === "stopping" ? (base.started_at ?? optimisticStartedAt) : optimisticStartedAt,
        };
      });

      pushToast({ tone: "success", title: `Starting ${vars.markets.join(", ")}...`, description: "Connecting to the bot engine." });
      return { previous };
    },
    onError: (err: Error, _vars, context: any) => {
      pushToast({ tone: "error", title: "Session update failed", description: err.message });
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous);
    },
    onSettled: async (_data, _err, vars: { markets: string[] } | undefined) => {
      vars?.markets.forEach((market) => unlockAction(`start-market:${market}`));
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.BOT_HISTORY() });
    },
  });

  const stopAllMutation = useMutation({
    mutationFn: (mode: "close_all" | "graceful") =>
      apiFetch("/api/bot/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }),
    onMutate: async (mode: "close_all" | "graceful") => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY);
      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = old && isValidBotSnapshot(old) ? old : (previous ?? fallbackSnapshot("stopping", mode));
        return { ...base, status: "stopping", stopMode: mode };
      });
      return { previous };
    },
    onError: (err: Error, _mode, context: any) => {
      pushToast({ tone: "error", title: "Stop request failed", description: err.message });
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous);
    },
    onSuccess: (_data, mode) => {
      pushToast({
        tone: mode === "close_all" ? "warning" : "success",
        title: mode === "close_all" ? "Emergency stop requested" : "Graceful drain started",
        description: mode === "close_all" ? "The engine is closing all open positions and stopping." : "No new trades will open while active positions are drained.",
      });
    },
    onSettled: async (_data, _err, mode: "close_all" | "graceful" | undefined) => {
      modalsRef.current?.closeAll?.();
      if (mode) unlockAction(`stop-all:${mode}`);
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.BOT_HISTORY() });
    },
  });

  const stopMarketMutation = useMutation({
    mutationFn: ({ marketType, mode }: { marketType: MarketId; mode: "graceful" | "close_all" }) =>
      apiFetch<StopMarketResponse>("/api/bot/stop-market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketType, mode }),
      }),
    onMutate: async (vars: { marketType: MarketId; mode: "graceful" | "close_all" }) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY);
      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = old && isValidBotSnapshot(old) ? old : (previous ?? fallbackSnapshot("running"));
        const activeMarkets = (base.activeMarkets ?? []).filter((market) => market !== vars.marketType);
        return { ...base, status: activeMarkets.length > 0 ? base.status : "stopping", activeMarkets };
      });
      return { previous };
    },
    onError: (err: Error, vars, context: any) => {
      pushToast({ tone: "error", title: `Failed to stop ${vars.marketType}`, description: err.message });
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous);
    },
    onSuccess: (data: StopMarketResponse) => {
      const label = MARKET_LABELS[data.stoppedMarket] ?? data.stoppedMarket;
      pushToast({
        tone: data.mode === "close_all" ? "warning" : "success",
        title: data.mode === "close_all" ? `${label} - closing positions` : `${label} drained`,
        description: data.mode === "close_all" ? `Closing ${data.openPositionsClosed} position${data.openPositionsClosed !== 1 ? "s" : ""}.` : "Market stopped, existing positions remain open.",
      });
    },
    onSettled: async (_data, _err, vars: { marketType: MarketId } | undefined) => {
      if (vars) unlockAction(`stop-market:${vars.marketType}`);
      modalsRef.current?.closeStopModal?.();
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.BOT_HISTORY() });
    },
  });

  return { syncMutation, stopAllMutation, stopMarketMutation };
}
