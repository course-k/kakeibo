import { describe, expect, it } from "vitest";
import { isValidAmount } from "./amount";

describe("isValidAmount", () => {
  it("正の整数円を妥当とする", () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(1000)).toBe(true);
  });

  it("0 以下を不正とする", () => {
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-100)).toBe(false);
  });

  it("非整数を不正とする", () => {
    expect(isValidAmount(100.5)).toBe(false);
  });

  it("非有限値を不正とする", () => {
    expect(isValidAmount(NaN)).toBe(false);
    expect(isValidAmount(Infinity)).toBe(false);
  });

  it("Number.MAX_SAFE_INTEGER 以下は妥当、超える値は不正とする", () => {
    expect(isValidAmount(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
