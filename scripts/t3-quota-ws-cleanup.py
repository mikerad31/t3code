from pathlib import Path

path = Path("apps/server/src/ws.ts")
text = path.read_text()

import_marker = '} from "./observability/RpcInstrumentation.ts";\n'
reset_import = (
    'import { consumeProviderRateLimitResetCredit } '
    'from "./provider/consumeRateLimitResetCredit.ts";\n'
)
assert text.count(import_marker) == 1, "unexpected RpcInstrumentation import marker count"
text = text.replace(import_marker, import_marker + reset_import, 1)

handler_marker = '        [WS_METHODS.providerUploadFeedback]: (input) =>\n'
reset_handler = '''        [WS_METHODS.providerConsumeRateLimitResetCredit]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerConsumeRateLimitResetCredit,
            consumeProviderRateLimitResetCredit(input),
            { "rpc.aggregate": "provider" },
          ),
'''
assert text.count(handler_marker) == 1, "unexpected providerUploadFeedback handler marker count"
text = text.replace(handler_marker, reset_handler + handler_marker, 1)

path.write_text(text)
