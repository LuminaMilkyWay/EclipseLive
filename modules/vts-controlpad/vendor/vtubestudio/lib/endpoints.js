"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
var api_1 = require("./api");
var types_1 = require("./types");
var utils_1 = require("./utils");
var validation_1 = require("./validation");
var ws_1 = require("./ws");
var ApiClient = (function () {
    function ApiClient(options) {
        var _a, _b, _c;
        this._connectHandlers = [];
        this._disconnectHandlers = [];
        this._errorHandlers = [];
        this._endpointHandlers = [];
        this._eventHandlers = [];
        this._isConnected = false;
        this._isConnecting = false;
        this._shouldReconnect = true;
        this.apiState = this._createClientCall('APIState');
        this.authenticationToken = this._createClientCall('AuthenticationToken', 5 * 60 * 1000);
        this.authentication = this._createClientCall('Authentication');
        this.statistics = this._createClientCall('Statistics');
        this.vtsFolderInfo = this._createClientCall('VTSFolderInfo');
        this.currentModel = this._createClientCall('CurrentModel');
        this.availableModels = this._createClientCall('AvailableModels');
        this.modelLoad = this._createClientCall('ModelLoad');
        this.moveModel = this._createClientCall('MoveModel');
        this.hotkeysInCurrentModel = this._createClientCall('HotkeysInCurrentModel');
        this.hotkeyTrigger = this._createClientCall('HotkeyTrigger');
        this.expressionState = this._createClientCall('ExpressionState');
        this.expressionActivation = this._createClientCall('ExpressionActivation');
        this.artMeshList = this._createClientCall('ArtMeshList');
        this.artMeshAtPosition = this._createClientCall('ArtMeshAtPosition');
        this.colorTint = this._createClientCall('ColorTint');
        this.sceneColorOverlayInfo = this._createClientCall('SceneColorOverlayInfo');
        this.faceFound = this._createClientCall('FaceFound');
        this.inputParameterList = this._createClientCall('InputParameterList');
        this.parameterValue = this._createClientCall('ParameterValue');
        this.live2DParameterList = this._createClientCall('Live2DParameterList');
        this.parameterCreation = this._createClientCall('ParameterCreation');
        this.parameterDeletion = this._createClientCall('ParameterDeletion');
        this.injectParameterData = this._createClientCall('InjectParameterData');
        this.getCurrentModelPhysics = this._createClientCall('GetCurrentModelPhysics');
        this.setCurrentModelPhysics = this._createClientCall('SetCurrentModelPhysics');
        this.ndiConfig = this._createClientCall('NDIConfig');
        this.itemList = this._createClientCall('ItemList');
        this.itemLoad = this._createClientCall('ItemLoad');
        this.itemUnload = this._createClientCall('ItemUnload');
        this.itemAnimationControl = this._createClientCall('ItemAnimationControl');
        this.itemMove = this._createClientCall('ItemMove');
        this.itemSort = this._createClientCall('ItemSort');
        this.artMeshSelection = this._createClientCall('ArtMeshSelection', 30 * 60 * 1000);
        this.itemPin = this._createClientCall('ItemPin');
        this.postProcessingList = this._createClientCall('PostProcessingList');
        this.postProcessingUpdate = this._createClientCall('PostProcessingUpdate');
        this.permission = this._createClientCall('Permission', 15 * 60 * 1000);
        this.events = Object.seal({
            test: this._createEventSubCalls('Test'),
            modelLoaded: this._createEventSubCalls('ModelLoaded'),
            trackingStatusChanged: this._createEventSubCalls('TrackingStatusChanged'),
            backgroundChanged: this._createEventSubCalls('BackgroundChanged'),
            modelConfigChanged: this._createEventSubCalls('ModelConfigChanged'),
            modelMoved: this._createEventSubCalls('ModelMoved'),
            modelOutline: this._createEventSubCalls('ModelOutline'),
            hotkeyTriggered: this._createEventSubCalls('HotkeyTriggered'),
            modelAnimation: this._createEventSubCalls('ModelAnimation'),
            item: this._createEventSubCalls('Item'),
            modelClicked: this._createEventSubCalls('ModelClicked'),
            postProcessing: this._createEventSubCalls('PostProcessing'),
            live2DCubismEditorConnected: this._createEventSubCalls('Live2DCubismEditorConnected'),
            artMeshTracking: this._createEventSubCalls('ArtMeshTracking'),
            artMeshOutline: this._createEventSubCalls('ArtMeshOutline'),
        });
        this._eventSubscription = this._createClientCall('EventSubscription');
        (0, validation_1.validate)(options, 'options', ['object', {
                authTokenGetter: 'function',
                authTokenSetter: 'function',
                pluginDeveloper: 'string',
                pluginName: 'string',
                pluginIcon: ['optional', 'string'],
                url: ['optional', 'string'],
                port: ['optional', 'number'],
                webSocketFactory: ['optional', 'function'],
            }]);
        this._authTokenGetter = options.authTokenGetter;
        this._authTokenSetter = options.authTokenSetter;
        this._pluginName = options.pluginName;
        this._pluginDeveloper = options.pluginDeveloper;
        this._pluginIcon = options.pluginIcon;
        this._port = (_a = options.port) !== null && _a !== void 0 ? _a : 8001;
        this._url = (_b = options.url) !== null && _b !== void 0 ? _b : "ws://localhost:".concat(this._port);
        var webSocketImpl = options.webSocketFactory ? null : (0, ws_1.getWebSocketImpl)();
        this._webSocketFactory = (_c = options.webSocketFactory) !== null && _c !== void 0 ? _c : (function (url) { return new webSocketImpl(url); });
        this._webSocket = this._webSocketFactory(this._url);
        this._reconnect();
    }
    Object.defineProperty(ApiClient.prototype, "isConnected", {
        get: function () { return this._isConnected; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ApiClient.prototype, "isConnecting", {
        get: function () { return this._isConnecting; },
        enumerable: false,
        configurable: true
    });
    ApiClient.prototype.on = function (type, handler) {
        (0, validation_1.validate)(type, 'type', ['stringEnum', ['connect', 'disconnect', 'error']]);
        (0, validation_1.validate)(handler, 'handler', 'function');
        if (type === 'connect' && !this._connectHandlers.find(function (h) { return h === handler; }))
            this._connectHandlers.push(handler);
        if (type === 'disconnect' && !this._disconnectHandlers.find(function (h) { return h === handler; }))
            this._disconnectHandlers.push(handler);
        if (type === 'error' && !this._errorHandlers.find(function (h) { return h === handler; }))
            this._errorHandlers.push(handler);
    };
    ApiClient.prototype.off = function (type, handler) {
        (0, validation_1.validate)(type, 'type', ['stringEnum', ['connect', 'disconnect', 'error']]);
        (0, validation_1.validate)(handler, 'handler', 'function');
        if (type === 'connect' && this._connectHandlers.find(function (h) { return h === handler; }))
            this._connectHandlers.splice(this._connectHandlers.findIndex(function (h) { return h === handler; }), 1);
        if (type === 'disconnect' && this._disconnectHandlers.find(function (h) { return h === handler; }))
            this._disconnectHandlers.splice(this._disconnectHandlers.findIndex(function (h) { return h === handler; }), 1);
        if (type === 'error' && this._errorHandlers.find(function (h) { return h === handler; }))
            this._errorHandlers.splice(this._errorHandlers.findIndex(function (h) { return h === handler; }), 1);
    };
    ApiClient.prototype.disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this._shouldReconnect = false;
                this._webSocket.close();
                return [2];
            });
        });
    };
    ApiClient.prototype._createClientCall = function (type, defaultTimeout) {
        var _this = this;
        if (defaultTimeout === void 0) { defaultTimeout = 1000; }
        return (function (data, config) { return new Promise(function (resolve, reject) {
            var _a;
            var requestID = (0, utils_1.generateID)(16);
            var request = (0, api_1.makeRequestMsg)(type, requestID, data !== null && data !== void 0 ? data : {});
            var handler = {
                callback: function (msg) {
                    var _a, _b;
                    if (msg.requestID === requestID) {
                        handler.remove = true;
                        clearTimeout(handler.timeout);
                        if ((0, api_1.msgIsResponse)(msg, type))
                            resolve((_a = msg.data) !== null && _a !== void 0 ? _a : {});
                        else if ((0, api_1.msgIsError)(msg))
                            reject(new api_1.VTubeStudioError((_b = msg.data) !== null && _b !== void 0 ? _b : {}, requestID));
                        else
                            reject(new api_1.VTubeStudioError({ errorID: types_1.ErrorCode.InternalClientError, message: "The response from VTube Studio was an unexpected type: ".concat(JSON.stringify(msg.messageType)) }, requestID));
                    }
                },
                type: type,
                request: request,
                timeout: setTimeout(function () {
                    handler.remove = true;
                    reject(new api_1.VTubeStudioError({ errorID: types_1.ErrorCode.InternalClientError, message: 'The request timed out.' }, requestID));
                }, (_a = config === null || config === void 0 ? void 0 : config.timeout) !== null && _a !== void 0 ? _a : defaultTimeout),
                remove: false,
            };
            _this._endpointHandlers.push(handler);
            if (_this._webSocket.readyState === ws_1.WebSocketReadyState.open)
                _this._webSocket.send(JSON.stringify(request));
        }); });
    };
    ApiClient.prototype._createEventSubCalls = function (type) {
        var _this = this;
        return {
            subscribe: (function (callback, config) { return __awaiter(_this, void 0, void 0, function () {
                var handler, existingHandler;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4, this._eventSubscription({ config: config !== null && config !== void 0 ? config : {}, eventName: "".concat(type, "Event"), subscribe: true })];
                        case 1:
                            _a.sent();
                            handler = {
                                callback: function (msg) {
                                    var _a;
                                    if ((0, api_1.msgIsEvent)(msg, type))
                                        callback((_a = msg.data) !== null && _a !== void 0 ? _a : {});
                                },
                                type: type,
                                config: config !== null && config !== void 0 ? config : {},
                                remove: false,
                            };
                            existingHandler = this._eventHandlers.find(function (h) { return h.type === type; });
                            this._eventHandlers.push(handler);
                            if (existingHandler) {
                                existingHandler.remove = true;
                                return [2, false];
                            }
                            return [2, true];
                    }
                });
            }); }),
            unsubscribe: function () { return __awaiter(_this, void 0, void 0, function () {
                var existingHandler;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            existingHandler = this._eventHandlers.find(function (h) { return h.type === type; });
                            if (!existingHandler) return [3, 2];
                            return [4, this._eventSubscription({ config: existingHandler.config, eventName: "".concat(type, "Event"), subscribe: false })];
                        case 1:
                            _a.sent();
                            existingHandler.remove = true;
                            return [2, true];
                        case 2: return [2, false];
                    }
                });
            }); }
        };
    };
    ApiClient.prototype._reconnect = function () {
        var _this = this;
        this._isConnecting = true;
        this._webSocket.addEventListener('message', function (_a) {
            var data = _a.data;
            try {
                var msg = JSON.parse(data);
                for (var _i = 0, _b = _this._endpointHandlers; _i < _b.length; _i++) {
                    var handler = _b[_i];
                    handler.callback(msg);
                }
                for (var _c = 0, _d = _this._eventHandlers; _c < _d.length; _c++) {
                    var handler = _d[_c];
                    handler.callback(msg);
                }
                for (var i = _this._endpointHandlers.length - 1; i >= 0; i--)
                    if (_this._endpointHandlers[i].remove)
                        _this._endpointHandlers.splice(i, 1);
                for (var i = _this._eventHandlers.length - 1; i >= 0; i--)
                    if (_this._eventHandlers[i].remove)
                        _this._eventHandlers.splice(i, 1);
            }
            catch (e) {
                for (var _e = 0, _f = _this._errorHandlers; _e < _f.length; _e++) {
                    var handler = _f[_e];
                    handler(e);
                }
            }
        });
        this._webSocket.addEventListener('close', function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this._disconnect();
                return [2];
            });
        }); });
        this._webSocket.addEventListener('error', function () {
            _this._webSocket.close();
        });
        this._webSocket.addEventListener('open', function () { return __awaiter(_this, void 0, void 0, function () {
            var pluginName, pluginDeveloper, pluginIcon, _a, active, currentSessionAuthenticated, authenticationToken, _b, authenticated, reason, _c, authenticationToken, _d, authenticated, reason, _i, _e, handler, _f, _g, handler, e_1, _h, _j, handler;
            var _this = this;
            return __generator(this, function (_k) {
                switch (_k.label) {
                    case 0:
                        _k.trys.push([0, 11, , 12]);
                        pluginName = this._pluginName;
                        pluginDeveloper = this._pluginDeveloper;
                        pluginIcon = this._pluginIcon;
                        return [4, this.apiState()];
                    case 1:
                        _a = _k.sent(), active = _a.active, currentSessionAuthenticated = _a.currentSessionAuthenticated;
                        if (!active)
                            throw new Error('VTube Studio Plugin API is not enabled.');
                        if (!!currentSessionAuthenticated) return [3, 9];
                        _k.label = 2;
                    case 2:
                        _k.trys.push([2, 5, , 9]);
                        return [4, this._authTokenGetter()];
                    case 3:
                        authenticationToken = _k.sent();
                        if (!authenticationToken)
                            throw new Error('Missing authentication token');
                        return [4, this.authentication({ pluginName: pluginName, pluginDeveloper: pluginDeveloper, authenticationToken: authenticationToken })];
                    case 4:
                        _b = _k.sent(), authenticated = _b.authenticated, reason = _b.reason;
                        if (!authenticated)
                            throw new Error("Authentication with VTube Studio failed: ".concat(reason));
                        return [3, 9];
                    case 5:
                        _c = _k.sent();
                        return [4, this.authenticationToken({ pluginName: pluginName, pluginDeveloper: pluginDeveloper, pluginIcon: pluginIcon })];
                    case 6:
                        authenticationToken = (_k.sent()).authenticationToken;
                        return [4, this.authentication({ pluginName: pluginName, pluginDeveloper: pluginDeveloper, authenticationToken: authenticationToken })];
                    case 7:
                        _d = _k.sent(), authenticated = _d.authenticated, reason = _d.reason;
                        if (!authenticated)
                            throw new Error("Authentication with VTube Studio failed: ".concat(reason));
                        return [4, this._authTokenSetter(authenticationToken)];
                    case 8:
                        _k.sent();
                        return [3, 9];
                    case 9:
                        for (_i = 0, _e = this._endpointHandlers; _i < _e.length; _i++) {
                            handler = _e[_i];
                            this._webSocket.send(JSON.stringify(handler.request));
                        }
                        return [4, Promise.all(this._eventHandlers.map(function (handler) { return _this._eventSubscription({ config: handler.config, eventName: "".concat(handler.type, "Event"), subscribe: true }); }))];
                    case 10:
                        _k.sent();
                        this._isConnecting = false;
                        this._isConnected = true;
                        for (_f = 0, _g = this._connectHandlers; _f < _g.length; _f++) {
                            handler = _g[_f];
                            handler();
                        }
                        return [3, 12];
                    case 11:
                        e_1 = _k.sent();
                        for (_h = 0, _j = this._errorHandlers; _h < _j.length; _h++) {
                            handler = _j[_h];
                            handler(e_1);
                        }
                        this._webSocket.close();
                        return [3, 12];
                    case 12: return [2];
                }
            });
        }); });
    };
    ApiClient.prototype._disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, handler;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this._isConnecting = false;
                        if (this._isConnected) {
                            this._isConnected = false;
                            for (_i = 0, _a = this._disconnectHandlers; _i < _a.length; _i++) {
                                handler = _a[_i];
                                handler();
                            }
                        }
                        if (!this._shouldReconnect)
                            return [2];
                        return [4, (0, utils_1.wait)(5 * 1000)];
                    case 1:
                        _b.sent();
                        setTimeout(function () {
                            if (!_this._isConnecting && !_this._isConnected) {
                                _this._webSocket = _this._webSocketFactory(_this._url);
                                _this._reconnect();
                            }
                        }, 0);
                        return [2];
                }
            });
        });
    };
    return ApiClient;
}());
exports.ApiClient = ApiClient;
//# sourceMappingURL=endpoints.js.map