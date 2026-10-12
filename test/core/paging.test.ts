import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MoodleError } from "../../src/index.js";
import { mapItems, numberedPage, pageWindow, paged, sliceWindow } from "../../src/core/paging.js";

describe("paging", () => {
  it("asks for one more than the limit, and checks the options", () => {
    assert.deepEqual(pageWindow({}), { offset: 0 });
    assert.deepEqual(pageWindow({ limit: 10, offset: 20 }), { offset: 20, count: 11 });
    for (const options of [{ limit: 0 }, { limit: 1.5 }, { offset: -1 }]) assert.throws(() => pageWindow(options), (error: MoodleError) => error.code === "invalid-input");
  });

  it("gives the list without a limit and { items, more } with one", async () => {
    const all = [1, 2, 3, 4, 5];
    const fetch = async (window: { offset: number; count?: number }) => sliceWindow(all, window);
    assert.deepEqual(await paged({}, fetch), all);
    assert.deepEqual(await paged({ offset: 3 }, fetch), [4, 5]);
    assert.deepEqual(await paged({ limit: 2 }, fetch), { items: [1, 2], more: true });
    assert.deepEqual(await paged({ limit: 2, offset: 3 }, fetch), { items: [4, 5], more: false });
    assert.deepEqual(await mapItems({ items: [1], more: true }, (items) => items.map(String)), { items: ["1"], more: true });
  });

  it("finds the one numbered page that holds a window", () => {
    for (let offset = 0; offset < 60; offset++) {
      for (const count of [1, 3, 11, 26]) {
        const { size, index, skip } = numberedPage({ offset, count });
        assert.equal(index * size + skip, offset);
        assert.ok(skip + count <= size, `offset ${offset}, count ${count}: size ${size}`);
      }
    }
    assert.deepEqual(numberedPage({ offset: 0, count: 11 }), { size: 11, index: 0, skip: 0 });
    assert.deepEqual(numberedPage({ offset: 22, count: 11 }), { size: 11, index: 2, skip: 0 });
  });
});
