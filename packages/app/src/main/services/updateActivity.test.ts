import { expect, it } from "vitest";
import { hasPendingUpdateWork, protectUpdateWork } from "./updateActivity";
it("holds the install barrier through overlapping asynchronous writes and releases on failure", async () => {
  let finish!: () => void;
  const writing = protectUpdateWork(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  expect(hasPendingUpdateWork()).toBe(true);
  await expect(
    protectUpdateWork(async () => {
      throw new Error("disk full");
    })
  ).rejects.toThrow("disk full");
  expect(hasPendingUpdateWork()).toBe(true);
  finish();
  await writing;
  expect(hasPendingUpdateWork()).toBe(false);
});
