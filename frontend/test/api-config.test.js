import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_REQUEST_TIMEOUT_MS,
  resolveApiConfig,
} from "../src/services/apiConfig.js";

test("uses the development proxy and configured normal/AI timeouts", () => {
  assert.deepEqual(
    resolveApiConfig({
      baseUrl: "",
      apiTimeoutMs: "20000",
      aiRequestTimeoutMs: "150000",
    }),
    {
      baseURL: "",
      timeout: 20_000,
      aiRequestTimeout: 150_000,
    },
  );
});

test("uses safe default timeouts when no override is provided", () => {
  assert.deepEqual(resolveApiConfig(), {
    baseURL: "",
    timeout: 15_000,
    aiRequestTimeout: 240_000,
  });
  assert.equal(LOGIN_REQUEST_TIMEOUT_MS, 90_000);
});

test("requires a production API origin and rejects unsafe production URLs", () => {
  assert.throws(
    () => resolveApiConfig({ production: true }),
    /VITE_API_BASE_URL is required/,
  );
  assert.throws(
    () => resolveApiConfig({ production: true, baseUrl: "http://api.example.com" }),
    /HTTPS backend origin/,
  );
  assert.throws(
    () => resolveApiConfig({ production: true, baseUrl: "https://localhost:8000" }),
    /HTTPS backend origin/,
  );
  assert.throws(
    () => resolveApiConfig({ production: true, baseUrl: "https://api.example.com/api" }),
    /without credentials, a path/,
  );
});

test("normalizes a valid production API origin", () => {
  assert.deepEqual(
    resolveApiConfig({
      production: true,
      baseUrl: "https://api.example.com/",
    }),
    {
      baseURL: "https://api.example.com",
      timeout: 15_000,
      aiRequestTimeout: 240_000,
    },
  );
});

test("rejects invalid timeout overrides instead of silently ignoring them", () => {
  assert.throws(
    () => resolveApiConfig({ apiTimeoutMs: "500" }),
    /VITE_API_TIMEOUT_MS must be an integer/,
  );
  assert.throws(
    () => resolveApiConfig({ aiRequestTimeoutMs: "not-a-number" }),
    /VITE_AI_REQUEST_TIMEOUT_MS must be an integer/,
  );
});
