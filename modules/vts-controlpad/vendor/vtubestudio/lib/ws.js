"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketReadyState = exports.getWebSocketImpl = void 0;
function getWebSocketImpl() {
    var ws = undefined;
    if (!ws && typeof WebSocket !== 'undefined')
        ws = WebSocket;
    if (!ws && typeof window !== 'undefined' && 'WebSocket' in window)
        ws = window.WebSocket;
    if (!ws && typeof global !== 'undefined' && 'WebSocket' in global)
        ws = global.WebSocket;
    if (!ws && typeof self !== 'undefined' && 'WebSocket' in self)
        ws = self.WebSocket;
    if (!ws)
        throw new Error('Could not locate a WebSocket implementation in your current environment. Please provide a WebSocket factory manually in the constructor options.');
    return ws;
}
exports.getWebSocketImpl = getWebSocketImpl;
var WebSocketReadyState;
(function (WebSocketReadyState) {
    WebSocketReadyState[WebSocketReadyState["connecting"] = 0] = "connecting";
    WebSocketReadyState[WebSocketReadyState["open"] = 1] = "open";
    WebSocketReadyState[WebSocketReadyState["closing"] = 2] = "closing";
    WebSocketReadyState[WebSocketReadyState["closed"] = 3] = "closed";
})(WebSocketReadyState || (exports.WebSocketReadyState = WebSocketReadyState = {}));
//# sourceMappingURL=ws.js.map