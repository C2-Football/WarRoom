// Reading helpers keep short summaries and freshness identical across Wire views.
(function (root) {
    'use strict';
    const paragraphs = body => String(body || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    function deck(story) {
        const first = paragraphs(story.body)[0] || '';
        const words = first.split(/\s+/);
        return words.length > 48 ? words.slice(0, 48).join(' ') + '…' : first;
    }
    function matches(story, query) {
        const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const text = [story.text, story.body, story.category, story.league?.name, ...(story.participants || []).flatMap(p => [p.ownerName, p.teamName]), ...(story.related || []).map(r => r.text)].filter(Boolean).join(' ').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    }
    function includesOwner(story, roster, season) {
        if (!roster) return true;
        if (!story.documentary) return (story.rosterIds || []).some(id => String(id) === String(roster.roster_id));
        if (roster.owner_id) return (story.participants || []).some(person => person.ownerId && String(person.ownerId) === String(roster.owner_id));
        return (story.participants || []).some(person => person.rosterId != null && String(person.season) === String(season) && String(person.rosterId) === String(roster.roster_id));
    }
    function checked(at) {
        if (!at) return '';
        const date = new Date(at);
        return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    }
    function period(entry) {
        const results = Number(entry.completedThrough) > 0 ? `Results through Week ${entry.completedThrough}` : 'Awaiting the first completed results';
        return `${entry.historical ? `${entry.league.season} archive · ` : ''}${results}${!entry.historical && Number(entry.week) > Number(entry.completedThrough) && entry.week <= (root.WrWireStories?.bounds(entry.league).end || 18) ? ` · Week ${entry.week} matchups` : ''}${entry.provisional ? ' · Scores may change with stat corrections' : ''}`;
    }
    function retain(previous, next) {
        const same = previous && String(previous.league.league_id || previous.league.id) === String(next.league.league_id || next.league.id) && String(previous.league.season) === String(next.league.season);
        if (!same || !(previous.currentReady || previous.resultsReady || previous.scheduleReady) || next.currentReady) return next;
        if (previous.week !== next.week) {
            // New recaps can arrive before the next schedule. Publish the
            // verified results without carrying last week's previews forward.
            if (next.resultsReady) return next;
            return { ...previous, status: next.status, currentError: next.currentError, error: next.error, stale: !!next.currentError, refreshing: next.status === 'loading' };
        }
        // Results and the schedule can refresh independently. A failed source
        // keeps its last reporting; a successful source replaces only its part.
        const results = next.resultsReady ? next : previous;
        const schedule = next.scheduleReady ? next : previous;
        const resultsReady = !!(results.resultsReady || results.currentReady);
        const scheduleReady = !!(schedule.scheduleReady || schedule.currentReady);
        const times = [results.currentUpdatedAt, schedule.currentUpdatedAt].filter(t => Number(t) > 0);
        return { ...next, stories: [...results.stories.filter(s => !s.preview), ...schedule.stories.filter(s => s.preview)],
            analysis: results.analysis || null, recordBook: results.recordBook || null, features: results.features || [], weeklyFeature: results.weeklyFeature || null, draftContext: results.draftContext || null, race: results.race || null, rivalryProfiles: results.rivalryProfiles || [], completedThrough: results.completedThrough, provisional: !!results.provisional, currentReady: resultsReady && scheduleReady, resultsReady, scheduleReady,
            currentUpdatedAt: times.length ? Math.min(...times) : null, stale: !!next.currentError || next.status === 'error', refreshing: next.status === 'loading' };
    }
    function finish(entry, league) {
        if (entry && entry.status !== 'loading') return entry;
        if (entry?.currentReady && !entry.refreshing && !entry.currentError) {
            const message = 'Earlier history took too long to load. Current news is available.';
            return { ...entry, status: 'partial', archiveError: message, error: message };
        }
        const message = 'The refresh took too long. Refresh news to try again.';
        return { ...(entry || { league, stories: [] }), status: 'partial', refreshing: false, stale: !!entry?.currentReady, currentError: entry?.currentError || message, error: entry?.currentError || message };
    }
    root.WrWireReading = { paragraphs, deck, matches, includesOwner, checked, period, retain, finish };
})(typeof window !== 'undefined' ? window : globalThis);
