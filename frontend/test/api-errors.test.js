import assert from "node:assert/strict";
import test from "node:test";
import { getErrorMessage } from "../src/services/apiErrors.js";

test("preserves backend string and validation error messages", () => {
  assert.equal(
    getErrorMessage({ response: { data: { detail: "Incorrect email or password." } } }),
    "Incorrect email or password.",
  );
  assert.equal(
    getErrorMessage({
      response: {
        data: { detail: [{ msg: "Field required" }, { msg: "Invalid email" }] },
      },
    }),
    "Field required; Invalid email",
  );
});

test("reports timeout and network failures clearly", () => {
  assert.equal(
    getErrorMessage({ code: "ECONNABORTED" }),
    "The request timed out. Please try again.",
  );
  assert.equal(
    getErrorMessage(
      { code: "ETIMEDOUT" },
      "Analysis failed.",
      { timeoutMessage: "Analysis may still finish; check history before retrying." },
    ),
    "Analysis may still finish; check history before retrying.",
  );
  assert.match(
    getErrorMessage({ code: "ERR_NETWORK" }),
    /Could not reach the server/,
  );
});

test("handles authorization, throttling, and server failures", () => {
  assert.equal(
    getErrorMessage({ response: { status: 401 } }),
    "Your session has expired. Sign in again to continue.",
  );
  assert.equal(
    getErrorMessage({ response: { status: 403 } }),
    "You do not have permission to perform this action.",
  );
  assert.equal(
    getErrorMessage({
      response: {
        status: 429,
        data: { detail: "Too many authentication attempts. Try again later." },
        headers: { "retry-after": "12" },
      },
    }),
    "Too many authentication attempts. Try again later. Try again in 12 seconds.",
  );
  assert.equal(
    getErrorMessage({ response: { status: 503 } }),
    "The server is temporarily unavailable. Please try again later.",
  );
});
