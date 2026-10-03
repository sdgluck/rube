import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSmtpEncryption, writeSmtpEncryption } from "./smtpEncryption.ts";

describe("SMTP encryption", () => {
  it("reads the mode back from the stored flag and port", () => {
    assert.equal(readSmtpEncryption(true, "465"), "ssl");
    assert.equal(readSmtpEncryption(false, "587"), "starttls");
    assert.equal(readSmtpEncryption(false, "25"), "none");
    assert.equal(readSmtpEncryption(false, ""), "starttls");
  });

  it("sets the default port for the chosen mode", () => {
    assert.deepEqual(writeSmtpEncryption("ssl", "587"), { secure: true, port: "465" });
    assert.deepEqual(writeSmtpEncryption("starttls", "465"), { secure: false, port: "587" });
    assert.deepEqual(writeSmtpEncryption("none", ""), { secure: false, port: "25" });
  });

  it("keeps a custom port", () => {
    assert.deepEqual(writeSmtpEncryption("ssl", "2525"), { secure: true, port: "2525" });
  });

  it("round-trips every mode from a blank form", () => {
    for (const mode of ["starttls", "ssl", "none"] as const) {
      const written = writeSmtpEncryption(mode, "");
      assert.equal(readSmtpEncryption(written.secure, written.port), mode);
    }
  });
});
