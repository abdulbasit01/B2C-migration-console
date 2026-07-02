'use strict';

function HTTPClient() {
    this._status = 200;
    this._text   = '{}';
    this._method = '';
    this._url    = '';
}

HTTPClient.prototype.setTimeout = function () {};

HTTPClient.prototype.open = function (method, url) {
    this._method = method;
    this._url    = url;
};

HTTPClient.prototype.setRequestHeader = function () {};

HTTPClient.prototype.send = function () {};

HTTPClient.prototype.getStatusCode = function () {
    return this._status;
};

HTTPClient.prototype.getText = function () {
    return this._text;
};

module.exports = HTTPClient;
