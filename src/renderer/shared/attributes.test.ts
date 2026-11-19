import { attributesText, parseAttributes } from "./attributes";

describe("attribute text", () => {
  it("parses comma, Arabic comma and semicolon separated attributes", () => {
    expect(parseAttributes("اللون=أحمر، المقاس=M; الوزن=1")).toEqual([
      { name: "اللون", value: "أحمر" },
      { name: "المقاس", value: "M" },
      { name: "الوزن", value: "1" }
    ]);
  });

  it("keeps '=' inside attribute values", () => {
    expect(parseAttributes("المعادلة=س=ص")).toEqual([{ name: "المعادلة", value: "س=ص" }]);
  });

  it("rejects an incomplete attribute", () => {
    expect(() => parseAttributes("اللون")).toThrow(
      "اكتب كل خاصية بصيغة الاسم=القيمة، وافصل بين الخصائص بفاصلة."
    );
  });

  it("formats attributes back to text", () => {
    expect(attributesText([{ name: "اللون", value: "أحمر" }, { name: "المقاس", value: "M" }])).toBe(
      "اللون=أحمر، المقاس=M"
    );
  });
});
