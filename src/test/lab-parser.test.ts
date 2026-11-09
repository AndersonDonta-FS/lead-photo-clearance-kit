import { describe, expect, it } from "vitest";
import { parseLabText, standardFor } from "@/lib/lira-parser";

describe("lab report dust wipes", () => {
  it("reads EMSL sample rows", () => {
    const text = "Client Sample ID: 2/Kitchen Floor Date Sampled: 10/28/26\nMatrix: Wipe\nLead 10/29/26 A.M. <2.0 µg/ft² 2.0 µg/ft²\n";
    expect(parseLabText(text)).toEqual([{ sampleId: "2", location: "Kitchen Floor", result: "< 2.0", standard: "5.0", sampled: "10/28/26" }]);
  });
  it("uses surface clearance standards", () => {
    expect(standardFor("Bed 1 Floor")).toBe("5.0");
    expect(standardFor("Kitchen Window Sill")).toBe("40");
    expect(standardFor("Window Trough")).toBe("100");
  });
});
