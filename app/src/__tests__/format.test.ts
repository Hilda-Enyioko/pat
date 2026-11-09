import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "../lib/format";

describe("parseUnits", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseUnits("1", 6)).toBe(1_000_000n);
    expect(parseUnits("2.5", 6)).toBe(2_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits(" 3. ", 6)).toBe(3_000_000n);
  });
  it("refuses more decimals than the mint has instead of rounding", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(/at most 6/);
    expect(() => parseUnits("1.5", 0)).toThrow(/no decimal/);
  });
  it("handles zero-decimal mints", () => {
    expect(parseUnits("42", 0)).toBe(42n);
  });
  it("handles values beyond Number precision", () => {
    expect(parseUnits("18446744073709.551615", 6)).toBe(18446744073709551615n);
  });
  it("rejects junk", () => {
    for (const bad of ["", "-1", "1e3", "abc", "1,5", ".5"]) expect(() => parseUnits(bad, 6)).toThrow();
  });
});

describe("formatUnits", () => {
  it("trims trailing zeros and adds a symbol", () => {
    expect(formatUnits(2_500_000n, 6)).toBe("2.5");
    expect(formatUnits(1_000_000n, 6, "USDC")).toBe("1 USDC");
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(0n, 6)).toBe("0");
    expect(formatUnits(7n, 0, "PTS")).toBe("7 PTS");
  });
  it("round-trips large values", () => {
    const v = 18446744073709551615n;
    expect(parseUnits(formatUnits(v, 9), 9)).toBe(v);
  });
});
