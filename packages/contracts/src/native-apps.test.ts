import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackAddress, nativeConnectLink } from "./native-apps.ts";

test("a connect link carries whichever addresses it was given, encoded", () => {
  assert.equal(
    nativeConnectLink({ admin: "http://192.168.1.5:3000", portal: "https://tv.example.com/me?x=1" }),
    "rube://connect?admin=http%3A%2F%2F192.168.1.5%3A3000&portal=https%3A%2F%2Ftv.example.com%2Fme%3Fx%3D1",
  );
  assert.equal(
    nativeConnectLink({ portal: "https://tv.example.com" }),
    "rube://connect?portal=https%3A%2F%2Ftv.example.com",
  );
  assert.equal(
    nativeConnectLink({ admin: "http://nas:3000", portal: null }),
    "rube://connect?admin=http%3A%2F%2Fnas%3A3000",
  );
});

test("loopback addresses are the ones a phone can't reach", () => {
  for (const a of [
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://[::1]:3000",
    "http://api.rube.localhost",
    "http://0.0.0.0:3000",
  ]) {
    assert.equal(isLoopbackAddress(a), true, a);
  }
  for (const a of ["http://192.168.1.5:3000", "https://rube.example.com", "http://nas.local:3000", "not a url"]) {
    assert.equal(isLoopbackAddress(a), false, a);
  }
});
