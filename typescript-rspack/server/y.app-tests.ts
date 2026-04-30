console.log("[diag] y.app-tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { D_VAL } from "/imports/sym/async-d";

describe("smoke y", () => {
  it("runs too", () => {
    expect(D_VAL).to.equal("D:E");
  });
});
