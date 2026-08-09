#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');

assert(html.includes('fw-signin'), 'login must use the current email sign-in function');
assert(html.includes('fw-signup'), 'login must offer current account creation');
assert(html.includes("const SESSION_KEY = 'fw_session_v1'"), 'login must store the current app session');
assert(html.includes('signInWithOAuth'), 'login must support current OAuth sign-in');
assert(html.includes("startOAuth('google'"), 'login must support Google');
assert(html.includes("startOAuth('apple'"), 'login must support Apple');
assert(!html.includes('acquireSessionToken'), 'login must not use the retired legacy token flow');
assert(!html.includes("const AUTH_KEY = 'od_auth_v1'"), 'login must not write legacy browser auth');
assert(!html.includes('Sleeper Username'), 'login must not ask current users for the retired Sleeper login');

console.log('login auth contract ok');
