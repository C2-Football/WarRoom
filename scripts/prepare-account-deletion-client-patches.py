#!/usr/bin/env python3
"""Prepare reviewable patches; never modify the current production snapshots."""
from pathlib import Path
import difflib
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT.parent
OUTPUT = ROOT / 'tmp/account-deletion-clients'
REPORTS = ROOT / 'reports/public-readiness/patches'
REPORTS.mkdir(parents=True, exist_ok=True)

def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Current source changed; expected one exact matching edit')
    return text.replace(old, new, 1)

def settings(text):
    text = once(text,
        "if (!confirm('Last check — are you sure? Your account and data will be gone for good.')) return false;",
        "if (!confirm('Last check — are you sure? Your account and data will be gone for good. Stripe subscriptions will be canceled. Apple and Google subscriptions are managed separately in the store and are not canceled by deleting this account.')) return false;")
    text = once(text, '            await window.OD.deleteAccount();', '''            const requestedToken = window.OD.getSessionToken();
            const result = await window.OD.deleteAccount({ expectedToken: requestedToken });
            if (window.OD.getSessionToken() !== requestedToken) throw new Error('This response belongs to the previous account. The current account has been left signed in');
            if (!result || result.ok !== true) throw new Error('Deletion was not confirmed. Your session has been preserved');
            if (result.managedSubscriptions && result.managedSubscriptions.length) alert('Your account was deleted. Apple or Google store subscriptions must still be managed with the store.');''')
    return text

def admin(text):
    text = once(text, '''      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));''', '''      let data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === 'paying_customer') {''')
    text = once(text, '''Deleting will cancel their billing. Delete anyway?`);''', '''Stripe subscriptions will be canceled. Apple and Google subscriptions must be managed with the store. Delete the account?`);''')
    text = once(text, '''        res = await requestDelete(email, true);
      }
      const data = await res.json().catch(() => ({}));''', '''        res = await requestDelete(email, true);
        data = await res.json().catch(() => ({}));
      }''')
    text = once(text, '''        alert(`Deleted. (sign-in records removed: ${data.deletedAuthUsers ?? 0})`);''', '''        alert(`Deleted. (sign-in records removed: ${data.deletedAuthUsers ?? 0})` + (data.managedSubscriptions && data.managedSubscriptions.length ? '\\nApple or Google subscriptions must still be managed with the store.' : ''));''')
    return text

def shared(text):
    start = text.index('window.OD.deleteAccount = async function() {')
    end = text.index('\n};', start) + len('\n};')
    before = text[start:end]
    after = once(before, 'async function() {', 'async function(options = {}) {')
    after = once(after, "    if (!token) throw new Error('You must be logged in to delete your account');", "    if (!token) throw new Error('You must be logged in to delete your account');\n    if (options.expectedToken && options.expectedToken !== token) throw new Error('The account changed before deletion started. Try again from the current account');")
    after = once(after, "    if (!resp.ok) throw new Error(result.error || 'Failed to delete account');", "    if (getSessionToken() !== token) throw new Error('This deletion response belongs to the previous account. The current account has been left signed in');\n    if (!resp.ok) throw new Error(result.error || 'Failed to delete account');\n    if (result.ok !== true) throw new Error('Deletion was not confirmed. Your session has been preserved');")
    return text[:start] + after + text[end:]

manifest = []
for label, directory in [('native','warroom-current-native-source'), ('public','warroom-current-public-source'), ('shared','dhq-shared-current-public')]:
    source = PROJECTS / directory
    transforms = {'supabase-client.js': shared} if label == 'shared' else {'js/settings.js': settings, 'admin.html': admin}
    if label != 'shared':
        def index(text):
            import re
            result, count = re.subn(r'(src="js/settings\.js\?v=)[^"\s]+', r'\g<1>20260920deletion1', text)
            if count != 1: raise RuntimeError('Missing settings cache buster')
            return result
        transforms['index.html'] = index
    patch = ''
    for name, transform in transforms.items():
        original = (source / name).read_text()
        changed = transform(original)
        candidate = OUTPUT / label / name
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_text(changed)
        patch += ''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), fromfile='a/'+name, tofile='b/'+name))
        manifest.append({'snapshot': directory, 'file': name, 'sourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'candidateSha256': hashlib.sha256(changed.encode()).hexdigest()})
    (REPORTS / ('current-'+label+'-account-deletion.patch')).write_text(patch)
(REPORTS / 'account-deletion-client-fingerprints.json').write_text(json.dumps(manifest, indent=2)+'\n')
print('Prepared native, public and shared patches; source snapshots unchanged.')
