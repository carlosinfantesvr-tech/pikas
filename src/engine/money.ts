import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const TAKER_FEE = "0.0005";
export const MAKER_FEE = "0.0002";
export const MAINTENANCE_MARGIN_RATE = "0.005";
export const LEVERAGES = [1, 2, 3, 5, 10, 15, 20] as const;
export const INITIAL_BALANCES = ["10", "50", "100", "500"] as const;
export const QTY_DP = 8;

export type D = Decimal;

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function q(value: Decimal.Value): string {
  return d(value).toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP).toFixed(QTY_DP);
}

export function gt(a: Decimal.Value, b: Decimal.Value): boolean {
  return d(a).gt(b);
}

export function gte(a: Decimal.Value, b: Decimal.Value): boolean {
  return d(a).gte(b);
}

export function lt(a: Decimal.Value, b: Decimal.Value): boolean {
  return d(a).lt(b);
}

export function lte(a: Decimal.Value, b: Decimal.Value): boolean {
  return d(a).lte(b);
}

export function eq(a: Decimal.Value, b: Decimal.Value): boolean {
  return d(a).eq(b);
}

export function add(a: Decimal.Value, b: Decimal.Value): string {
  return q(d(a).plus(b));
}

export function sub(a: Decimal.Value, b: Decimal.Value): string {
  return q(d(a).minus(b));
}

export function mul(a: Decimal.Value, b: Decimal.Value): string {
  return q(d(a).times(b));
}

export function div(a: Decimal.Value, b: Decimal.Value): string {
  return q(d(a).div(b));
}

export function min(a: Decimal.Value, b: Decimal.Value): string {
  return q(Decimal.min(d(a), d(b)));
}

export function max(a: Decimal.Value, b: Decimal.Value): string {
  return q(Decimal.max(d(a), d(b)));
}

export function abs(a: Decimal.Value): string {
  return q(d(a).abs());
}

export function isPositive(a: Decimal.Value): boolean {
  return d(a).gt(0);
}

export function cmp(a: Decimal.Value, b: Decimal.Value): number {
  return d(a).cmp(b);
}
