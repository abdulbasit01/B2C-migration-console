'use strict';

module.exports = {
    toBase64: function (bytes) {
        if (bytes && typeof bytes.toString === 'function') {
            return Buffer.from(bytes.toString(), 'utf8').toString('base64');
        }
        return Buffer.from(String(bytes || ''), 'utf8').toString('base64');
    }
};
