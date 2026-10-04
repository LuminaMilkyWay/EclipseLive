"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
function validate(value, name, schema) {
    if (typeof schema === 'string') {
        if (typeof value !== schema)
            throw new Error("".concat(name, " must be a ").concat(schema, " (got ").concat(typeof value, " instead)"));
    }
    else if (Array.isArray(schema)) {
        var type = schema[0], subSchema = schema[1];
        if (type === 'nullable') {
            if (value !== null)
                validate(value, name, subSchema);
        }
        else if (type === 'optional') {
            if (value !== undefined)
                validate(value, name, subSchema);
        }
        else if (type === 'stringEnum') {
            if (typeof value !== 'string')
                throw new Error("".concat(name, " must be a string (got ").concat(typeof value, " instead)"));
            if (subSchema.indexOf(value) === -1)
                throw new Error("".concat(name, " must be one of the following: ").concat(subSchema.map(function (s) { return JSON.stringify(s); }).join(', ')));
        }
        else if (type === 'numberEnum') {
            if (typeof value !== 'number')
                throw new Error("".concat(name, " must be a number (got ").concat(typeof value, " instead)"));
            if (subSchema.indexOf(value) === -1)
                throw new Error("".concat(name, " must be one of the following: ").concat(subSchema.map(function (s) { return JSON.stringify(s); }).join(', ')));
        }
        else if (type === 'array') {
            if (!Array.isArray(value))
                throw new Error("".concat(name, " must be an array (got ").concat(typeof value, " instead)"));
            for (var i = 0; i < value.length; i++)
                validate(value[i], "".concat(name, "[").concat(i, "]"), subSchema);
        }
        else if (type === 'object') {
            if (typeof value !== 'object')
                throw new Error("".concat(name, " must be an object (got ").concat(typeof value, " instead)"));
            for (var k in subSchema) {
                validate(value[k], "".concat(name, ".").concat(k), subSchema[k]);
            }
            for (var k in value) {
                if (!(k in subSchema))
                    throw new Error("".concat(name, ".").concat(k, " must not be set"));
            }
        }
    }
}
exports.validate = validate;
//# sourceMappingURL=validation.js.map