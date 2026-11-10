import { describe, expect, it } from "vitest";
import { splitAddress } from "@/lib/lira-parser";

describe("LIRA property address", () => {
  it("keeps only the street in the address and pulls out the ZIP", () => {
    expect(splitAddress("1409 Alabama Street, Monroe, LA 71202")).toEqual({ street: "1409 Alabama Street", city: "Monroe", state: "LA", zip: "71202" });
  });
  it("handles highway addresses", () => {
    expect(splitAddress("2375 LA Highway 139, Monroe, LA 71203")).toEqual({ street: "2375 LA Highway 139", city: "Monroe", state: "LA", zip: "71203" });
  });
});
