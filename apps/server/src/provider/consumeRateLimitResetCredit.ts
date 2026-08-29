import {
  ProviderConsumeRateLimitResetCreditError,
  type ProviderConsumeRateLimitResetCreditInput,
  type ProviderConsumeRateLimitResetCreditResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "./Services/ProviderRegistry.ts";

/**
 * Redeem one banked rate-limit reset through the account action captured by
 * the requested provider instance. There is intentionally no driver-kind or
 * default-instance fallback here: an A2 request can only reach A2's closure.
 *
 * After any terminal provider outcome, refresh only that same instance so the
 * quota/reset-credit snapshot is authoritative before the update stream lands
 * in clients. A refresh failure does not rewrite the consume outcome; the next
 * manual/background refresh can still converge the display.
 */
export const consumeProviderRateLimitResetCredit = Effect.fn("consumeProviderRateLimitResetCredit")(
  function* (
    input: ProviderConsumeRateLimitResetCreditInput,
  ): Effect.fn.Return<
    ProviderConsumeRateLimitResetCreditResult,
    ProviderConsumeRateLimitResetCreditError,
    ProviderInstanceRegistry | ProviderRegistry
  > {
    const instanceRegistry = yield* ProviderInstanceRegistry;
    const providerRegistry = yield* ProviderRegistry;
    const instance = yield* instanceRegistry.getInstance(input.instanceId);

    if (!instance) {
      return yield* new ProviderConsumeRateLimitResetCreditError({
        instanceId: input.instanceId,
        reason: "instanceNotFound",
      });
    }

    const consume = instance.accountActions?.consumeRateLimitResetCredit;
    if (!consume) {
      return yield* new ProviderConsumeRateLimitResetCreditError({
        instanceId: input.instanceId,
        reason: "unsupported",
      });
    }

    const outcome = yield* consume({ idempotencyKey: input.idempotencyKey }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderConsumeRateLimitResetCreditError({
            instanceId: input.instanceId,
            reason: "consumeFailed",
            detail: cause.message,
            cause,
          }),
      ),
    );

    yield* providerRegistry
      .refreshInstance(input.instanceId)
      .pipe(Effect.ignoreCause({ log: true }));

    return { outcome };
  },
);
