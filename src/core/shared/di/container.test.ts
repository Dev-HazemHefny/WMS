import { Container } from "./container";

describe("Container", () => {
  it("registers and resolves a dependency", () => {
    const container = new Container();
    container.register("clock", { now: () => 123 });
    expect(container.resolve<{ now: () => number }>("clock").now()).toBe(123);
  });

  it("rejects duplicate registrations", () => {
    const container = new Container();
    container.register("repo", {});
    expect(() => container.register("repo", {})).toThrow("Dependency already registered");
  });
});