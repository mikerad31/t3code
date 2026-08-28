import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";

const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
  Layer.provide(SqlitePersistenceMemory),
);
const testLayer = Layer.mergeAll(
  runtimeRepositoryLayer,
  ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer)),
  NodeServices.layer,
);

it.layer(testLayer)("ProviderSessionDirectory instance switching", (it) => {
  it("clears instance-owned resume and runtime state when switching instances of one driver", () =>
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      const threadId = ThreadId.make("thread-codex-account-switch");
      const a1 = ProviderInstanceId.make("codex_a1");
      const a2 = ProviderInstanceId.make("codex_a2");
      const codex = ProviderDriverKind.make("codex");

      yield* directory.upsert({
        threadId,
        provider: codex,
        providerInstanceId: a1,
        adapterKey: "codex-a1-adapter",
        resumeCursor: { threadId: "native-thread-owned-by-a1" },
        runtimePayload: {
          modelSelection: { instanceId: a1, model: "gpt-5.6-sol" },
          cwd: "C:/dev/project-a1",
          a1Only: true,
        },
      });

      yield* directory.upsert({
        threadId,
        provider: codex,
        providerInstanceId: a2,
        runtimePayload: {
          modelSelection: { instanceId: a2, model: "gpt-5.6-sol" },
          cwd: "C:/dev/project-a2",
        },
      });

      const runtime = yield* runtimeRepository.getByThreadId({ threadId });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.providerName, "codex");
        assert.equal(runtime.value.providerInstanceId, a2);
        assert.equal(runtime.value.adapterKey, "codex");
        assert.equal(runtime.value.resumeCursor, null);
        assert.deepEqual(runtime.value.runtimePayload, {
          modelSelection: { instanceId: a2, model: "gpt-5.6-sol" },
          cwd: "C:/dev/project-a2",
        });
      }
    }));
});
