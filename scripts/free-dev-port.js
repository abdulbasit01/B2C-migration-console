#!/usr/bin/env node
'use strict';

/**
 * Free a local dev port before starting Vite (avoids "Port 3001 is already in use").
 * Usage: node scripts/free-dev-port.js [port]
 */

var execSync = require('child_process').execSync;

var port = parseInt(process.argv[2], 10) || 3001;

function log(message) {
    process.stdout.write(String(message) + '\n');
}

function freePortWindows(targetPort) {
    var output = '';
    try {
        output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
        return;
    }

    var pids = {};
    var lines = output.split('\n');
    var i;
    var suffix = ':' + targetPort;

    for (i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('LISTENING') < 0) continue;
        if (line.indexOf(suffix) < 0) continue;
        var parts = line.trim().split(/\s+/);
        var pid = parts[parts.length - 1];
        if (pid && pid !== '0') pids[pid] = true;
    }

    Object.keys(pids).forEach(function (pid) {
        try {
            execSync('taskkill /PID ' + pid + ' /F', { stdio: 'ignore' });
            log('Freed port ' + targetPort + ' (stopped PID ' + pid + ')');
        } catch (killErr) {
            // Process may have already exited.
        }
    });
}

function freePortUnix(targetPort) {
    try {
        execSync('lsof -ti tcp:' + targetPort + ' | xargs kill -9', {
            stdio: 'ignore',
            shell: true
        });
        log('Freed port ' + targetPort);
    } catch (e) {
        // Port not in use.
    }
}

if (process.platform === 'win32') {
    freePortWindows(port);
} else {
    freePortUnix(port);
}
