import { describe, expect, it } from "vitest";

import { isAllowedAdminEmail } from "./authorization.js";

describe("single-user authorization", () => {
  it("accepts only the configured email after safe normalization", () => {
    expect(isAllowedAdminEmail(" Owner@Example.com ", "owner@example.com")).toBe(true);
    expect(isAllowedAdminEmail("other@example.com", "owner@example.com")).toBe(false);
  });

  it("rejects a missing identity", () => {
    expect(isAllowedAdminEmail(null, "owner@example.com")).toBe(false);
    expect(isAllowedAdminEmail(undefined, "owner@example.com")).toBe(false);
  });
});
