'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('Show', function (req, res, next) {
    res.setViewData({
        customMessage: 'Hello from composable SFRA'
    });
    next();
});

module.exports = server.exports();