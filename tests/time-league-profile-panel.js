'use strict';
const assert = require('assert');
global.window = globalThis;
global.App = {};
App.TimeLeagueRoster = require('../js/shared/time-league-roster.js');
App.TimeLeagueHelmet = require('../js/shared/time-league-helmet.js');
const disk = new Map();
global.localStorage = { getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value) };
let userId = null;
App.OD = { getCurrentUserId: () => userId };
const Profile = require('../js/shared/time-league-profile.js');
window.TimeLeagueHelmetIcon = function Icon() {};
window.TimeLeagueHelmetPicker = function Picker() {};
let stateIndex = 0, refIndex = 0;
const states = [], refs = [], effects = [];
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => { const i = stateIndex++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef: value => { const i = refIndex++; refs[i] ||= { current: value }; return refs[i]; },
    useEffect: fn => effects.push(fn),
};
require('../js/components/time-league-profile-panel.js');
const nodes = (value, test) => Array.isArray(value) ? value.flatMap(item => nodes(item, test)) : value && typeof value === 'object' ? [...(test(value) ? [value] : []), ...nodes(value.children || [], test)] : [];
const text = value => Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? text(value.children) : String(value || '');
const render = () => { stateIndex = 0; refIndex = 0; return window.WrTimeLeagueProfilePanel({}); };
async function run() {
    let view = render();
    assert(nodes(view, node => node.type === 'fieldset')[0].props.disabled, 'Editor must wait for profile load');
    effects.shift()();
    await Promise.resolve();
    view = render();
    assert.equal(nodes(view, node => node.type === 'fieldset')[0].props.disabled, false);
    const guestBoxes = nodes(view, node => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(guestBoxes.length, 2);
    assert(guestBoxes.every(node => node.props.disabled && !node.props.checked));
    assert.equal(nodes(view, node => node.type === window.TimeLeagueHelmetPicker).length, 1);
    assert.equal(nodes(view, node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 5);
    userId = 'alice';
    Profile.saveLocal({ teamName: 'Alice Owls', displayName: 'Alice', publicProfile: true }, 'alice');
    states[0] = { userId: 'alice', profile: Profile.readLocal(), loading: false };
    view = render();
    assert(text(view).includes('Alice Owls'));
    const publicCheckbox = nodes(view, node => node.type === 'input' && node.props.type === 'checkbox')[0];
    assert.equal(publicCheckbox.props.checked, true);
    let saves = 0;
    App.TimeLeagueRemote = { saveProfile: async profile => { saves++; return { ok: true, profile }; } };
    publicCheckbox.props.onChange({ target: { checked: false } });
    assert.equal(saves, 0, 'Changing the public toggle alone must not publish or mutate account data');
    view = render();
    await nodes(view, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    assert.equal(saves, 1);
    assert.equal(Profile.readLocal().publicProfile, false);
    userId = 'bob';
    view = render();
    assert(!text(view).includes('Alice Owls'), 'Account data must disappear before effects run after account switch');
    assert(nodes(view, node => node.type === 'fieldset')[0].props.disabled);
    assert(!nodes(view, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.checked);
    console.log('Vault profile editor: guest privacy, load gating, helmet/backdrop controls, explicit Save and first-render account isolation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
