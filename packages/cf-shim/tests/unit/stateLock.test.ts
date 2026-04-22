import { describe, expect, it } from "vitest";
import { withStateLock } from "../../src/lib/stateLock.js";

describe("withStateLock", () => {
    it("serializa execuções concorrentes (sem overlap)", async () => {
        const order: string[] = [];

        const task = (id: string, ms: number) =>
            withStateLock(async () => {
                order.push(`${id}-start`);
                await new Promise((r) => setTimeout(r, ms));
                order.push(`${id}-end`);
                return id;
            });

        const results = await Promise.all([task("A", 30), task("B", 10), task("C", 5)]);

        expect(results).toEqual(["A", "B", "C"]);
        expect(order).toEqual(["A-start", "A-end", "B-start", "B-end", "C-start", "C-end"]);
    });

    it("preserva ordem FIFO de aquisição", async () => {
        const order: number[] = [];
        const tasks: Promise<void>[] = [];
        for (let i = 0; i < 5; i++) {
            const n = i;
            tasks.push(
                withStateLock(async () => {
                    order.push(n);
                }),
            );
        }
        await Promise.all(tasks);
        expect(order).toEqual([0, 1, 2, 3, 4]);
    });
});
