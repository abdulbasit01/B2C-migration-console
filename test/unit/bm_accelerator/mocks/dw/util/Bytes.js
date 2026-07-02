'use strict';

function Bytes(str, encoding) {
    this._value = String(str || '');
    this._encoding = encoding || 'UTF-8';
}

Bytes.prototype.toString = function () {
    return this._value;
};

module.exports = Bytes;
