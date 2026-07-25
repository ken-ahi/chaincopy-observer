import { describe, expect, it } from "vitest";

import { parseDecimalString } from "./index.js";

describe("parseDecimalString", () => {
  it("preserves decimal precision without converting through number", () => {
    expect(parseDecimalString("123456789.123456789123456789").toString()).toBe(
      "123456789.123456789123456789",
    );
  });

  it("rejects exponent notation at the external boundary", () => {
    expect(() => parseDecimalString("1e6")).toThrow(TypeError);
  });
});
