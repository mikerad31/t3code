import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderInstance } from "./ProviderDriver.ts";
import { consumeProviderRateLimitResetCredit } from "./consumeRateLimitResetCredit.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "./Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "./Services/ProviderRegistry.ts";

const A1 = ProviderInstanceId.make("A1");
const A2 = ProviderInstanceId.make("A2");
const A3 = ProviderInstanceId.make("A3");

function instanceRegistryFor(
  instances: ReadonlyMap<ProviderInstanceId, ProviderInstance>,
): ProviderInstanceRegistryShape {
  return {
    getInstance: (instanceId) => Effect.succeed(instances.get(instanceId)),
  } as ProviderInstanceRegistryShape;
}

function providerRegistryWith(
  refreshInstance: ProviderRegistryShape["refreshInstance"],
): ProviderRegistryShape {
  return { refreshInstance } as ProviderRegistryShape;
}

function resetInstance(input: {
  readonly instanceId: ProviderInstanceId;
  readonly onConsume: (idempotencyKey: string) => void;
}): ProviderInstance {
  return {
    instanceId: input.instanceId,
    accountActions: {
      consumeRateLimitResetCredit: ({ idempotencyKey }) =>
        Effect.sync(() => {
          input.onConsume(idempotencyKey);
          return "reset" as const;
        }),
    },
  } as unknown as ProviderInstance;
}

it.effect(
  "routes a reset only to the exact provider instance and preserves the idempotency key",
  () => {
    const consumeCalls: Array<{ readonly instanceId: string; readonly idempotencyKey: string }> =
      [];
    const refreshCalls: string[] = [];
    const instances = new Map([
      [
        A1,
        resetInstance({
          instanceId: A1,
          onConsume: (idempotencyKey) => consumeCalls.push({ instanceId: A1, idempotencyKey }),
        }),
      ],
      [
        A2,
        resetInstance({
          instanceId: A2,
          onConsume: (idempotencyKey) => consumeCalls.push({ instanceId: A2, idempotencyKey }),
        }),
      ],
      [
        A3,
        resetInstance({
          instanceId: A3,
          onConsume: (idempotencyKey) => consumeCalls.push({ instanceId: A3, idempotencyKey }),
        }),
      ],
    ]);

    return Effect.gen(function* () {
      const result = yield* consumeProviderRateLimitResetCredit({
        instanceId: A2,
        idempotencyKey: "redeem-a2-once",
      });

      assert.deepStrictEqual(result, { outcome: "reset" });
      assert.deepStrictEqual(consumeCalls, [
        { instanceId: "A2", idempotencyKey: "redeem-a2-once" },
      ]);
      assert.deepStrictEqual(refreshCalls, ["A2"]);
    }).pipe(
      Effect.provideService(ProviderInstanceRegistry, instanceRegistryFor(instances)),
      Effect.provideService(
        ProviderRegistry,
        providerRegistryWith((instanceId) =>
          Effect.sync(() => {
            refreshCalls.push(instanceId);
            return [];
          }),
        ),
      ),
    );
  },
);

it.effect("keeps a successful redemption successful when the follow-up refresh fails", () => {
  const instances = new Map([[A2, resetInstance({ instanceId: A2, onConsume: () => undefined })]]);

  return Effect.gen(function* () {
    const result = yield* consumeProviderRateLimitResetCredit({
      instanceId: A2,
      idempotencyKey: "redeem-even-if-refresh-fails",
    });

    assert.deepStrictEqual(result, { outcome: "reset" });
  }).pipe(
    Effect.provideService(ProviderInstanceRegistry, instanceRegistryFor(instances)),
    Effect.provideService(
      ProviderRegistry,
      providerRegistryWith(() => Effect.die(new Error("refresh failed after redemption"))),
    ),
  );
});

it.effect("rejects an unknown provider instance before attempting a refresh", () => {
  let refreshCount = 0;

  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      consumeProviderRateLimitResetCredit({
        instanceId: A2,
        idempotencyKey: "missing-instance",
      }),
    );

    assert.strictEqual(error.reason, "instanceNotFound");
    assert.strictEqual(error.instanceId, A2);
    assert.strictEqual(refreshCount, 0);
  }).pipe(
    Effect.provideService(ProviderInstanceRegistry, instanceRegistryFor(new Map())),
    Effect.provideService(
      ProviderRegistry,
      providerRegistryWith(() =>
        Effect.sync(() => {
          refreshCount += 1;
          return [];
        }),
      ),
    ),
  );
});

it.effect("rejects an instance that does not expose a reset action", () => {
  const unsupportedInstance = { instanceId: A2 } as unknown as ProviderInstance;
  const instances = new Map([[A2, unsupportedInstance]]);

  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      consumeProviderRateLimitResetCredit({
        instanceId: A2,
        idempotencyKey: "unsupported-instance",
      }),
    );

    assert.strictEqual(error.reason, "unsupported");
    assert.strictEqual(error.instanceId, A2);
  }).pipe(
    Effect.provideService(ProviderInstanceRegistry, instanceRegistryFor(instances)),
    Effect.provideService(
      ProviderRegistry,
      providerRegistryWith(() => Effect.succeed([])),
    ),
  );
});
