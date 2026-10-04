"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wait = exports.filterFalsy = exports.generateID = void 0;
var ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
function generateID(length) {
    var id = '';
    for (var i = 0; i < length; i++) {
        id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length) % ID_CHARS.length];
    }
    return id;
}
exports.generateID = generateID;
function filterFalsy(value) {
    return !!value;
}
exports.filterFalsy = filterFalsy;
function wait(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
exports.wait = wait;
//# sourceMappingURL=utils.js.map