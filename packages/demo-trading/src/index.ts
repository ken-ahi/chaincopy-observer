export const DEMO_TRADING_IMPLEMENTATION_PHASE = 6 as const;

export type DemoTradingMode = "MIRROR" | "RISK_ADJUSTED";

export const defaultDemoTradingMode: DemoTradingMode = "RISK_ADJUSTED";
