import { describe, expect, it } from "vitest";
import { normalizeIsoDate } from "./normalize-date";

describe("normalizeIsoDate", () => {
  it("既にゼロ埋めされた日付はそのまま返す", () => {
    expect(normalizeIsoDate("2026-07-03")).toBe("2026-07-03");
  });

  it("ゼロ埋めされていない月・日をゼロ埋めする", () => {
    expect(normalizeIsoDate("2026-7-3")).toBe("2026-07-03");
    expect(normalizeIsoDate("2026-7-30")).toBe("2026-07-30");
    expect(normalizeIsoDate("2026-12-1")).toBe("2026-12-01");
  });

  it("不正な形式は例外を投げる", () => {
    expect(() => normalizeIsoDate("2026/07/03")).toThrow();
    expect(() => normalizeIsoDate("not-a-date")).toThrow();
    expect(() => normalizeIsoDate("2026-13-01")).toThrow();
    expect(() => normalizeIsoDate("2026-01-32")).toThrow();
    expect(() => normalizeIsoDate("2026-02-29")).toThrow();
    expect(() => normalizeIsoDate("2026-02-31")).toThrow();
    expect(normalizeIsoDate("2028-02-29")).toBe("2028-02-29");
  });
});
