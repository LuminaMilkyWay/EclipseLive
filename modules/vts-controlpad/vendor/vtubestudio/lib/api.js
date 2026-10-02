"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.msgIsError = exports.msgIsEvent = exports.msgIsResponse = exports.makeRequestMsg = exports.VTubeStudioError = void 0;
var types_1 = require("./types");
var VTubeStudioError = (function (_super) {
    __extends(VTubeStudioError, _super);
    function VTubeStudioError(data, requestID) {
        var _newTarget = this.constructor;
        var _a;
        var _this = _super.call(this, "".concat(data.message, " (Error Code: ").concat(data.errorID, " ").concat((_a = types_1.ErrorCode[data.errorID]) !== null && _a !== void 0 ? _a : types_1.ErrorCode.Unknown, ") (Request ID: ").concat(requestID, ")")) || this;
        _this.data = data;
        _this.requestID = requestID;
        _this.name = _this.constructor.name;
        Object.setPrototypeOf(_this, _newTarget.prototype);
        return _this;
    }
    return VTubeStudioError;
}(Error));
exports.VTubeStudioError = VTubeStudioError;
function makeRequestMsg(type, requestID, data) {
    return {
        apiName: 'VTubeStudioPublicAPI',
        apiVersion: '1.0',
        timestamp: Date.now(),
        messageType: "".concat(type, "Request"),
        requestID: requestID,
        data: data,
    };
}
exports.makeRequestMsg = makeRequestMsg;
function msgIsResponse(msg, type) {
    return msg.messageType === "".concat(type, "Response");
}
exports.msgIsResponse = msgIsResponse;
function msgIsEvent(msg, type) {
    return msg.messageType === "".concat(type, "Event");
}
exports.msgIsEvent = msgIsEvent;
function msgIsError(msg) {
    return msg.messageType === 'APIError';
}
exports.msgIsError = msgIsError;
//# sourceMappingURL=api.js.map