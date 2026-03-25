"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Shield,
  ExternalLink,
} from "lucide-react";

const MARKETS = [
  {
    id: "indian",
    label: "🇮🇳 Indian Markets",
    desc: "NSE, BSE — Stocks, F&O, ETFs",
    exchanges: [
      {
        id: "zerodha",
        name: "Zerodha Kite",
        fields: ["API Key", "API Secret"],
        docs: "https://kite.zerodha.com",
      },
      {
        id: "dhan",
        name: "Dhan / DhanHQ",
        fields: ["Client ID", "Access Token"],
        docs: "https://dhanhq.co",
      },
      {
        id: "upstox",
        name: "Upstox Pro",
        fields: ["API Key", "API Secret"],
        docs: "https://upstox.com",
      },
    ],
  },
  {
    id: "crypto",
    label: "₿ Crypto Markets",
    desc: "BTC, ETH, altcoins — Indian exchanges",
    exchanges: [
      {
        id: "coindcx",
        name: "CoinDCX",
        fields: ["API Key", "API Secret"],
        docs: "https://coindcx.com",
      },
      {
        id: "deltaexch",
        name: "Delta Exchange India",
        fields: ["API Key", "API Secret"],
        docs: "https://india.delta.exchange",
      },
      {
        id: "bingx",
        name: "BingX",
        fields: ["API Key", "Secret Key"],
        docs: "https://bingx.com",
      },
    ],
  },
  {
    id: "commodities",
    label: "🛢 Commodities",
    desc: "MCX, NCDEX — Gold, Silver, Crude",
    exchanges: [
      {
        id: "fyers",
        name: "Fyers",
        fields: ["App ID", "Secret Key"],
        docs: "https://fyers.in",
      },
      {
        id: "dhan",
        name: "Dhan (MCX)",
        fields: ["Client ID", "Access Token"],
        docs: "https://dhanhq.co",
      },
      {
        id: "angelone",
        name: "Angel One SmartAPI",
        fields: ["API Key", "Client Code", "PIN", "TOTP Secret"],
        docs: "https://angelone.in",
      },
    ],
  },
  {
    id: "global",
    label: "🌐 Global / General",
    desc: "US, UK, Forex, Bonds — universal algo",
    exchanges: [
      {
        id: "ibkr",
        name: "Interactive Brokers",
        fields: ["Account ID", "TWS Port"],
        docs: "https://interactivebrokers.co.in",
      },
      {
        id: "bingx",
        name: "BingX",
        fields: ["API Key", "Secret Key"],
        docs: "https://bingx.com",
      },
    ],
  },
];

export default function MarketsPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>("crypto");
  const [exchOpen, setExchOpen] = useState<string | null>(null);
  const [fieldVals, setFieldVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const { data: existingApis } = useQuery({
    queryKey: ["exchange-apis"],
    queryFn: () => fetch("/api/exchange").then((r) => r.json()),
  });

  function isConnected(marketId: string, exchId: string) {
    return existingApis?.some(
      (a: any) =>
        a.marketType === marketId && a.exchangeName === exchId && a.isVerified,
    );
  }

  async function saveApi(marketId: string, exchId: string, fields: string[]) {
    setSaving(true);
    const key = `${marketId}_${exchId}`;
    const vals = fields.reduce(
      (acc, f) => ({ ...acc, [f]: fieldVals[`${key}_${f}`] ?? "" }),
      {} as Record<string, string>,
    );
    const apiKey = vals[fields[0]] ?? "";
    const apiSec = vals[fields[1]] ?? "";
    const extra = fields
      .slice(2)
      .reduce((acc, f) => ({ ...acc, [f]: vals[f] }), {});

    await fetch("/api/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marketType: marketId,
        exchangeName: exchId,
        apiKey,
        apiSecret: apiSec,
        extraFields: extra,
      }),
    });

    setSaving(false);
    setSaved(key);
    qc.invalidateQueries({ queryKey: ["exchange-apis"] });
    setTimeout(() => setSaved(null), 3000);
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-100">
        Markets & API Setup
      </h1>
      <p className="text-sm text-gray-500">
        Connect exchanges for each market. API keys are AES-256 encrypted before
        storage.
      </p>

      <div className="bg-amber-900/15 border border-amber-900/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <Shield className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-400/80 space-y-1">
          <p className="font-medium text-amber-400">Security reminder</p>
          <p>
            Only enable <strong>Trade</strong> permissions on your API keys.
            Never enable <strong>Withdrawal</strong> permissions. Always
            whitelist your server IP.
          </p>
        </div>
      </div>

      {MARKETS.map((market) => (
        <div key={market.id} className="card overflow-hidden">
          <button
            onClick={() =>
              setExpanded(expanded === market.id ? null : market.id)
            }
            className="w-full flex items-center justify-between text-left"
          >
            <div>
              <p className="text-sm font-medium text-gray-200">
                {market.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{market.desc}</p>
            </div>
            <div className="flex items-center gap-3">
              {market.exchanges.some((e) => isConnected(market.id, e.id)) && (
                <span className="badge-green">Connected</span>
              )}
              {expanded === market.id ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </div>
          </button>

          {expanded === market.id && (
            <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
              {market.exchanges.map((exch) => {
                const key = `${market.id}_${exch.id}`;
                const connected = isConnected(market.id, exch.id);
                const open = exchOpen === key;

                return (
                  <div
                    key={exch.id}
                    className="bg-gray-800/40 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => setExchOpen(open ? null : key)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        {connected ? (
                          <CheckCircle className="w-4 h-4 text-brand-500" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-gray-600" />
                        )}
                        <span className="text-sm text-gray-300">
                          {exch.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={exch.docs}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-gray-600 hover:text-brand-500 flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" /> Docs
                        </a>
                        {open ? (
                          <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
                        )}
                      </div>
                    </button>

                    {open && (
                      <div className="px-4 pb-4 space-y-4 border-t border-gray-700/50 pt-4">
                        {exch.fields.map((field) => (
                          <div key={field} className="space-y-1">
                            <label className="text-xs font-medium text-gray-400 tracking-wide">
                              {field}
                            </label>

                            <input
                              type="password"
                              className="
          w-full
          px-3 py-2
          rounded-lg
          bg-gray-900/60
          border border-gray-700
          text-gray-100
          placeholder-gray-500
          font-mono text-sm
          
          outline-none
          transition-all duration-200
          
          focus:border-emerald-500
          focus:ring-2 focus:ring-emerald-500/20
          focus:bg-gray-900
          
          hover:border-gray-500
        "
                              placeholder={`Paste your ${field}`}
                              value={fieldVals[`${key}_${field}`] ?? ""}
                              onChange={(e) =>
                                setFieldVals((prev) => ({
                                  ...prev,
                                  [`${key}_${field}`]: e.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}

                        <button
                          onClick={() =>
                            saveApi(market.id, exch.id, exch.fields)
                          }
                          disabled={saving}
                          className="
      w-full py-2.5 mt-2
      rounded-lg
      text-sm font-medium
      
      bg-emerald-600
      hover:bg-emerald-500
      active:scale-[0.98]
      
      disabled:bg-gray-700
      disabled:cursor-not-allowed
      
      transition-all duration-150
    "
                        >
                          {saving
                            ? "Saving…"
                            : saved === key
                              ? "✓ Saved & Encrypted"
                              : "Save API Keys"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
