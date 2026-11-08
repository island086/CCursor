/**
 * aiserver.v1.BidiService — Bidi 辅助服务
 *
 * 1 方法:
 *   - BidiAppend (unary) — 向 bidi 流追加消息
 *     SSE 降级模式下，客户端通过此方法发送 AgentClientMessage，
 *     data 是旧版 hex 编码，dataBinary 是当前版原始 protobuf bytes。
 *     requestId 关联到 RunSSE 流。
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import type { ConnectRouter } from '@connectrpc/connect';
import { BidiService } from '../../gen/aiserver_v1_pb';
import { appendMessage } from '../../handlers/agent/session';
import { logger } from '../../logger';

export interface BidiAppendPayload {
    /** appendMessage 当前接收的 hex 编码。 */
    hex: string;
    /** dataBinary 可能是 binary 或 JSON 路径下的 base64；data 则固定为 hex。 */
    encoding: 'binary' | 'base64' | 'hex';
}

/**
 * Cursor 3.29+ 的 BidiAppend 使用 dataBinary，旧版使用 data。
 *
 * ConnectRPC binary 路径下 dataBinary 是 Uint8Array；如果请求经过 JSON
 * 路径，proto bytes 会表示为 base64 字符串。这里统一转成 appendMessage
 * 现有的 hex 入参，避免同时维护两套 session 解码逻辑。
 */
export function resolveBidiAppendPayload(req: {
    data?: unknown;
    dataBinary?: unknown;
}): BidiAppendPayload | undefined {
    const binary = req.dataBinary;
    if (binary instanceof Uint8Array && binary.length > 0) {
        return {
            hex: Buffer.from(binary).toString('hex'),
            encoding: 'binary',
        };
    }
    if (typeof binary === 'string' && binary.length > 0) {
        const bytes = Buffer.from(binary, 'base64');
        if (bytes.length > 0) {
            return {
                hex: bytes.toString('hex'),
                encoding: 'base64',
            };
        }
    }
    if (typeof req.data === 'string' && req.data.length > 0) {
        return {
            hex: req.data,
            encoding: 'hex',
        };
    }
    return undefined;
}

export default (router: ConnectRouter) => {
    router.service(BidiService, {
        bidiAppend: async (req) => {
            const requestId = req.requestId?.requestId;
            const payload = resolveBidiAppendPayload(req);
            if (requestId && payload) {
                logger.info({
                    requestId,
                    dataLen: payload.hex.length,
                    seqno: Number(req.appendSeqno),
                    encoding: payload.encoding,
                }, '[SVC] BidiAppend');
                appendMessage(requestId, payload.hex);
            } else {
                logger.warn({
                    hasRequestId: !!requestId,
                    hasData: !!req.data,
                    hasDataBinary: req.dataBinary?.length > 0,
                }, '[SVC] BidiAppend missing fields');
            }
            return {};
        },
    });
};
