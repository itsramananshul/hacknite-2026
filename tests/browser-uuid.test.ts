import {test} from "node:test";
import assert from "node:assert/strict";
import {browserUuid} from "../lib/browser-uuid";
test("simulation version IDs work on HTTP browsers without randomUUID",()=>{
  const httpCrypto={getRandomValues:globalThis.crypto.getRandomValues.bind(globalThis.crypto)};
  const first=browserUuid(httpCrypto),second=browserUuid(httpCrypto);
  assert.match(first,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first,second);
});
