// ══════════════════════════════════════════════════════════════════
// js/tabs/calendar.js — League Calendar: Key Dates & Deadlines
// Shows trade deadlines, draft dates, playoffs, and custom events.
// Data from league settings + localStorage custom events.
//
// The event-building logic is exposed as window.WrCalendar so the Home
// dashboard "League Calendar" widget can reuse the exact same dates.
// ══════════════════════════════════════════════════════════════════

// ─── Shared calendar engine — window.WrCalendar ──────────────────────
const WrCalendar = (function () {
    function eventsKey(leagueId) { return 'wr_calendar_' + leagueId; }
    function readCustomEvents(leagueId) {
        try { return JSON.parse(localStorage.getItem(eventsKey(leagueId)) || '[]'); } catch { return []; }
    }

    // Build the full league calendar (league-derived events + custom events),
    // sorted ascending by date. Unscheduled dates are null and sort last.
    // Optional date inputs keep league/commissioner equivalence testable.
    function build(currentLeague, leagueSkin, customEvents, dateContext) {
        const items = [];
        const settings = currentLeague?.settings || {};
        const season = currentLeague?.season || new Date().getFullYear();
        const now = dateContext?.nowMs ?? Date.now();
        const seasonStartDate = dateContext?.seasonStartDate !== undefined
            ? dateContext.seasonStartDate
            : window.S?.nflState?.season_start_date;
        // Commissioner and league views deliberately share this exact helper
        // and season anchor. No separate September guess is allowed here.
        const weekToDate = window.App?.Commish?.Calendar?.weekToDate;
        const dateForWeek = week => {
            const timestamp = typeof weekToDate === 'function' ? weekToDate(week, seasonStartDate) : null;
            return timestamp == null ? null : new Date(timestamp);
        };
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const isChopped = !!window.App?.Chopped?.isChopped?.(currentLeague) || resolvedLeagueSkin?.type === 'chopped' || Number(settings.type) === 3;
        const canTrade = window.App?.Commish?.Calendar?.supportsTrades
            ? window.App.Commish.Calendar.supportsTrades(currentLeague, resolvedLeagueSkin)
            : !isChopped && resolvedLeagueSkin?.features?.showTrades !== false && Number(settings.disable_trades || 0) !== 1;
        const hasPlayoffs = !isChopped && resolvedLeagueSkin?.features?.showPlayoffOdds !== false;
        const isSeasonalLeague = !!resolvedLeagueSkin?.state?.isSeasonal;
        const rosteredPlayerCount = resolvedLeagueSkin?.state?.rosterPlayerCount ?? (currentLeague?.rosters || []).reduce((sum, roster) => {
            const ids = []
                .concat(roster?.players || [])
                .concat(roster?.starters || [])
                .concat(roster?.reserve || [])
                .concat(roster?.taxi || [])
                .filter(id => id && String(id) !== '0');
            return sum + new Set(ids.map(String)).size;
        }, 0);
        const suppressSeasonalWaivers = isSeasonalLeague && (
            resolvedLeagueSkin?.phase === 'pre_draft' ||
            resolvedLeagueSkin?.phase === 'offseason' ||
            resolvedLeagueSkin?.phase === 'complete' ||
            rosteredPlayerCount === 0
        );
        const draftTitle = isSeasonalLeague ? 'League Draft' : 'Rookie Draft';

        // Phase 9: Draft date — prefer metadata, fall back to drafts[].start_time
        // so a scheduled draft shows up even when the league hasn't set metadata.draft_date.
        if (currentLeague?.draft_id || settings.draft_rounds) {
            let draftTs = currentLeague?.metadata?.draft_date;
            let draftType = currentLeague?.metadata?.draft_type;
            let draftRounds = Number(settings.draft_rounds || 0);
            let latestDraft = null;
            const drafts = (window.S && window.S.drafts) || currentLeague?.drafts || [];
            if (!draftTs) {
                const sameSeason = drafts.find(d => String(d.season) === String(season));
                latestDraft = sameSeason || drafts[0] || null;
                if (latestDraft) {
                    draftTs = latestDraft.start_time || latestDraft.scheduled_time || latestDraft.start_ts;
                    draftType = draftType || latestDraft.type || latestDraft.settings?.slot_type || 'snake';
                    draftRounds = Number(latestDraft.settings?.rounds || latestDraft.settings?.round_count || latestDraft.rounds || draftRounds || 0);
                }
            }
            draftRounds = window.App?.LeagueSkin?.resolveDraftRounds?.({
                league: currentLeague,
                leagueSkin: resolvedLeagueSkin,
                draft: latestDraft,
                drafts,
                fallbackRounds: draftRounds || settings.draft_rounds || 0,
            }) || draftRounds;
            const draftNumeric = Number(draftTs);
            const draftDate = draftTs ? new Date(Number.isFinite(draftNumeric) ? (draftNumeric < 1e12 ? draftNumeric * 1000 : draftNumeric) : draftTs) : null;
            if (draftDate && Number.isFinite(draftDate.getTime())) {
                items.push({
                    id: 'draft',
                    title: draftTitle,
                    date: draftDate,
                    icon: '🏈',
                    type: 'league',
                    detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ', ' + (draftType || 'snake'),
                    sourceLabel: 'League draft schedule',
                });
            } else {
                // Still surface a placeholder so the user knows a draft exists but the date isn't set
                items.push({
                    id: 'draft',
                    title: draftTitle,
                    date: null,
                    icon: '🏈',
                    type: 'league',
                    detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ' · date TBD',
                    tbd: true,
                    sourceLabel: 'Draft date has not been scheduled',
                });
            }
        }

        // Trade deadline
        const tradeDeadline = settings.trade_deadline;
        if (canTrade && tradeDeadline && tradeDeadline > 0) {
            // Sleeper provides a week, not an exact deadline timestamp.
            const deadlineDate = dateForWeek(tradeDeadline);
            items.push({
                id: 'trade-deadline',
                title: 'Trade Deadline',
                date: deadlineDate,
                week: Number(tradeDeadline),
                tbd: deadlineDate == null,
                icon: '🔒',
                type: 'league',
                detail: 'Week ' + tradeDeadline,
                estimated: true,
                sourceLabel: deadlineDate ? 'Estimated from the season start and league deadline week' : 'League deadline week is known; season start date is unavailable',
            });
        }

        // Playoff start
        const playoffStart = settings.playoff_week_start;
        if (hasPlayoffs && playoffStart && playoffStart > 0) {
            const playoffDate = dateForWeek(playoffStart);
            items.push({
                id: 'playoffs',
                title: 'Playoffs Begin',
                date: playoffDate,
                week: Number(playoffStart),
                tbd: playoffDate == null,
                icon: '⭐',
                type: 'league',
                detail: 'Week ' + playoffStart + ' · ' + (settings.playoff_teams || 6) + ' teams qualify',
                estimated: true,
                sourceLabel: playoffDate ? 'Estimated from the season start and league playoff week' : 'League playoff week is known; season start date is unavailable',
            });

            // Championship week (2-3 weeks after playoff start depending on bracket)
            const playoffWeeks = settings.playoff_round_type === 2 ? 4 : 3; // 2-week per round = 4 weeks
            const championshipWeek = Number(playoffStart) + playoffWeeks - 1;
            const champDate = dateForWeek(championshipWeek);
            items.push({
                id: 'championship',
                title: 'Championship Week',
                date: champDate,
                week: championshipWeek,
                tbd: champDate == null,
                icon: '🏆',
                type: 'league',
                detail: 'Estimated Week ' + championshipWeek,
                estimated: true,
                sourceLabel: 'Estimated from playoff week and bracket length',
            });
        }

        // Season start (Week 1)
        const kickoffDate = dateForWeek(1);
        if (!kickoffDate || kickoffDate.getTime() > now - 30 * 86400000) {
            items.push({
                id: 'season-start',
                title: 'Season Kickoff',
                date: kickoffDate,
                week: 1,
                tbd: kickoffDate == null,
                icon: '🚀',
                type: 'league',
                detail: season + ' NFL Season · Week 1',
                estimated: true,
                sourceLabel: kickoffDate ? 'Season start date from league data; kickoff time is not loaded' : 'Season start date is unavailable',
            });
        }

        // Waiver processing (ongoing — show next occurrence)
        const waiverType = settings.waiver_type;
        if (waiverType && !suppressSeasonalWaivers) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const configuredDay = Number(settings.waiver_day_of_week);
            const hasWaiverDay = settings.waiver_day_of_week != null && Number.isInteger(configuredDay) && configuredDay >= 0 && configuredDay <= 6;
            const waiverDay = hasWaiverDay ? configuredDay : 3;
            const nextWaiver = new Date();
            nextWaiver.setDate(nextWaiver.getDate() + ((waiverDay - nextWaiver.getDay() + 7) % 7 || 7));
            nextWaiver.setHours(0, 0, 0, 0);
            items.push({
                id: 'waivers',
                title: 'Waivers Process',
                date: nextWaiver,
                icon: '💰',
                type: 'recurring',
                detail: 'Every ' + dayNames[waiverDay] + (settings.waiver_budget ? ' · $' + settings.waiver_budget + ' FAAB' : ''),
                estimated: true,
                sourceLabel: hasWaiverDay ? 'League processing weekday; exact time is not loaded' : 'Estimated weekday; confirm waiver processing with your league',
            });
        }

        // Roster Cutdown Day — set from GM's Office (window.App.RosterCutdown),
        // e.g. an NFL-style cutdown to a smaller active roster + taxi squad.
        const cutdownLeagueId = currentLeague?.id || currentLeague?.league_id || '';
        const cutdownRule = cutdownLeagueId ? window.App?.RosterCutdown?.getRule?.(cutdownLeagueId) : null;
        if (cutdownRule) {
            items.push({
                id: 'cutdown-day',
                title: 'Roster Cutdown Day',
                date: new Date(cutdownRule.effectiveDate + 'T00:00:00'),
                icon: '✂️',
                type: 'roster',
                detail: cutdownRule.activeSlots + ' active / ' + cutdownRule.taxiSlots + ' taxi (' + (cutdownRule.activeSlots + cutdownRule.taxiSlots) + ' total) — cut down to fit',
                sourceLabel: 'Your saved cutdown rule',
            });
        }

        // Custom events
        (customEvents || []).forEach(e => {
            items.push({
                id: e.id,
                title: e.title,
                date: new Date(e.date),
                icon: '📌',
                type: 'custom',
                isCustom: true,
                sourceLabel: 'Personal reminder · this browser',
            });
        });

        // Sort by date
        return items.sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
    }

    // Full calendar for a league, reading custom events from localStorage.
    function getEvents(currentLeague, leagueSkin) {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        return build(currentLeague, leagueSkin, readCustomEvents(leagueId));
    }

    // Upcoming events only (now onward, with a small grace window so dates
    // earlier today — e.g. midnight waiver runs — still surface).
    function getUpcoming(currentLeague, leagueSkin) {
        const cutoff = Date.now() - 12 * 3600000;
        return getEvents(currentLeague, leagueSkin).filter(e => e.tbd || (e.date && e.date.getTime() >= cutoff));
    }

    return { eventsKey, readCustomEvents, build, getEvents, getUpcoming };
})();
window.WrCalendar = WrCalendar;

function CalendarTab({ currentLeague, myRoster, leagueSkin }) {
    const { useState, useMemo } = React;
    const isPhone = !!window.WR?.useViewport?.().isPhone;
    const [calendarScope, setCalendarScope] = useState('upcoming');
    const leagueId = currentLeague?.id || currentLeague?.league_id || '';
    const EVENTS_KEY = 'wr_calendar_' + leagueId;

    const [customEvents, setCustomEvents] = useState(() => {
        try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); } catch { return []; }
    });
    const [showAdd, setShowAdd] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDate, setNewDate] = useState('');
    const seasonStartDate = window.S?.nflState?.season_start_date;

    // ── Build calendar events from league settings + custom ──
    // Delegates to the shared engine (window.WrCalendar, defined above)
    // so the Home dashboard "League Calendar" widget shows the same dates.
    const events = useMemo(
        () => WrCalendar.build(currentLeague, leagueSkin, customEvents),
        [currentLeague, customEvents, leagueSkin, seasonStartDate]
    );

    // ── Add custom event ──
    function addEvent() {
        if (!newTitle.trim() || !newDate) return;
        const event = { id: 'custom_' + Date.now(), title: newTitle.trim(), date: newDate };
        const updated = [...customEvents, event];
        setCustomEvents(updated);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
        setNewTitle('');
        setNewDate('');
        setShowAdd(false);
    }

    function removeEvent(id) {
        const updated = customEvents.filter(e => e.id !== id);
        setCustomEvents(updated);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
    }

    // ── Styles ──
    const cardStyle = { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius, 10px)', overflow: 'hidden' };
    const headerStyle = { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-hero, 2rem)', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' };

    const now = Date.now();
    const nextEventId = events.find(event => !event.tbd && event.date?.getTime() >= now)?.id;
    const visibleEvents = isPhone ? events.filter(event => calendarScope === 'all' || (calendarScope === 'past' ? event.date?.getTime() < now : event.tbd || !(event.date?.getTime() < now))) : events;

    return React.createElement('div', { className: isPhone ? 'la-mobile la-calendar' : undefined },
        // Phone leads with upcoming dates; the workspace already supplies its title.
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '12px' } },
            !isPhone && React.createElement('div', { style: { ...headerStyle, flex: 1 } }, 'LEAGUE CALENDAR'),
            isPhone && React.createElement('select', { 'aria-label': 'Calendar dates', value: calendarScope, onChange: event => setCalendarScope(event.target.value), style: { flex: 1, minWidth: 0, marginRight: 8 } }, React.createElement('option', { value: 'upcoming' }, 'Upcoming dates'), React.createElement('option', { value: 'past' }, 'Past dates'), React.createElement('option', { value: 'all' }, 'All dates')),
            React.createElement('button', { title: 'Add custom calendar event', onClick: () => setShowAdd(!showAdd), style: { background: 'none', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm)', color: 'var(--gold)', fontSize: 'var(--text-label)', fontWeight: 700, padding: '10px 14px', minHeight: '44px', cursor: 'pointer', fontFamily: 'inherit' } }, showAdd ? 'Cancel' : '+ Add Event'),
        ),

        isPhone ? React.createElement('details', { className: 'la-disclosure' }, React.createElement('summary', null, 'About these dates'), React.createElement('p', null, 'Estimated dates need league confirmation. Custom reminders stay in this browser.')) :React.createElement('p', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.5, margin: '0 0 14px' } }, 'Scheduled draft dates use the league schedule. Week-based dates are marked as estimates; confirm exact deadlines with your league. Custom reminders are saved in this browser for this league.'),

        // Add event form
        showAdd && React.createElement('div', { style: { ...cardStyle, padding: '12px', marginBottom: '12px' } },
            React.createElement('input', { value: newTitle, onChange: e => setNewTitle(e.target.value), placeholder: 'Event title (e.g. "League Meeting")', style: { width: '100%', padding: '8px 10px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', fontSize: 'var(--text-label)', fontFamily: 'inherit', marginBottom: '8px', boxSizing: 'border-box' } }),
            React.createElement('input', { type: 'date', value: newDate, onChange: e => setNewDate(e.target.value), style: { width: '100%', padding: '8px 10px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', fontSize: 'var(--text-label)', fontFamily: 'inherit', marginBottom: '8px', boxSizing: 'border-box' } }),
            React.createElement('button', { onClick: addEvent, style: { width: '100%', padding: '8px', minHeight: '44px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-label)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } }, 'Add to Calendar'),
        ),

        // Events timeline
        React.createElement('div', { style: cardStyle },
            visibleEvents.length === 0
                ? React.createElement('div', { style: { padding: '30px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label)' } }, events.length ? 'No dates in this view.' : 'No events yet. League dates will appear here once your league settings load.')
                : React.createElement('div', null,
                    visibleEvents.map((event, i) => {
                        const timestamp = event.date?.getTime();
                        const isPast = Number.isFinite(timestamp) && timestamp < now;
                        const isNext = event.id === nextEventId;
                        const daysAway = Number.isFinite(timestamp) ? Math.ceil((timestamp - now) / 86400000) : null;
                        const dateStr = event.tbd ? 'Date TBD' : (event.estimated ? 'Estimated · ' : '') + event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: event.date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
                        const countdown = !event.tbd && !event.estimated && !isPast && daysAway <= 30 ? (daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : daysAway + ' days') : null;

                        return React.createElement('div', { key: event.id, className: 'la-calendar-event', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: i < events.length - 1 ? '1px solid var(--ov-3, rgba(255,255,255,0.04))' : 'none', opacity: isPast ? (isPhone ? 0.75 : 0.4) : 1, background: isNext ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'transparent' } },
                            // Timeline dot
                            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28px', flexShrink: 0 } },
                                React.createElement('span', { style: { fontSize: '1.1rem' } }, event.icon),
                            ),
                            // Content
                            React.createElement('div', { className: 'la-calendar-copy', style: { flex: 1, minWidth: 0 } },
                                React.createElement('div', { style: { fontSize: 'var(--text-body)', fontWeight: 600, color: isNext ? 'var(--gold)' : 'var(--white)' } }, event.title, isNext && React.createElement('span', { style: { fontSize: 'var(--text-micro)', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--card-radius-xs, 5px)', background: 'var(--gold)', color: 'var(--black)', marginLeft: '6px' } }, 'NEXT')),
                                React.createElement('div', { style: { fontSize: 'var(--text-label)', color: 'var(--silver)', marginTop: '2px' } }, dateStr, event.detail ? ' \u00B7 ' + event.detail : ''),
                                event.sourceLabel && React.createElement('div', { style: { fontSize: 'var(--text-micro, .6875rem)', color: 'var(--silver)', opacity: .7, marginTop: '3px' } }, event.sourceLabel),
                            ),
                            // Countdown or delete
                            countdown && React.createElement('span', { style: { fontSize: 'var(--text-label)', fontWeight: 700, color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 } }, countdown),
                            event.isCustom && React.createElement('button', { title: 'Remove custom calendar event', onClick: () => removeEvent(event.id), style: { background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.7 } }, '\u2715'),
                        );
                    })
                ),
        ),
    );
}
window.CalendarTab = CalendarTab;
