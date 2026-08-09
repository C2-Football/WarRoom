#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');

assert(html.includes('fw-signin'), 'login must use the current email sign-in function');
assert(html.includes('get-session-token'), 'login must preserve password-backed Sleeper username sign-in');
assert(html.includes('fw-signup'), 'login must offer current account creation');
assert(html.includes("const SESSION_KEY = 'fw_session_v1'"), 'login must store the current app session');
assert(html.includes("const LEGACY_SESSION_KEY = 'od_session_v1'"), 'login must store legacy sessions where the shared data layer expects them');
assert(html.includes("const LEGACY_AUTH_KEY = 'od_auth_v1'"), 'login must preserve the Sleeper username for the app');
assert(html.includes('signInWithOAuth'), 'login must support current OAuth sign-in');
assert(html.includes("startOAuth('google'"), 'login must support Google');
assert(html.includes("startOAuth('apple'"), 'login must support Apple');
assert(html.includes('Email or Sleeper username'), 'sign-in must clearly accept either account identifier');
assert(html.includes("const isEmail = identifier.includes('@')"), 'sign-in must route email and username accounts separately');
assert(!html.includes('passwordHash'), 'login must never store a password-derived value in browser storage');

console.log('login auth contract ok');
