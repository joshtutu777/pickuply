export type TestLane = "real" | "test" | "all";

export function includeTestParam(value: string | string[] | undefined): boolean {
  const flag = Array.isArray(value) ? value[0] : value;
  return flag === "1";
}

/** A test admin stays on the test lane. A real admin hides test rows unless this view asks for them. */
export function laneFromViewer(viewerIsTest: boolean, requested: boolean): TestLane {
  if (viewerIsTest) return "test";
  return requested ? "all" : "real";
}

export function inTestLane(isTest: boolean, lane: TestLane): boolean {
  if (lane === "all") return true;
  return lane === "test" ? isTest : !isTest;
}
