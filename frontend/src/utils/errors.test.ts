import { describe, expect, it } from "vitest";
import { ApiError } from "../services/api.ts";
import { extractError, extractFieldErrors } from "./errors.ts";

describe("extractError", () => {
  it("returns the server detail for ApiError instances", () => {
    const err = new ApiError(409, "Email or username already registered");
    expect(extractError(err)).toBe("Email or username already registered");
  });

  it("returns a clear message for network fetch failures", () => {
    const err = new TypeError("Failed to fetch");
    expect(extractError(err)).toBe(
      "Unable to reach the server. Please check your connection and try again.",
    );
  });

  it("falls back to the message for generic errors", () => {
    expect(extractError(new Error("boom"))).toBe("boom");
    expect(extractError("junk")).toBe("Something went wrong. Please try again.");
  });
});

describe("extractFieldErrors", () => {
  it("returns the validation map from an ApiError with field errors", () => {
    const err = new ApiError(
      422,
      "String should have at least 8 characters",
      { password: "String should have at least 8 characters" },
    );
    expect(extractFieldErrors(err)).toEqual({
      password: "String should have at least 8 characters",
    });
  });

  it("returns an empty map when there are no field errors", () => {
    expect(extractFieldErrors(new Error("nope"))).toEqual({});
    expect(extractFieldErrors(new ApiError(409, "duplicate"))).toEqual({});
  });
});