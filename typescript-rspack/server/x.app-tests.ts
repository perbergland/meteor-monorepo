console.log("[diag] x.app-tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { C_VAL } from "/imports/sym/async-c";

describe("smoke x", () => {
  it("runs", () => {
    expect(C_VAL).to.equal("C:D:E");
  });
});
