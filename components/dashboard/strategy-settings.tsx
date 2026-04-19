"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers3, Loader2 } from "lucide-react";
import { BOT_STATUS_QUERY_KEY, isValidBotSnapshot } from "@/lib/bot-status-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { apiFetch } from "@/lib/api-client";
import { useToastStore } from "@/lib/toast-store";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import MarketSection from "@/components/dashboard/strategy-settings/MarketSection";
import { configFromMarket, createDefaultConfig, defaultStrategySettings, RuntimeConfig, toStrategyPayload } from "@/components/dashboard/strategy-settings/helpers";
import { useStrategySettings } from "@/components/dashboard/strategy-settings/useStrategySettings";

const AggressiveModeModal = dynamic(() => import("@/components/modals/aggressive-mode-modal"), { ssr: false });

const MARKETS = [
  { id: "crypto", label: "Crypto", publicLabel: "CRYPTO" },
  { id: "indian", label: "Indian", publicLabel: "STOCKS" },
  { id: "global", label: "Forex", publicLabel: "STOCKS" },
  { id: "commodities", label: "Commodities", publicLabel: "FOREX" },
] as const;

type MarketId = (typeof MARKETS)[number]["id"];
const DEFAULT_CONFIGS: Record<MarketId, RuntimeConfig> = {
  crypto: createDefaultConfig(),
  indian: createDefaultConfig(),
  global: createDefaultConfig(),
  commodities: createDefaultConfig(),
};
const EMPTY_OVERRIDES: Record<MarketId, RuntimeConfig | null> = {
  crypto: null,
  indian: null,
  global: null,
  commodities: null,
};

function overrideReducer(
  state: Record<MarketId, RuntimeConfig | null>,
  action: { marketType: MarketId; value: RuntimeConfig | null },
) {
  return { ...state, [action.marketType]: action.value };
}

export function StrategySettings() {
  const qc = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [overrides, dispatchOverride] = useReducer(overrideReducer, EMPTY_OVERRIDES);
  const [savingMarket, setSavingMarket] = useState<string | null>(null);
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set());
  const [pendingAggressiveSave, setPendingAggressiveSave] = useState<null | { marketType: MarketId; config: RuntimeConfig }>(null);
  const { strategyData, strategiesLoading, configData, configsLoading, riskData, botData } = useStrategySettings();

  const serverConfigs = useMemo(() => Object.fromEntries((configData?.markets ?? []).map((market: any) => [market.marketType, configFromMarket(market)])), [configData]);
  const overridesRef = useRef(overrides);
  const serverConfigsRef = useRef(serverConfigs);
  useEffect(() => {
    overridesRef.current = overrides;
    serverConfigsRef.current = serverConfigs;
  }, [overrides, serverConfigs]);
  const setOverride = useCallback((marketType: MarketId, value: RuntimeConfig | null) => {
    dispatchOverride({ marketType, value });
  }, []);

  const saveMutation = useMutation({
    mutationFn: ({ marketType, config, aggressiveConfirmed }: { marketType: MarketId; config: RuntimeConfig; aggressiveConfirmed: boolean }) =>
      apiFetch("/api/strategy-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketType, aggressiveConfirmed, ...config, strategySettings: toStrategyPayload(config.strategySettings) }),
      }),
    onMutate: async ({ marketType }) => {
      setSavingMarket(marketType);
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY });
      await qc.cancelQueries({ queryKey: QUERY_KEYS.STRATEGY_CONTEXT });
      await qc.cancelQueries({ queryKey: QUERY_KEYS.STRATEGY_CONFIGS });
      return {
        previousContext: qc.getQueryData(QUERY_KEYS.STRATEGY_CONTEXT as any),
        previousConfigs: qc.getQueryData(QUERY_KEYS.STRATEGY_CONFIGS as any),
        previousBot: qc.getQueryData(BOT_STATUS_QUERY_KEY),
      };
    },
    onSuccess: (_data, { marketType, config }) => {
      qc.setQueryData(QUERY_KEYS.STRATEGY_CONTEXT as any, (old: any) => {
        if (!old?.markets) return old;
        return { ...old, markets: old.markets.map((market: any) => (market.marketType === marketType ? { ...market, ...config, marketType } : market)) };
      });
      qc.setQueryData(QUERY_KEYS.STRATEGY_CONFIGS as any, (old: any) => {
        if (!old?.markets) return old;
        return { ...old, markets: old.markets.map((market: any) => (market.marketType === marketType ? { ...market, ...config, marketType } : market)) };
      });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.STRATEGY_CONTEXT });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.STRATEGY_CONFIGS });
      setOverride(marketType, null);
      pushToast({ tone: "success", title: `${MARKETS.find((item) => item.id === marketType)?.label ?? marketType} saved`, description: "Strategy allocation and market controls are updated." });
    },
    onError: (error: Error, _vars, context: any) => {
      if (context?.previousContext) qc.setQueryData(QUERY_KEYS.STRATEGY_CONTEXT as any, context.previousContext);
      if (context?.previousConfigs) qc.setQueryData(QUERY_KEYS.STRATEGY_CONFIGS as any, context.previousConfigs);
      if (context?.previousBot && isValidBotSnapshot(context.previousBot)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previousBot);
      pushToast({ tone: "error", title: "Save failed", description: error.message });
    },
    onSettled: () => {
      setSavingMarket(null);
      setPendingAggressiveSave(null);
      qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY });
    },
  });
  const { mutate: saveMutate, isPending: isSavePending } = saveMutation;

  const activeMarkets: string[] = botData?.activeMarkets ?? [];
  const totalCapital = Number(riskData?.paperBalance ?? 10000);
  const strategiesByMarket = strategyData?.strategiesByMarket ?? {};

  const updateMarket = useCallback((marketType: MarketId, updater: (current: RuntimeConfig) => RuntimeConfig) => {
    setOverride(marketType, updater(overridesRef.current[marketType] ?? serverConfigsRef.current[marketType] ?? DEFAULT_CONFIGS[marketType]));
  }, [setOverride]);

  const toggleStrategy = useCallback((marketType: MarketId, strategyKey: string) => {
    updateMarket(marketType, (current) => {
      const exists = current.strategyKeys.includes(strategyKey);
      const strategyKeys = exists ? current.strategyKeys.filter((key) => key !== strategyKey) : [...current.strategyKeys, strategyKey].slice(0, 2);
      return { ...current, strategyKeys, strategySettings: Object.fromEntries(strategyKeys.map((key) => [key, current.strategySettings[key] ?? defaultStrategySettings()])) };
    });
  }, [updateMarket]);

  const handleSave = useCallback((marketType: MarketId, config: RuntimeConfig) => {
    if (config.executionMode === "AGGRESSIVE") return setPendingAggressiveSave({ marketType, config });
    saveMutate({ marketType, config, aggressiveConfirmed: false });
  }, [saveMutate]);

  const toggleMarket = useCallback((marketId: string) => {
    setExpandedMarkets((prev) => {
      const next = new Set(prev);
      next.has(marketId) ? next.delete(marketId) : next.add(marketId);
      return next;
    });
  }, []);

  if (strategiesLoading || configsLoading) return <div className="card flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading strategy configuration...</div>;

  return (
    <>
      {pendingAggressiveSave ? <SectionErrorBoundary><AggressiveModeModal market={MARKETS.find((item) => item.id === pendingAggressiveSave.marketType)?.label ?? pendingAggressiveSave.marketType} onCancel={() => setPendingAggressiveSave(null)} onConfirm={() => saveMutation.mutate({ marketType: pendingAggressiveSave.marketType, config: pendingAggressiveSave.config, aggressiveConfirmed: true })} /></SectionErrorBoundary> : null}
      <div className="card space-y-5 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-800 pb-3"><Layers3 className="h-4 w-4 text-brand-500" /><div><h2 className="text-sm font-medium text-gray-200">Strategy Engine</h2><p className="mt-0.5 text-xs text-gray-500">GLOBAL hard limits live in Bot Settings. MARKET and STRATEGY controls below guide allocation inside those boundaries.</p></div></div>
        <InlineAlert tone="info" title="Capital hierarchy">Global Risk Controls are hard limits. Strategy Allocation is a soft layer per market, and AGGRESSIVE mode enforces per-strategy capital splits before global checks approve the final order.</InlineAlert>
        {activeMarkets.length > 0 ? <InlineAlert tone="info" title={`Bot running on: ${activeMarkets.join(", ")}`}>Active markets are locked. You can freely edit strategies for idle markets below.</InlineAlert> : null}
        <div className="space-y-3">
          {MARKETS.map((market) => (
            <MarketSection key={market.id} market={market} isExpanded={expandedMarkets.has(market.id)} config={overrides[market.id] ?? serverConfigs[market.id] ?? DEFAULT_CONFIGS[market.id]} isBotActiveHere={activeMarkets.includes(market.id)} totalCapital={totalCapital} strategies={strategiesByMarket[market.id] ?? []} updateMarket={updateMarket} toggleStrategy={toggleStrategy} handleSave={handleSave} savingMarket={savingMarket} isSavePending={isSavePending} toggleMarket={toggleMarket} />
          ))}
        </div>
      </div>
    </>
  );
}
