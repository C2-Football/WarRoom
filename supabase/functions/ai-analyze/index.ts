// ============================================================
// Owner Dashboard — AI Analysis Edge Function  [v3]
// Supabase Edge Function: /functions/v1/ai-analyze
//
// DEPLOY:
//   supabase functions deploy ai-analyze
//
// SET SECRET:
//   supabase secrets set GOOGLE_AI_KEY=AIza...
// ============================================================

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    checkRateLimit as checkSecurityRateLimit,
    handleOptions,
    requireActiveAppSession,
    requireSleeperSession,
} from '../_shared/security.ts';

// ── Rate limiting ─────────────────────────────────────────────
// 10 AI requests per user per minute to protect service capacity.
// Uses the transactional database limiter shared across Edge instances.
const RATE_LIMIT_MAX     = 10;
const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute in ms

async function checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW };
    const result = await checkSecurityRateLimit(createClient(url, key), 'ai-analyze:minute', identifier,
        { limit: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW / 1000 });
    return { allowed: result.allowed, retryAfterMs: (result.retryAfterSeconds || 60) * 1000 };
}

type AIPlanName = 'free' | 'legacy';

interface AISession {
    identifier: string;
    username: string | null;
    userId: string | null;
    email: string | null;
    plan: AIPlanName;
    products: string[];
    source: 'app' | 'sleeper';
}

// Product access is free; billing claims never grant administrative authority.
async function loadAppAIPlan(_supabase: any, _userId: string, _payload: Record<string, any>): Promise<{ plan: AIPlanName; products: string[] }> {
    return { plan: 'free', products: ['war_room', 'dynast_hq'] };
}

async function resolveAISession(req: Request): Promise<AISession | null> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const appSession = await requireActiveAppSession(supabase, req);
        if (appSession) {
            const entitlement = await loadAppAIPlan(supabase, appSession.userId, appSession.payload);
            return {
                identifier: `app:${appSession.userId}`,
                username: null,
                userId: appSession.userId,
                email: appSession.email,
                plan: entitlement.plan,
                products: entitlement.products,
                source: 'app',
            };
        }
    }

    const sleeperSession = await requireSleeperSession(req);
    if (sleeperSession) {
        return {
            identifier: `sleeper:${sleeperSession.username.toLowerCase()}`,
            username: sleeperSession.username,
            userId: null,
            email: null,
            plan: 'legacy',
            products: ['legacy_sleeper'],
            source: 'sleeper',
        };
    }

    return null;
}

// ── AI model routing and cost telemetry ───────────────────────
type AIProvider = 'anthropic' | 'gemini' | 'openai';
type AIWorkloadTier = 'fast' | 'standard' | 'premium' | 'deep';
interface AIRoute {
    provider: AIProvider;
    model: string;
    tier: AIWorkloadTier;
}

const AI_POLICY_VERSION = '2026-09-09.free-gemini.v1';

const AI_MODELS = {
    GEMINI_BALANCED: 'gemini-2.5-flash',
    OPENAI_STANDARD: 'gpt-5.4-mini',
    CLAUDE_REASONING: 'claude-sonnet-4-6',
} as const;

function envFlag(name: string, defaultValue = false): boolean {
    const raw = Deno.env.get(name);
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function envNumber(name: string, defaultValue: number): number {
    const raw = Number(Deno.env.get(name));
    return Number.isFinite(raw) ? raw : defaultValue;
}

function isAIEnabled(): boolean {
    if (envFlag('AI_KILL_SWITCH', false)) return false;
    return envFlag('AI_ENABLED', true);
}

const AI_SECRET_CACHE = new Map<string, string | null>();

async function getVaultSecret(secretName: string): Promise<string | null> {
    if (AI_SECRET_CACHE.has(secretName)) {
        return AI_SECRET_CACHE.get(secretName) || null;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        AI_SECRET_CACHE.set(secretName, null);
        return null;
    }

    try {
        const admin = createClient(supabaseUrl, serviceRoleKey);
        const data = await safeSupabaseData(admin.rpc('get_app_secret', { secret_name: secretName }));
        const value = typeof data === 'string' ? data.trim() : '';
        AI_SECRET_CACHE.set(secretName, value || null);
        return value || null;
    } catch {
        AI_SECRET_CACHE.set(secretName, null);
        return null;
    }
}

async function getSharedGeminiKey(): Promise<string | null> {
    const secretName = 'GOOGLE_AI_KEY';
    return Deno.env.get(secretName) || await getVaultSecret(secretName);
}

async function callAIProvider(args: {
    route: AIRoute;
    apiKey: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    useWebSearch: boolean;
}): Promise<{
    analysis: string;
    stopReason: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    webSearchCount?: number;
    grounding?: { sources: Array<{ title: string; url: string }>; searchSuggestions?: string };
}> {
    const { route, apiKey, systemPrompt, userPrompt, maxTokens, useWebSearch } = args;

    if (route.provider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { maxOutputTokens: maxTokens, ...(['gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(route.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
                ...(useWebSearch ? { tools: [{ google_search: {} }] } : {}),
            }),
            signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);
        const data = await res.json();
        const candidate = data.candidates?.[0];
        const usage = data.usageMetadata || {};
        return {
            analysis: (candidate?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join(''),
            stopReason: candidate?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : '',
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
            cachedInputTokens: usage.cachedContentTokenCount || 0,
            webSearchCount: candidate?.groundingMetadata?.webSearchQueries?.length || 0,
            grounding: {
                sources: (candidate?.groundingMetadata?.groundingChunks || []).filter((c: any) => c.web?.uri).map((c: any) => ({ title: c.web.title || 'Source', url: c.web.uri })),
                searchSuggestions: candidate?.groundingMetadata?.searchEntryPoint?.renderedContent || '',
            },
        };
    }

    if (route.provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: route.model,
                instructions: systemPrompt,
                input: [{ role: 'user', content: userPrompt }],
                max_output_tokens: maxTokens,
                store: false,
                ...(useWebSearch ? { tools: [{ type: 'web_search' }] } : {}),
            }),
        });
        if (!res.ok) {
            throw new Error(`OpenAI request failed (${res.status})`);
        }
        const data = await res.json();
        const usage = (data as any).usage || {};
        return {
            analysis: (data as any).output_text || ((data as any).output || [])
                .flatMap((item: any) => item?.content || [])
                .filter((part: any) => part?.type === 'output_text' || part?.type === 'text')
                .map((part: any) => part?.text || '')
                .join(''),
            stopReason: (data as any).status === 'incomplete' ? 'max_tokens' : '',
            inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
            outputTokens: usage.output_tokens || usage.completion_tokens || 0,
            cachedInputTokens: usage.input_tokens_details?.cached_tokens || usage.cached_input_tokens || 0,
            grounding: { sources: ((data as any).output || []).flatMap((item: any) => item.content || []).flatMap((part: any) => part.annotations || []).filter((a: any) => a.type === 'url_citation').map((a: any) => ({ title: a.title || 'Source', url: a.url })) },
        };
    }

    const anthropic = new Anthropic({ apiKey });
    const anthropicRequest: any = {
        model: route.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    };
    if (useWebSearch) {
        // GA web search (dynamic filtering) — no beta header required, and it triggers
        // more reliably on current models than the legacy web_search_20250305 +
        // 'web-search-2025-03-05' beta combo. max_uses caps searches per read so a
        // low-coverage ("bad") player can't trigger a runaway, expensive search loop —
        // the model concludes with what it has, and the prompt makes that a depth/stash
        // read rather than a blank.
        anthropicRequest.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
    }

    const textFromContent = (content: any[]) => (content || [])
        .filter(part => part.type === 'text')
        .map(part => part.text || '')
        .join('');
    const searchesIn = (content: any[]) => (content || [])
        .filter(part => part.type === 'server_tool_use').length;

    // Server-side web search runs an internal tool loop. If it hits the per-response
    // iteration cap before the model writes its answer, the response returns with
    // stop_reason 'pause_turn' and NO final text — common for low-profile players the
    // model searches hard for, and was surfacing as a BLANK read → template. Re-send
    // the assistant turn to resume until it finishes (end_turn) or a small cap (with
    // max_uses bounding searches, pauses are now rare).
    let message = await anthropic.messages.create(anthropicRequest);
    let analysis = textFromContent(message.content as any[]);
    let webSearchCount = searchesIn(message.content as any[]);
    let inputTokens = (message as any).usage?.input_tokens || 0;
    let outputTokens = (message as any).usage?.output_tokens || 0;
    let cachedInputTokens = (message as any).usage?.cache_read_input_tokens || 0;
    let pauses = 0;
    while ((message as any).stop_reason === 'pause_turn' && pauses < 2) {
        anthropicRequest.messages = [...anthropicRequest.messages, { role: 'assistant', content: message.content }];
        message = await anthropic.messages.create(anthropicRequest);
        pauses++;
        const turnText = textFromContent(message.content as any[]);
        if (turnText) analysis = analysis ? `${analysis} ${turnText}` : turnText;
        webSearchCount += searchesIn(message.content as any[]);
        inputTokens += (message as any).usage?.input_tokens || 0;
        outputTokens += (message as any).usage?.output_tokens || 0;
        cachedInputTokens += (message as any).usage?.cache_read_input_tokens || 0;
    }

    if (useWebSearch) {
        // Diagnostic (edge logs): searches=0 → answered from training (newsless);
        // text=0 → blank read; high searches → low-coverage player (cached longer).
        console.log(`[web_search] model=${route.model} searches=${webSearchCount} pauses=${pauses} stop=${(message as any).stop_reason || ''} text=${analysis.length}`);
    }
    return {
        analysis,
        stopReason: (message as any).stop_reason || '',
        inputTokens,
        outputTokens,
        cachedInputTokens,
        webSearchCount,
    };
}

const STRUCTURED_TYPES = new Set(['league', 'team', 'partners', 'fa_targets', 'rookies', 'fa_chat', 'mock_draft', 'chat', 'trade_verdict', 'team_diagnosis', 'dashboard_digest', 'insight', 'dynasty_read']);

interface GenericAIContext {
    callType: string;
    system: string;
    userPrompt: string;
    maxTokens: number;
    useWebSearch: boolean;
    leagueId: string | null;
    sessionId: string | null;
}

function parseContextPayload(context: any): any {
    if (typeof context !== 'string') return context || {};
    try {
        return JSON.parse(context);
    } catch {
        return { userMessage: context, messages: [{ role: 'user', content: context }] };
    }
}

function normalizeGenericAIContext(type: string, context: any): GenericAIContext | null {
    const parsed = parseContextPayload(context);
    const hasGenericShape = !!(
        parsed?.callType ||
        parsed?.system ||
        parsed?.userMessage ||
        Array.isArray(parsed?.messages) ||
        type === 'general' ||
        !STRUCTURED_TYPES.has(type)
    );
    if (!hasGenericShape) return null;

    const callType = String(parsed?.callType || type || 'recon-chat');
    let messages = Array.isArray(parsed?.messages)
        ? parsed.messages
            .filter((m: any) => m && typeof m.content === 'string')
            .map((m: any) => ({ role: String(m.role || 'user'), content: m.content }))
        : [];

    if (!messages.length && parsed?.userMessage) {
        messages = [{ role: 'user', content: String(parsed.userMessage) }];
    }
    if (!messages.length && typeof context === 'string') {
        messages = [{ role: 'user', content: context }];
    }

    const userPrompt = messages.length
        ? messages.map((m: any) => `${String(m.role || 'user').toUpperCase()}: ${m.content}`).join('\n')
        : `USER: ${JSON.stringify(parsed)}`;

    return {
        callType,
        system: String(parsed?.system || 'Dynasty fantasy football advisor. Values are DHQ on a 0-10000 league-adjusted scale. Be specific, practical, and concise.'),
        userPrompt,
        maxTokens: Math.max(100, Math.min(Number(parsed?.maxTokens) || 600, 4000)),
        useWebSearch: parsed?.useWebSearch === true,
        leagueId: parsed?.leagueId || parsed?.currentLeagueId || null,
        sessionId: parsed?.sessionId || parsed?.session_id || null,
    };
}

async function safeSupabaseData(query: any): Promise<any> {
    try {
        const { data } = await query;
        return data ?? null;
    } catch {
        return null;
    }
}

async function safeSupabaseWrite(query: any): Promise<void> {
    try {
        await query;
    } catch {
        // Analytics and post-response accounting must not break the user flow.
    }
}

// ── Server-side AI response cache ────────────────────────────────────────────
// Ambient insight surfaces are cached by a hash of their context so repeat
// views (and other devices) cost nothing. Cache hits bypass usage reservation
// entirely; fresh ambient calls reserve cost budgets but not request counts.

// Types whose analysis payload is a strict JSON array contract.
const JSON_ARRAY_TYPES = new Set(['dashboard_digest', 'insight']);

// Strip markdown fences the model may add despite instructions, then parse.
function parseJsonArray(text: string): any[] | undefined {
    let clean = String(text || '').trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    }
    try {
        const parsed = JSON.parse(clean);
        return Array.isArray(parsed) ? parsed : undefined;
    } catch {
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
            try {
                const parsed = JSON.parse(match[0]);
                return Array.isArray(parsed) ? parsed : undefined;
            } catch { /* fall through */ }
        }
    }
    return undefined;
}

const CACHEABLE_TYPES: Record<string, number> = {
    dashboard_digest: 24 * 60 * 60 * 1000,
    insight:          24 * 60 * 60 * 1000,
    // Diagnosis is keyed on the full roster context, so any roster move
    // naturally produces a fresh entry; 12h covers record/score drift.
    team_diagnosis:   12 * 60 * 60 * 1000,
    // Dynasty Read: web-search news synthesis, keyed on player+season+week and
    // NOT user-scoped, so one synthesis is shared across every user for the week.
    dynasty_read:     7 * 24 * 60 * 60 * 1000,
};

// User-scoped cache types include the caller identity in the key; team
// diagnosis is keyed purely on league/roster context (same roster state =>
// same diagnosis, regardless of which league member asks).
const USER_SCOPED_CACHE_TYPES = new Set(['dashboard_digest', 'insight']);

function stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const CACHE_KEY_IGNORED_FIELDS = new Set(['forceRefresh', 'system', 'sessionId', 'session_id', '_dhqContext']);

async function computeCacheKey(type: string, context: any, aiSession: AISession, prefsVersion = ''): Promise<string> {
    const parsed = parseContextPayload(context);
    const pruned: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsed || {})) {
        if (!CACHE_KEY_IGNORED_FIELDS.has(k)) pruned[k] = v;
    }
    const scope = USER_SCOPED_CACHE_TYPES.has(type) ? aiSession.identifier : 'shared';
    const raw = `${AI_POLICY_VERSION}|${type}|${scope}|${prefsVersion}|${stableStringify(pruned)}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── User preference learning loop ────────────────────────────────────────────
// Rolls the owner's recent feedback (ai_feedback table, via the ai-feedback
// edge function) into a compact block appended to structured system prompts.
// Fail-open: AI must work identically when no feedback exists.

async function fetchPreferenceSummary(aiSession: AISession, leagueId: string | null): Promise<Record<string, any> | null> {
    const supabase = cacheSupabaseClient();
    if (!supabase) return null;
    const data = await safeSupabaseData(supabase.rpc('get_ai_preference_summary', {
        p_identifier: aiSession.identifier,
        p_league_id: leagueId,
    }));
    if (!data || typeof data !== 'object' || !(data as any).total) return null;
    return data as Record<string, any>;
}

// Coarse version stamp for the response-cache key: cached ambient insights
// refresh when tendencies shift meaningfully, without churning on every
// single thumb. Accept rate is decile-rounded; volume is bucketed by 5s.
function prefsVersionFor(prefs: Record<string, any> | null): string {
    if (!prefs || !prefs.total) return 'p0';
    const decile = prefs.acceptRate != null ? Math.round(Number(prefs.acceptRate) * 10) : 'x';
    return `p${decile}:${Math.min(9, Math.floor(Number(prefs.total) / 5))}`;
}

function describeSubject(subject: any): string {
    if (!subject || typeof subject !== 'object') return '';
    const parts = ['player', 'pos', 'age', 'moveType', 'title']
        .map(k => subject[k])
        .filter(v => v !== null && v !== undefined && v !== '');
    return parts.join(' ').slice(0, 90);
}

function buildUserPreferenceBlock(prefs: Record<string, any> | null): string {
    if (!prefs || !prefs.total) return '';
    const lines: string[] = [];
    lines.push(`\n═══ USER PREFERENCE PROFILE (learned from this owner's reactions to past AI advice) ═══`);
    const accept = prefs.acceptRate != null ? Math.round(Number(prefs.acceptRate) * 100) : null;
    lines.push(`Feedback on ${prefs.total} recommendations in the last 90 days${accept != null ? ` — ${accept}% positively received` : ''}.`);
    const sc = prefs.surfaceCounts || {};
    const downSurfaces = Object.entries(sc)
        .filter(([, c]: [string, any]) => Number(c?.down || 0) > Number(c?.up || 0) + Number(c?.acted || 0))
        .map(([s]) => s);
    if (downSurfaces.length) {
        lines.push(`They frequently reject ${downSurfaces.join(', ')} advice — only repeat a previously rejected framing when the evidence is overwhelming, and acknowledge the change.`);
    }
    const actedSurfaces = Object.entries(sc)
        .filter(([, c]: [string, any]) => Number(c?.acted || 0) > 0)
        .map(([s]) => s);
    if (actedSurfaces.length) {
        lines.push(`They have acted on ${actedSurfaces.join(', ')} recommendations before — these carry weight, so be precise.`);
    }
    const downs = (prefs.recentDownSubjects || []).map(describeSubject).filter(Boolean).slice(0, 3);
    if (downs.length) lines.push(`Recently rejected: ${downs.join(' | ')}. Do not re-pitch these unless circumstances changed.`);
    const acted = (prefs.recentActedSubjects || []).map(describeSubject).filter(Boolean).slice(0, 3);
    if (acted.length) lines.push(`Recently acted on: ${acted.join(' | ')}. Similar profiles resonate with this owner.`);
    lines.push(`These are tendencies, not rules — quality thresholds and team-mode rules above ALWAYS take precedence.`);
    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

function cacheSupabaseClient(): any | null {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return null;
    return createClient(supabaseUrl, serviceRoleKey);
}

async function readAIResponseCache(cacheKey: string): Promise<{ analysis: string; model: string | null; usage: any } | null> {
    const supabase = cacheSupabaseClient();
    if (!supabase) return null;
    const row = await safeSupabaseData(
        supabase.from('ai_response_cache')
            .select('analysis, model, usage, hit_count, expires_at')
            .eq('cache_key', cacheKey)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle()
    );
    if (!row || typeof row.analysis !== 'string') return null;
    await safeSupabaseWrite(
        supabase.from('ai_response_cache')
            .update({ hit_count: (Number(row.hit_count) || 0) + 1 })
            .eq('cache_key', cacheKey)
    );
    return { analysis: row.analysis, model: row.model || null, usage: row.usage || null };
}

async function writeAIResponseCache(args: {
    cacheKey: string;
    type: string;
    aiSession: AISession;
    leagueId: string | null;
    model: string;
    analysis: string;
    usage: Record<string, any>;
    ttlMs: number;
}): Promise<void> {
    const supabase = cacheSupabaseClient();
    if (!supabase) return;
    await safeSupabaseWrite(supabase.from('ai_response_cache').upsert({
        cache_key: args.cacheKey,
        type: args.type,
        identifier: USER_SCOPED_CACHE_TYPES.has(args.type) ? args.aiSession.identifier : null,
        league_id: args.leagueId,
        model: args.model,
        analysis: args.analysis,
        usage: args.usage,
        hit_count: 0,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + args.ttlMs).toISOString(),
    }));
    // Opportunistic cleanup keeps the table small without a scheduled job.
    if (Math.random() < 0.05) {
        await safeSupabaseWrite(
            supabase.from('ai_response_cache').delete().lt('expires_at', new Date().toISOString())
        );
    }
}

// ── League Format Detection ──────────────────────────────────────────────────

interface LeagueFormat {
    isSuperFlex: boolean;
    isTEP: boolean;       // TE Premium (bonus rec for TE)
    isIDP: boolean;
    idpSlots: number;     // actual IDP-designated slots (DL, LB, DB, etc.)
    numQBSlots: number;   // starting QB + SUPER_FLEX slots that accept QB
    numTESlots: number;   // starting TE + FLEX slots
    numRBSlots: number;
    numWRSlots: number;
    rosterSize: number;
    benchSpots: number;
    starterCount: number;
    hasK: boolean;
    hasDST: boolean;
    scoringType: string;  // 'ppr' | 'half_ppr' | 'std' | 'custom'
    tePremiumBonus: number; // extra PPR bonus for TE (e.g. 0.5 means 1.5 PPR for TE)
}

function detectLeagueFormat(ctx: any): LeagueFormat {
    const rp: string[] = ctx.rosterPositions || ctx.roster_positions || [];
    const scoring = ctx.scoringSettings || ctx.scoring_settings || {};

    const sfSlots = rp.filter((s: string) => s === 'SUPER_FLEX').length;
    const qbSlots = rp.filter((s: string) => s === 'QB').length + sfSlots;
    const rbSlots = rp.filter((s: string) => s === 'RB').length;
    const wrSlots = rp.filter((s: string) => s === 'WR').length;
    const teSlots = rp.filter((s: string) => s === 'TE').length;
    const flexSlots = rp.filter((s: string) => s === 'FLEX' || s === 'REC_FLEX' || s === 'WRRB_FLEX').length;
    const idpSlots = rp.filter((s: string) => ['IDP_FLEX', 'DL', 'LB', 'DB', 'DE', 'CB', 'S'].includes(s)).length;
    const benchSpots = rp.filter((s: string) => s === 'BN').length;
    const starterSlots = rp.filter((s: string) => s !== 'BN' && s !== 'IR' && s !== 'TAXI').length;

    // TE Premium detection: check if TE gets extra receiving bonus
    const recBonus = scoring.rec || 0;
    const teBonusRec = scoring.bonus_rec_te || scoring.rec_te || 0;
    const tePremiumBonus = teBonusRec > 0 ? teBonusRec : 0;
    const isTEP = tePremiumBonus > 0;

    // Scoring type detection
    let scoringType = 'std';
    if (recBonus >= 1) scoringType = 'ppr';
    else if (recBonus >= 0.5) scoringType = 'half_ppr';
    else if (recBonus > 0) scoringType = 'custom';

    return {
        isSuperFlex: sfSlots > 0,
        isTEP,
        isIDP: idpSlots > 0,
        idpSlots,
        numQBSlots: qbSlots,
        numTESlots: teSlots,
        numRBSlots: rbSlots,
        numWRSlots: wrSlots,
        rosterSize: rp.length,
        benchSpots,
        starterCount: starterSlots,
        hasK: rp.includes('K'),
        hasDST: rp.includes('DEF'),
        scoringType,
        tePremiumBonus,
    };
}

function buildLeagueFormatBlock(fmt: LeagueFormat): string {
    const lines: string[] = [];

    if (fmt.isSuperFlex) {
        lines.push(`⚡ SUPERFLEX LEAGUE — ${fmt.numQBSlots} QB-eligible slots. QBs are the most valuable position. A team without 2 starting-caliber QBs has a CRITICAL deficit that overrides all other needs.`);
        lines.push(`  → QB scarcity multiplier: 1.8x. Every QB valuation, trade offer, and FAAB bid must reflect this premium.`);
        lines.push(`  → A team with only 1 startable QB should treat acquiring a second QB as their #1 priority above ALL other positions.`);
    }

    if (fmt.isTEP) {
        lines.push(`⚡ TE PREMIUM LEAGUE — TEs receive +${fmt.tePremiumBonus} bonus PPR (total: ${(fmt.tePremiumBonus + (fmt.scoringType === 'ppr' ? 1 : fmt.scoringType === 'half_ppr' ? 0.5 : 0)).toFixed(1)} PPR for TE). Elite TEs (top 5) are premium assets worth significantly more than standard leagues.`);
        lines.push(`  → TE scarcity multiplier: 1.5x. Do NOT treat TEs as interchangeable depth pieces.`);
    }

    if (fmt.isIDP) {
        lines.push(`⚡ IDP LEAGUE — ${fmt.idpSlots} defensive starter slots. LB/DL/DB have real fantasy value. Defensive studs (top-5 at their IDP position) are tradeable assets.`);
    }

    if (fmt.scoringType === 'ppr') {
        lines.push(`📊 FULL PPR scoring — high-volume pass catchers (slot WRs, receiving RBs, pass-catching TEs) carry premium value over pure rushers.`);
    } else if (fmt.scoringType === 'half_ppr') {
        lines.push(`📊 HALF PPR scoring — balanced value between volume receivers and efficient rushers.`);
    }

    // Positional scarcity context based on roster construction
    const rbDemand = fmt.numRBSlots + Math.floor(fmt.starterCount * 0.3); // RBs fill FLEX too
    if (rbDemand >= 3) {
        lines.push(`🔴 RB SCARCITY — ${fmt.numRBSlots} dedicated RB slots plus FLEX competition means startable RBs are at a premium. Do NOT recommend trading away RB depth lightly.`);
    }

    return lines.length > 0
        ? `\n═══ LEAGUE FORMAT CONTEXT (critically important — adjust ALL valuations accordingly) ═══\n${lines.join('\n')}\n═══════════════════════════════════════════════════════════════════════════════════════\n`
        : '';
}

// ── Team Mode Context ────────────────────────────────────────────────────────

function buildTeamModeBlock(ctx: any): string {
    const tier = ctx.teamTier || ctx.tier || '';
    const window = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;

    if (!tier && !window) return '';

    const lines: string[] = [];
    lines.push(`\n═══ TEAM COMPETITIVE MODE (critically important — drives ALL recommendations) ═══`);

    const mode = tier.toUpperCase();
    if (mode === 'REBUILDING' || window === 'REBUILDING') {
        lines.push(`🔨 THIS TEAM IS IN REBUILD MODE (Health: ${healthScore}/100)`);
        lines.push(`REBUILD RULES — strictly enforce these:`);
        lines.push(`  1. PRIORITIZE YOUTH: Target players aged 24 and under. Players over 28 are sell candidates, not buy targets.`);
        lines.push(`  2. ACCUMULATE DRAFT PICKS: Every trade recommendation should seek to acquire future draft capital. Early-round picks (1st-2nd) are the #1 currency.`);
        lines.push(`  3. DO NOT RECOMMEND aging veterans — even if they fill a positional need. A rebuilding team does NOT need a 30-year-old WR2 for "depth."`);
        lines.push(`  4. SELL declining assets aggressively: Any player past peak with 2+ years of decline should be moved for picks or young talent.`);
        lines.push(`  5. FAAB RESTRAINT: Only spend FAAB on young upside plays (age ≤25) or injury replacements for trade-value players. Do NOT recommend bidding on replacement-level veterans.`);
        lines.push(`  6. PATIENCE > DEPTH: A rebuild team should NOT be told to "add depth." They should be told to stockpile assets and wait.`);
    } else if (mode === 'ELITE' || mode === 'CONTENDER' || window === 'CONTENDING') {
        lines.push(`🏆 THIS TEAM IS CONTENDING (${mode} tier, Health: ${healthScore}/100)`);
        lines.push(`CONTENDER RULES — strictly enforce these:`);
        lines.push(`  1. WIN-NOW ASSETS: Prioritize proven producers who can contribute THIS season. Age matters less than immediate output.`);
        lines.push(`  2. FILL GAPS: Identify the weakest starting position and fix it. A contender with a QB2 problem should solve it NOW.`);
        lines.push(`  3. TRADE FUTURE PICKS FOR PRESENT TALENT: Contenders should be willing to move 2nd/3rd round picks for upgrades.`);
        lines.push(`  4. DEPTH MATTERS for contenders — but only QUALITY depth (top-24 at position, minimum). Do NOT recommend adding low-end bench players.`);
        lines.push(`  5. FAAB AGGRESSION on difference-makers: If a player would start, bid aggressively. If they'd be WR5 on the bench, skip them.`);
    } else if (mode === 'CROSSROADS' || window === 'TRANSITIONING') {
        lines.push(`⚖️ THIS TEAM IS AT A CROSSROADS (Health: ${healthScore}/100)`);
        lines.push(`CROSSROADS RULES:`);
        lines.push(`  1. EVALUATE the core: Can this team compete in 1-2 years with targeted upgrades, or should they sell and rebuild?`);
        lines.push(`  2. DO NOT half-commit: Either push to contend (trade picks for upgrades) or commit to rebuild (trade vets for picks/youth).`);
        lines.push(`  3. Players aged 27-29 with declining production are the priority sell candidates.`);
        lines.push(`  4. FAAB: Moderate spending. Target young upside + immediate starters only. Skip replacement-level additions.`);
    }

    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

// ── Trade Partner Mode Awareness ─────────────────────────────────────────────
// The other side of a trade values assets through their own competitive mode.
// Rebuilders want picks and youth; contenders want proven starters now.

function buildPartnerModeBlock(partner: any): string {
    if (!partner) return '';
    const tier = String(partner.tier || partner.teamTier || '').toUpperCase();
    const window = String(partner.window || partner.teamWindow || partner.tradeWindow || '').toUpperCase();
    if (!tier && !window) return '';

    const lines: string[] = [];
    lines.push(`\n═══ TRADE PARTNER MODE (what the OTHER side actually values) ═══`);
    const label = partner.owner ? `${partner.owner} ` : '';
    if (tier === 'REBUILDING' || window === 'REBUILDING') {
        lines.push(`🔨 ${label}is REBUILDING. They value: draft picks (1sts/2nds above all), players aged ≤24 with upside, cap/FAAB flexibility.`);
        lines.push(`  → They will NOT pay fair value for veterans aged 27+. Do not frame aging assets as the centerpiece of an offer to them.`);
        lines.push(`  → Offers built around picks and youth get accepted; offers built around "proven producers" get rejected or lowballed.`);
    } else if (tier === 'ELITE' || tier === 'CONTENDER' || window === 'CONTENDING') {
        lines.push(`🏆 ${label}is CONTENDING. They value: proven starters who help THIS season, immediate positional upgrades.`);
        lines.push(`  → They will pay a premium (including future picks) for win-now talent at a position of need.`);
        lines.push(`  → They will NOT value speculative youth or distant picks at full price — those are your acquisition discounts, not selling points.`);
    } else {
        lines.push(`⚖️ ${label}is at a CROSSROADS. They are deciding between pushing and tearing down — offers that decisively help either path land better than balanced "depth" swaps.`);
    }
    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

// ── Dynamic Positional Scarcity ──────────────────────────────────────────────
// When the client passes real league-wide supply counts, emit computed
// scarcity indices instead of relying only on static format multipliers.
// Degrades silently when the data is absent.

function buildScarcityBlock(ctx: any): string {
    const supply = ctx?.positionalSupply;
    if (!supply || typeof supply !== 'object') return '';
    const fmt = detectLeagueFormat(ctx);
    const teamCount = Number(ctx.teamCount || ctx.numTeams || 12);

    const demandByPos: Record<string, number> = {
        QB: fmt.numQBSlots * teamCount,
        RB: (fmt.numRBSlots + 1) * teamCount, // +1 approximates FLEX pressure
        WR: (fmt.numWRSlots + 1) * teamCount,
        TE: Math.max(fmt.numTESlots, 1) * teamCount,
    };

    const lines: string[] = [];
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        const startable = Number(supply[pos]);
        if (!Number.isFinite(startable) || startable <= 0) continue;
        const demand = demandByPos[pos];
        const ratio = startable / demand;
        if (ratio < 0.85) {
            lines.push(`🔴 ${pos}: only ${startable} startable league-wide vs ~${demand} starting slots — SEVERE scarcity. Holders of quality ${pos}s have major trade leverage; never sell below market.`);
        } else if (ratio < 1.1) {
            lines.push(`🟠 ${pos}: ${startable} startable vs ~${demand} slots — tight market. Expect to overpay slightly to acquire; depth here is a real asset.`);
        } else {
            lines.push(`🟢 ${pos}: ${startable} startable vs ~${demand} slots — adequate supply. Do not overpay; replacements exist on the wire or in cheap trades.`);
        }
    }
    return lines.length
        ? `\n═══ LIVE POSITIONAL SCARCITY (computed from this league's actual player pool) ═══\n${lines.join('\n')}\n═══════════════════════════════════════════════════════════════════════════════════════\n`
        : '';
}

// ── Minimum Quality Thresholds ──────────────────────────────────────────────

function buildQualityThresholdBlock(): string {
    return `
═══ MINIMUM QUALITY THRESHOLDS (apply to ALL FA/FAAB/waiver recommendations) ═══
⛔ DO NOT recommend adding or bidding on players who meet ANY of these criteria:
  • DHQ below 500 (replacement-level talent — not worth a roster spot in competitive leagues)
  • PPG below 5.0 in their most recent season with 6+ games played
  • Players with no NFL stats in the last 2 seasons (unless they are rookies)
  • Veterans (age 27+) with declining trend who would not crack the starting lineup

✅ ONLY recommend FAAB spending when the player would:
  • Start or be the first backup at a position of need, OR
  • Be a high-upside young player (age ≤25) worth a speculative hold, OR
  • Replace an injured starter (emergency depth pickup)

💰 FAAB DISCIPLINE:
  • "Depth for depth's sake" is NEVER a valid reason to spend FAAB
  • A $1 bid on a bad player is still a wasted roster spot
  • If no quality targets exist at a position, say "HOLD YOUR FAAB" — do not invent targets
  • Remaining FAAB is a weapon for mid-season breakouts and injuries — preserve it
═══════════════════════════════════════════════════════════════════════════════════════
`;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx?: any): string {
    const leagueFmt = ctx ? detectLeagueFormat(ctx) : null;
    const fmtBlock = leagueFmt ? buildLeagueFormatBlock(leagueFmt) : '';
    const modeBlock = ctx ? buildTeamModeBlock(ctx) : '';
    const scarcityBlock = ctx ? buildScarcityBlock(ctx) : '';
    const qualityBlock = buildQualityThresholdBlock();

    return `You are an elite dynasty fantasy football analyst with deep expertise in player values, team-building strategy, and trade negotiation psychology. You analyze leagues with the precision of a sports analytics team combined with the strategic instinct of a seasoned GM.

You have access to live data: Sleeper rosters and standings, FantasyCalc dynasty player values, and behavioral profiles of each owner (their DNA/trading personality derived from actual trade history).
${fmtBlock}${modeBlock}${scarcityBlock}${qualityBlock}
Your analysis must be:
- Specific and data-driven — name owners, cite records, reference actual roster compositions
- Actionable — concrete recommendations an owner can act on today
- Psychologically sharp — factor in owner DNA and negotiation leverage
- Confident and direct — write like a seasoned scout, not a chatbot
- CONTEXTUALLY AWARE — every recommendation must respect the team's competitive mode (rebuild/contend/crossroads) and the league's format (superflex/TEP/IDP/scoring type)

CRITICAL RULES:
1. Never recommend a rebuilding team acquire aging veterans for "depth"
2. Never recommend spending FAAB on replacement-level players (DHQ < 500, PPG < 5.0)
3. In superflex leagues, ALWAYS flag QB needs as the top priority if a team lacks 2 starters
4. In TE premium leagues, value elite TEs 1.5x higher than standard leagues
5. "Add depth" is only valid advice for CONTENDING teams at positions where the depth player would actually start in case of injury to a top-24 player

Format with **bold headers** for each section. Keep total response under 1200 words.`
    + (ctx?._dhqContext ? '\n\n--- WAR ROOM CONTEXT ---\n' + ctx._dhqContext : '');
}

function formatTeamsForPrompt(teams: any[]): string {
    return teams.map(t => {
        const flag = t.isMyTeam ? ' ← MY TEAM' : '';
        return `• ${t.owner} (${t.record}) | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | DNA: ${t.dna || 'Unknown'} | Posture: ${t.posture || 'N/A'}${flag}
  Strengths: ${(t.strengths || []).join(', ') || 'none'}
  Needs: ${(t.needs || []).join(', ') || 'none'} (positions marked * are critical deficits)`;
    }).join('\n');
}

function buildLeaguePrompt(ctx: any): string {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);

    return `Analyze this dynasty fantasy football league.

**League:** ${ctx.leagueName} | Season: ${ctx.season} | ${ctx.teams.length} teams
**My Team:** ${ctx.myOwner}
${fmtBlock}
**TEAM DATA:**
${formatTeamsForPrompt(ctx.teams)}

Provide:
**LEAGUE LANDSCAPE** — 3-4 sentence overview of competitive balance${fmt.isSuperFlex ? '. Note which teams have QB advantages/deficits in this superflex format.' : ''}
**POWER RANKINGS** — Top 3 teams and specifically why they're winning
**REBUILDERS TO WATCH** — Teams in rebuild mode with the most upside. Emphasize their youth and draft capital, not veteran depth.
**DANGER ZONE** — Teams in trouble and why
**KEY STORYLINES** — 2-3 compelling narratives in this league right now
**CHAMPIONSHIP WINDOW** — Who wins this league over the next 1-3 years and why`;
}

function buildTeamPrompt(ctx: any): string {
    const t = ctx.team;
    const isMyTeam = t.isMyTeam === true;

    const rosterStr = (t.roster || []).map((p: any) =>
        `  ${p.pos} | ${p.name} (${p.team}) | Value: ${p.value}${p.isElite ? ' ★ELITE' : ''}${p.age ? ` | Age ${p.age}` : ''}`
    ).join('\n');

    // Build detailed pick breakdown with per-year flagging
    const pa = t.picksAssessment;
    let pickDetail = t.picksText || 'No pick data available';
    if (pa && pa.pickCountByYear && pa.pickYears) {
        const yearLines = (pa.pickYears as string[]).map((yr: string) => {
            const count = pa.pickCountByYear[yr] ?? 0;
            const firstCount = pa.pickCountByYearRound?.[yr]?.[1] ?? 0;
            if (count === 0) return `  ${yr}: ⚠️ ZERO PICKS — cannot participate in ${yr} rookie draft`;
            const firstNote = firstCount > 0 ? ` (${firstCount} first-round${firstCount > 1 ? 's' : ''} 🔑)` : ' (no 1st rounders)';
            return `  ${yr}: ${count} pick${count > 1 ? 's' : ''}${firstNote}`;
        }).join('\n');
        pickDetail = `${t.picksText}\nYear-by-year breakdown:\n${yearLines}`;
    }

    // Top 10 most valuable players for value-anchoring trade advice
    const topValues = (t.roster || [])
        .slice(0, 10)
        .map((p: any) => `${p.name} (${p.pos}, ${p.value})`)
        .join(', ');

    // League format context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock({ teamTier: t.tier, teamWindow: t.tradeWindow || t.window, healthScore: t.healthScore });

    // Superflex QB audit
    let sfQBNote = '';
    if (fmt.isSuperFlex) {
        const qbs = (t.roster || []).filter((p: any) => p.pos === 'QB');
        const startableQBs = qbs.filter((p: any) => p.value >= 2000).length;
        if (startableQBs < fmt.numQBSlots) {
            sfQBNote = `\n⚠️ SUPERFLEX QB CRISIS: This team has only ${startableQBs} startable QB(s) for ${fmt.numQBSlots} QB-eligible slots. QB acquisition MUST be the #1 recommendation regardless of other needs.\n`;
        }
    }

    const negotiationSection = isMyTeam
        ? `**MY NEGOTIATION STRATEGY** — I am ${t.owner}. Based on my ${t.dna} DNA and current roster situation, how should I approach trade negotiations? What leverage do I have, what should I lead with, and what traps should I avoid?`
        : `**NEGOTIATION PLAYBOOK** — ${ctx.myOwner ? `I am ${ctx.myOwner} looking to trade with ${t.owner}.` : ''} Based on ${t.owner}'s ${t.dna} DNA profile, how should I approach negotiating with this owner? What buttons to push, what to avoid, how to frame offers?`;

    const tradeMovesSection = isMyTeam
        ? `**TOP RECOMMENDED MOVES** — 2-3 specific, value-balanced trades I (${t.owner}) should pursue to improve my team. For each: name the player I want to acquire, what I should offer from MY OWN roster in return, and why the other owner says yes. Trades MUST align with my team mode: ${t.tier === 'REBUILDING' ? 'target youth and picks, sell aging assets' : t.tier === 'ELITE' || t.tier === 'CONTENDER' ? 'target win-now upgrades, willing to move future picks' : 'either push to contend or commit to rebuild — no half-measures'}.`
        : `**TOP RECOMMENDED MOVES** — I am ${ctx.myOwner || 'the logged-in owner'}. Give me 2-3 specific players I should target from ${t.owner}'s roster. For each: (1) name the ${t.owner} player I want, (2) describe what I should offer FROM MY OWN ASSETS — NOT ${t.owner}'s players, (3) explain why ${t.owner} would accept. CRITICAL: I am making the offer. Do NOT suggest ${t.owner} trade their own players to themselves.`;

    return `Provide a comprehensive scouting report on **${t.owner}**'s team in ${ctx.leagueName}.${isMyTeam ? ' This is MY OWN team — give me honest self-assessment and first-person strategic advice.' : ` I am ${ctx.myOwner || 'the logged-in owner'} scouting this team for trade opportunities.`}
${fmtBlock}${modeBlock}${sfQBNote}

**TEAM OVERVIEW:** ${t.record} | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | Posture: ${t.posture}
**OWNER DNA:** ${t.dna}${t.dnaDescription ? ` — ${t.dnaDescription}` : ''}
**STATED NEEDS:** ${(t.needs || []).join(', ') || 'none identified'}
**STATED STRENGTHS:** ${(t.strengths || []).join(', ') || 'none identified'}
**DRAFT CAPITAL:** ${pickDetail}
**FAAB:** ${t.faabText || (t.waiverBudget > 0 ? `$${t.faabRemaining} of $${t.waiverBudget} remaining` : 'No FAAB system')}

**ROSTER (by position, sorted by value — scale 0-10,000):**
${rosterStr || 'No roster data available'}

**TOP 10 BY VALUE:** ${topValues || 'N/A'}
${ctx.myOwner && !isMyTeam ? `**MY TEAM (the owner requesting this analysis):** ${ctx.myOwner}\n` : ''}

TRADE RECOMMENDATION RULES (strictly enforce):
- Values are on a 0-10,000 scale. Only propose trades where combined values are within ~20% of each other.
- Never suggest offering a low-value player for a clearly higher-value target (e.g. do not offer a 1,500-value DB for a 4,000-value RB).
- Respect positional market rates: elite RBs and QBs command premium return; DBs, LBs, and depth pieces do not.
- A player with a high value (4,000+) is likely a borderline elite — do not frame them as depth or "cheap filler."
- Only recommend trades that a reasonable opposing owner would actually accept.
- When analyzing another owner's team, all trade offers come FROM the requesting owner — never from the team being analyzed.

Provide:
**TEAM IDENTITY** — What type of contender/rebuilder/pretender is this? (2-3 sentences)
**CORE STRENGTHS** — What does this team do well? Name the specific players driving it
**CRITICAL WEAKNESSES** — Where are the real gaps? Be brutally honest
**DRAFT CAPITAL & FAAB** — Zero-pick years are a crisis. Pick-rich years are leverage. Assess accordingly and state what it means for their ability to add talent.
**TRADE OUTLOOK** — Buyer, seller, or holding? What should they target vs. deal away?
${tradeMovesSection}
${negotiationSection}`;
}

function buildPartnersPrompt(ctx: any): string {
    const partnersStr = ctx.partners.map((p: any, i: number) =>
        `${i + 1}. ${p.owner} (${p.record}) | Compat: ${p.compatibility}% | ${p.tier} | DNA: ${p.dna} | Posture: ${p.posture}
   Strengths: ${(p.strengths || []).join(', ')}
   Needs: ${(p.needs || []).join(', ')}${p.grudgeEntries > 0 ? ` | Trade history: ${p.grudgeEntries} logged interactions` : ''}`
    ).join('\n');

    return `I'm **${ctx.myTeam.owner}** looking for the best trading partners in ${ctx.leagueName}.

**MY TEAM:** ${ctx.myTeam.record} | ${ctx.myTeam.tier} | Health: ${ctx.myTeam.healthScore}/100 | Posture: ${ctx.myTeam.posture}
My Strengths: ${(ctx.myTeam.strengths || []).join(', ')}
My Needs: ${(ctx.myTeam.needs || []).join(', ')}

**ALL OWNERS (ranked by trade compatibility):**
${partnersStr}

PARTNER MODE RULES (apply to every partner you recommend):
- REBUILDING partners accept offers built on draft picks and players aged ≤24. They reject or lowball offers centered on veterans 27+.
- CONTENDING partners pay premiums (including future picks) for proven starters at positions of need. They discount speculative youth and distant picks.
- CROSSROADS partners respond to offers that decisively push them one direction — not balanced "depth" swaps.
Frame every suggested offer in terms of what THAT partner's mode makes them want, not just what I need.

Identify my top 3 trading partners and one sleeper pick:

**TRADE PARTNER #1: [NAME]**
- Why they're a great target
- What I should offer (my surplus fills their need)
- What I should target (their surplus fills my need)
- Negotiation strategy based on their DNA

**TRADE PARTNER #2: [NAME]**
[same format]

**TRADE PARTNER #3: [NAME]**
[same format]

**SLEEPER PICK** — One overlooked partner most would miss and exactly why`;
}

function buildFATargetsPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Age ${p.age ?? '?'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}${p.dhq ? ` | DHQ ${p.dhq}` : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 50).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | ${fa.gp ? `${fa.gp}gp` : ''} | ${fa.avg ? `${fa.avg}avg` : ''} | Age ${fa.age ?? '?'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}${fa.dhq ? ` | DHQ ${fa.dhq}` : ''}`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    // Detect league format for context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);

    // Team mode context
    const teamMode = ctx.teamTier || ctx.tier || 'UNKNOWN';
    const teamWindow = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;
    const modeBlock = buildTeamModeBlock(ctx);

    // Count QBs on roster for superflex urgency
    let qbCount = 0;
    let qbWarning = '';
    if (fmt.isSuperFlex) {
        qbCount = (ctx.myRoster || []).filter((p: any) => p.pos === 'QB' && p.isStarter).length;
        if (qbCount < fmt.numQBSlots) {
            qbWarning = `\n⚠️ CRITICAL: This team has only ${qbCount} starting QB(s) in a ${fmt.numQBSlots}-QB-slot league. QB acquisition is the #1 PRIORITY. Any available QB with DHQ > 1000 should be the first recommendation.`;
        }
    }

    return `Build a free agency action plan for **${ctx.myOwner}** in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**TEAM STATUS:** ${teamMode} tier | Health: ${healthScore}/100 | Window: ${teamWindow || 'Unknown'}
**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}${ctx.faabMinBid > 0 ? `\n**MINIMUM BID:** $${ctx.faabMinBid} (league rule — never suggest below this)` : ''}
**STARTING LINEUP SPOTS:** ${rosterPositions}
${qbWarning}

**MY CURRENT ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

FAAB RECOMMENDATION RULES (strictly enforce):
1. QUALITY FLOOR: Do NOT recommend any player with DHQ < 500 or season PPG < 5.0 (with 6+ games). "Just for depth" is NOT a valid reason.
2. TEAM MODE MATTERS:
   - REBUILDING teams: Only recommend young upside plays (age ≤25) or injury emergency pickups. Do NOT suggest veteran depth adds.
   - CONTENDING teams: Recommend players who would immediately start or be first-in-line backup. Skip low-end bench filler.
   - CROSSROADS teams: Target young starters only. No speculative depth.
3. FAAB PRESERVATION: If fewer than 3 quality targets exist, explicitly say "HOLD YOUR FAAB for mid-season opportunities." Do NOT pad the list with marginal players.
4. If the available player pool is weak, SAY SO. "There are no impactful additions available right now" is a valid and HELPFUL answer.

Provide:
**ROSTER AUDIT** — 2-3 sentences: current strengths and the biggest gaps to address, framed for the team's competitive mode
**TOP FA TARGETS** — Up to 5-7 specific free agents I should pursue (ONLY those meeting quality thresholds), each with:
  - Why they fit my roster (positional need, age profile, upside)
  - Suggested FAAB bid ($X–$Y range) — proportional to impact and remaining budget
  - Priority tier (must-win bid / competitive / speculative)
  - If fewer than 3 quality targets exist, stop and say so. Do NOT recommend bad players to fill the list.
**BUDGET STRATEGY** — How to allocate the $${ctx.faabBudget} remaining. Include explicit "save X% for mid-season" guidance.
**WAIVER WIRE APPROACH** — Aggressive or patient? Tied to team mode: rebuilders should be patient, contenders should be targeted.`;
}

function buildRookiesPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}`
    ).join('\n');

    const rookieStr = (ctx.availableRookies || []).map((r: any) =>
        `  ${r.pos} ${r.name} (${r.team})`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    // Build draft pick summary from fully-resolved pick list (same logic as trade-calculator)
    const myPicks: any[] = ctx.myDraftPicks || [];
    const standardTotal: number = ctx.standardPickTotal || 21;
    const totalPicks = myPicks.length;

    let pickSummary: string;
    if (totalPicks === 0) {
        pickSummary = `⚠️ ZERO DRAFT PICKS — This owner has NO draft picks across any future season. They cannot participate in the rookie draft at all. Acquiring draft capital via trade must be the #1 priority.`;
    } else {
        const byYear: Record<string, number[]> = {};
        for (const p of myPicks) {
            const yr = String(p.year);
            if (!byYear[yr]) byYear[yr] = [];
            byYear[yr].push(p.round);
        }
        const pickLines = Object.entries(byYear)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([yr, rounds]) => `  ${yr}: Rounds ${rounds.sort((a: number, b: number) => a - b).join(', ')}`)
            .join('\n');
        const deficit = standardTotal - totalPicks;
        const statusNote = deficit > 0
            ? `${totalPicks} of ${standardTotal} standard picks — ${deficit} picks below a full slate.`
            : totalPicks > standardTotal
            ? `${totalPicks} picks — ${totalPicks - standardTotal} above the ${standardTotal}-pick baseline (strong capital).`
            : `${totalPicks} picks — full standard slate.`;
        pickSummary = `${statusNote}\n${pickLines}`;
    }

    // League format context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);

    return `Provide a rookie draft strategy for **${ctx.myOwner}** in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**STARTING LINEUP SPOTS:** ${rosterPositions}

**DRAFT PICK STATUS:**
${pickSummary}

**MY CURRENT ROSTER (with experience):**
${rosterStr || 'No roster data'}

**AVAILABLE ROOKIES (not on any roster):**
${rookieStr || 'No rookies available'}

CRITICAL INSTRUCTION: Base your entire strategy on the draft pick status above. If the owner has zero picks, do NOT recommend specific draft picks — instead focus your advice entirely on how to acquire picks via trade (what assets to offer, which roster positions to sell high on) and which rookies are worth targeting in trades post-draft.

Provide:
**DRAFT PICK SITUATION** — Clearly state how many picks this owner has and what it means for their draft strategy.
**ROSTER NEEDS ANALYSIS** — Which positions are thin, aging, or lack upside?
**STRATEGY** — If they have picks: BPA vs. positional need advice. If they have NO picks: specific trade strategies to acquire picks or post-draft rookie values to target.
**TARGET ROOKIES** — Top rookies that fit this team's needs (for drafting if picks exist, or for trade acquisition if not).
**SLEEPER PICKS** — 1-2 overlooked rookies worth targeting (via draft or trade).`;
}

function buildMockDraftPrompt(ctx: any): string {
    const isIDP = ctx.isIDP === true;

    const slotsStr = (ctx.draftSlots || []).map((o: any) => {
        let line = `Slot ${o.slot}: ${o.name} | Trade DNA: ${o.dna}`;
        if (o.draftDna)       line += ` | Draft Label: ${o.draftDna}`;
        if (o.roundProfile)   line += `\n         Round splits: ${o.roundProfile}`;
        else if (o.draftTendency) line += ` (${o.draftTendency})`;
        // Flag if they have unusually high early-round defensive picks
        if (o.earlyDefPct !== null && o.earlyDefPct > 10) {
            line += `\n         ⚠ Takes defenders in R1-R2 ${o.earlyDefPct}% of the time (NFL avg: 9%)`;
        }
        if (o.needs?.length)  line += `\n         Needs: ${o.needs.join(', ')}`;
        return line;
    }).join('\n');

    const playersStr = (ctx.players || []).map((p: any) =>
        `${p.fantasyRank}. ${p.name} | ${p.pos} | Tier ${p.tier}`
    ).join('\n');

    const draftTypeLabel = ctx.draftType === 'snake'
        ? 'SNAKE (odd rounds pick left→right, even rounds pick right→left)'
        : 'LINEAR (same slot order every round)';

    const idpNote = isIDP
        ? `• This IS an IDP (Individual Defensive Player) league — LB, DL, DB are valid picks at any round IF the owner has a confirmed Need for that position.`
        : `• This is a STANDARD fantasy league (NOT IDP). Defensive positions (LB, DL, DB, S, CB, EDGE) score ZERO fantasy points and are almost never drafted early.`;

    return `Simulate a complete ${ctx.numRounds}-round rookie draft with ${ctx.numTeams} teams in ${ctx.leagueName || 'the league'}.

DRAFT TYPE: ${draftTypeLabel}

OWNER PROFILES (slot → name → Trade DNA → Draft DNA from 3 seasons of real picks → round splits → needs):
${slotsStr}

DRAFT DNA LABELS (derived from real owner pick history):
• QB-Hunter   → Has taken QB in round 1 historically
• QB-Hungry   → >15% of picks are QB
• RB-Heavy    → >38% of picks are RB
• WR-First    → >38% of picks are WR
• TE-Premium  → >15% of picks are TE
• DEF-Early   → Unusually takes defenders in R1-R2 (rare — >20% of their early picks)
• QB-Avoider  → Never or rarely drafts QB before round 4
• Balanced    → No strong positional bias
The "Round splits" line shows what each owner ACTUALLY drafts by round group across 3 seasons.
When Draft DNA conflicts with current Needs, current Needs take priority for critical gaps (0 starters at a position).

AVAILABLE PLAYERS (fantasy-ranked — #1 = highest fantasy value, defenders already deprioritized):
Players are ordered by fantasy scoring potential, not NFL draft consensus.
QB/RB/WR float to the top; EDGE/OLB rank above CB/S; CB/S/DL sink to the bottom of the pool.
Within the defender tier: EDGE = OLB > LB > CB > S > DL. Never pick a CB before a same-tier EDGE or OLB.
Pick from this list in order — #1 is the top remaining fantasy asset:
${playersStr}

═══════════════════════════════════════════════════════
REAL NFL DRAFT BASELINE — ground your simulation here
═══════════════════════════════════════════════════════
Across 2023, 2024, and 2025 NFL drafts (96 picks in rounds 1-2):
  • Only 9 of 96 picks (9%) were defenders — all were Edge rushers or OLBs
  • ZERO CBs, safeties, LBs, or DTs were taken in rounds 1-2
  • Across all rounds: ~32% of picks are defenders — but concentrated heavily in rounds 4-7

Dynasty fantasy owners mirror this behavior. In a realistic dynasty rookie draft:
  Round 1: 90%+ skill positions (QB/RB/WR/TE). A defender in round 1 is extremely rare.
  Round 2: 90%+ skill positions. The occasional EDGE rusher only in IDP leagues.
  Round 3-5: Mostly skill positions, a few EDGE/OLB may appear.
  Round 6+: Defenders become more common — up to 30-40% of late picks.
${idpNote}

═══════════════════════════════════════════════════════
FANTASY FOOTBALL POSITIONAL SCORING RULES
═══════════════════════════════════════════════════════
Fantasy points come from OFFENSE only in standard leagues.

SCORING POSITIONS (target these):
  QB  — Scarce. A team without a QB starter MUST address early.
  RB  — Premium volume scorer. Top RBs are always R1-R2 value.
  WR  — Receiver depth needed. Strong R1-R4 value.
  TE  — Elite TEs are assets; depth TEs are round 5+ picks.

NON-SCORING IN STANDARD LEAGUES (almost never draft before round 6):
  EDGE, LB, CB, S, DL — contribute zero to fantasy scores. Only valid early in IDP leagues.

ROUND-BY-ROUND POSITIONAL RULES (strictly enforce):
  Round 1: QB / RB / WR only. No defenders. No exceptions in standard leagues.
  Round 2: QB / RB / WR / TE. No defenders. EDGE only if owner is flagged DEF-Early AND it's IDP.
  Round 3-4: Skill positions. EDGE/OLB may appear if owner's round splits show it. If a defender IS taken, it must be EDGE or OLB — never CB, S, or DL before round 5.
  Round 5+: Any position is fair game, guided by owner's actual round-split profile.

CRITICAL: If an owner's "Round splits" show their R1-2 picks are 100% skill positions historically,
simulate them drafting 100% skill positions in rounds 1-2. Don't add defenders just to vary picks.

DNA DRAFT BEHAVIOR (apply AFTER positional rules above):
• Win Now       → Immediate contributors at QB/RB/WR who can start this season.
• Rebuilder     → Ceiling over floor. Raw upside at any OFFENSIVE position.
• Value Drafter → Strict BPA among offensive players. Trusts consensus rankings.
• Need Drafter  → Fills offensive roster gaps first. Reaches 3-5 spots for a critical need.
• Contrarian    → Takes offensive players ranked 8-15 spots below expectations.
• Risk Averse   → Safe college producers at skill positions. No boom-or-bust gambles.
• Aggressive    → Reaches 3-8 spots for high-upside offensive plays.
• Unknown       → Balanced BPA among offensive players with mild positional awareness.

CRITICAL SIMULATION RULES:
1. Each player can only be selected ONCE — track every pick and never repeat a player name
2. Process picks in the correct draft order based on DRAFT TYPE above
3. EVERY pick must reflect that specific owner's DNA and round-split profile
4. Round 1: ONLY QB, RB, or WR — no TE, no defenders, in a standard league
5. Round 2: QB, RB, WR, or TE only — still no defenders in standard leagues
6. Use each owner's "Round splits" data as the primary guide for when they take each position type
7. The "reason" field must be 10-15 words referencing DNA behavior, positional need, or roster fit
8. ZERO-QB EMERGENCY RULE (highest priority, overrides everything):
   If an owner has QB in their Needs AND the #1 or #2 ranked available player is a QB, that owner
   MUST take the QB — no exceptions, no DNA override, no "but they're WR-First". An owner with
   zero QBs who skips the top available QB when it's sitting at #1 or #2 is a simulation error.
   QB NEED RULE: If an owner's Needs include QB AND a QB is ranked in the top 5 of the available
   player pool, that owner WILL take the QB with their next pick. DNA is secondary to critical need.

Output ONLY a valid JSON array with no extra text, no markdown, no backticks:
[{"pick":1,"round":1,"slot":1,"owner":"Name","player":"Exact Player Name","pos":"WR","tier":1,"reason":"DNA-driven reason in exactly 10-15 words"},...]`;
}

function buildFAChatPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 30).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}`
    ).join('\n');

    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);

    return `You are advising **${ctx.myOwner}** on their free agency strategy in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**TEAM STATUS:** ${ctx.teamTier || 'Unknown'} tier | Health: ${ctx.healthScore || '?'}/100
**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}${ctx.faabMinBid > 0 ? `\n**MINIMUM BID:** $${ctx.faabMinBid} (league rule — never suggest below this)` : ''}

**MY ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

Remember: Never recommend spending FAAB on replacement-level players. Quality over quantity.

**Question:** ${ctx.question}`;
}

// ── Trade verdict (AI second opinion on a graded deal) ───────────────────────

function formatDealSide(side: any): string {
    if (!side) return '  (nothing)';
    const parts: string[] = [];
    for (const p of side.players || []) {
        parts.push(`  ${p.pos || '?'} ${p.name}${p.age ? ` | Age ${p.age}` : ''}${p.value != null ? ` | Value ${p.value}` : ''}`);
    }
    for (const pk of side.picks || []) {
        parts.push(`  PICK ${pk.year || '?'} Round ${pk.round || '?'}${pk.value != null ? ` | Value ${pk.value}` : ''}`);
    }
    if (side.faab) parts.push(`  FAAB $${side.faab}`);
    return parts.join('\n') || '  (nothing)';
}

function buildTradeVerdictPrompt(ctx: any): string {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const my = ctx.myTeam || {};
    const partner = ctx.partnerTeam || {};
    const myModeBlock = buildTeamModeBlock({ teamTier: my.tier, teamWindow: my.window || my.tradeWindow, healthScore: my.healthScore });
    const partnerBlock = buildPartnerModeBlock(partner);
    const v = ctx.verdict || {};

    return `Give a second opinion on this dynasty trade in **${ctx.leagueName || 'my league'}**. My deterministic trade calculator already graded it — your job is an independent verdict that weighs context the math can't see (mode fit, market psychology, league format leverage). If you disagree with the calculator, SAY SO explicitly and explain why.
${fmtBlock}${myModeBlock}${partnerBlock}
**I SEND (leaves my roster):**
${formatDealSide(ctx.iSend)}

**I RECEIVE (joins my roster):**
${formatDealSide(ctx.iReceive)}

**MY TEAM:** ${my.record || '?'} | ${my.tier || '?'} | Health: ${my.healthScore ?? '?'}/100
My Needs: ${(my.needs || []).join(', ') || 'none identified'} | My Strengths: ${(my.strengths || []).join(', ') || 'none identified'}
**PARTNER (${partner.owner || 'other owner'}):** ${partner.record || '?'} | ${partner.tier || '?'} | DNA: ${partner.dna || 'Unknown'} | Posture: ${partner.posture || 'N/A'}
Their Needs: ${(partner.needs || []).join(', ') || 'none identified'}

**CALCULATOR VERDICT:** ${v.verdictText || 'n/a'} | Value diff: ${v.diffDisplay ?? 'n/a'} | Acceptance likelihood: ${v.likelihood ?? 'n/a'}${v.psychNotes ? ` | Behavioral notes: ${v.psychNotes}` : ''}

VERDICT RULES (strictly enforce):
1. Judge the deal through MY team mode first — a "fair value" trade that fights my rebuild/contend direction is a BAD trade for me.
2. Apply league format premiums (superflex QB 1.8x, TEP TE 1.5x) to both sides before comparing.
3. Factor the partner's mode: if this deal gives them exactly what their mode craves, I should extract more.
4. Be honest about the calculator: agree, or disagree with a concrete reason. Never hedge with "it depends" as the final answer.

Respond in under 500 words with exactly these sections:
**VERDICT** — ACCEPT, REJECT, or COUNTER (one of the three, first word)
**WHY** — 2-4 sentences, the decisive factors
**MODE FIT** — How this deal serves or fights my competitive mode and the league format
**WHAT I'D COUNTER WITH** — Only if COUNTER/REJECT: the specific adjusted package and why the partner's mode/DNA says yes`;
}

// ── Team diagnosis (League Detail strategic assessment) ──────────────────────

function buildTeamDiagnosisPrompt(ctx: any): string {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);

    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name}${p.age ? ` | Age ${p.age}` : ''}${p.value != null ? ` | Value ${p.value}` : p.dhq != null ? ` | DHQ ${p.dhq}` : ''}${p.isStarter ? ' [STARTER]' : ''}`
    ).join('\n');

    let sfQBNote = '';
    if (fmt.isSuperFlex) {
        const startableQBs = (ctx.myRoster || []).filter((p: any) => p.pos === 'QB' && (Number(p.value ?? p.dhq) || 0) >= 2000).length;
        if (startableQBs < fmt.numQBSlots) {
            sfQBNote = `\n⚠️ SUPERFLEX QB CRISIS: only ${startableQBs} startable QB(s) for ${fmt.numQBSlots} QB-eligible slots. QB acquisition MUST be the #1 prescription regardless of other needs.\n`;
        }
    }

    return `Diagnose **${ctx.myOwner || 'my'}** team in **${ctx.leagueName || 'this league'}**. Be direct and specific — this is a strategic check-up, not a pep talk.
${fmtBlock}${modeBlock}${sfQBNote}
**TEAM STATUS:** ${ctx.record || '?'} | ${ctx.teamTier || ctx.tier || '?'} tier | Health: ${ctx.healthScore ?? '?'}/100 | Window: ${ctx.teamWindow || ctx.tradeWindow || '?'}
**STATED NEEDS:** ${(ctx.needs || []).join(', ') || 'none identified'}
**STATED STRENGTHS:** ${(ctx.strengths || []).join(', ') || 'none identified'}
**GM STRATEGY NOTES:** ${ctx.gmStrategy || ctx.mentality || 'none provided'}

**ROSTER:**
${rosterStr || 'No roster data'}

Respond in under 350 words with exactly these sections:
**DIAGNOSIS** — 2-3 sentences: what this team actually is right now
**ROOT CAUSES** — The structural reasons (age curve, positional gaps, pick capital), not symptoms
**PRESCRIPTION** — Exactly 3 concrete moves, each aligned with the team mode above. No generic "add depth" advice.
**MODE CHECK** — One sentence: is the owner's current strategy consistent with what the roster says, or should they change course?`;
}

// ── Dashboard digest (cross-league top insights, strict JSON) ────────────────

function buildDashboardDigestPrompt(ctx: any): string {
    const leagues = (ctx.leagues || []).slice(0, 12).map((l: any) => {
        const flags = [
            l.formatFlags?.isSuperFlex ? 'SF' : '',
            l.formatFlags?.isTEP ? 'TEP' : '',
            l.formatFlags?.isIDP ? 'IDP' : '',
            l.formatFlags?.scoringType || '',
        ].filter(Boolean).join('/') || 'standard';
        return `• ${l.leagueName} [id:${l.leagueId}] | ${l.record || '?'} | ${l.tier || '?'} | Health ${l.healthScore ?? '?'}/100 | Format: ${flags}${l.topNeeds?.length ? ` | Needs: ${l.topNeeds.join(', ')}` : ''}${l.faabRemaining != null ? ` | FAAB $${l.faabRemaining}` : ''}${l.zeroPickYears?.length ? ` | ⚠️ ZERO picks: ${l.zeroPickYears.join(', ')}` : ''}`;
    }).join('\n');

    return `You are scanning all of one owner's dynasty leagues to surface the 3 most decision-relevant insights across their entire portfolio. Pick the items where acting this week matters most — critical deficits, mode misalignment, zero-pick crises, format leverage they're not using.

**MY LEAGUES:**
${leagues || 'No league data'}

RULES:
- At most 3 insights TOTAL across all leagues — only the ones that matter most. Fewer is fine.
- Each insight must be specific to one league and actionable this week. No generic advice ("monitor the waiver wire") and no praise-only items.
- severity must be one of: "warning" (act now or lose value), "opportunity" (exploitable edge), "pattern" (cross-league habit worth knowing).
- In superflex leagues, QB deficits outrank everything. Zero-pick years are always a warning.

Output ONLY a valid JSON array, no markdown, no backticks, no prose:
[{"leagueId":"...","severity":"warning","title":"max 8 words","body":"2-3 sentences, specific and actionable"}]`;
}

// ── GM insight (Alex Insights novel patterns, strict JSON) ───────────────────

function buildInsightPrompt(ctx: any): string {
    const kpis = ctx.kpis || {};
    const holds = (ctx.topHolds || []).slice(0, 10).map((p: any) =>
        `  ${p.pos || '?'} ${p.name}${p.age ? ` | Age ${p.age}` : ''}${p.value != null ? ` | Value ${p.value}` : ''}`
    ).join('\n');
    const trades = (ctx.recentTrades || []).slice(0, 8).map((t: any) =>
        `  ${t.summary || JSON.stringify(t)}`
    ).join('\n');
    const known = (ctx.heuristicTitles || []).map((t: string) => `  • ${t}`).join('\n');

    return `Analyze this dynasty GM's decision history in **${ctx.leagueName || 'their league'}** and surface exactly 2 NOVEL behavioral insights — patterns a deterministic stats engine would miss (timing tendencies, market behavior, psychological habits, format blind spots).
${ctx.gmStrategy ? `\n**GM STRATEGY (the owner's committed plan — frame insights against it):**\n${ctx.gmStrategy}\n` : ''}
**GM PERFORMANCE KPIs:** ${Object.entries(kpis).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'none'}
**TOP ROSTER HOLDS:**
${holds || '  none'}
**RECENT TRADES:**
${trades || '  none'}

**ALREADY-KNOWN INSIGHTS (do NOT repeat or rephrase any of these):**
${known || '  none'}

RULES:
- Exactly 2 insights. Each must be genuinely distinct from the already-known list above.
- Ground every claim in the data provided — never invent trades or players.
- severity must be one of: "warning", "edge", "pattern", "opportunity".
- confidence is an integer 50-95 reflecting how strongly the data supports the claim.

Output ONLY a valid JSON array, no markdown, no backticks, no prose:
[{"severity":"pattern","confidence":75,"title":"max 8 words","body":"2-3 sentences citing the specific data behind the pattern"}]`;
}

// Dynasty Read — web-search-backed news synthesis for a single player. Context is
// intentionally minimal and stable (pid/name/team/pos/age/season/week) so the
// shared weekly cache key is identical for every user viewing this player. The
// read is league-agnostic on purpose: the DHQ value, position rank and roster
// call live elsewhere on the card; this panel is the "what's actually happening
// with him" layer that a stats engine can't produce.
// Pull the read out of the <read></read> tags the model is told to wrap it in,
// discarding any web-search narration/preamble around it. Falls back to stripping
// a leading meta paragraph or pre-separator scratchpad if the tags are missing.
function extractTaggedRead(text: string): string {
    const raw = String(text || '').trim();
    const m = raw.match(/<read>([\s\S]*?)<\/read>/i);
    if (m && m[1].trim()) return m[1].trim();
    let t = raw.replace(/<\/?read>/gi, '').trim();
    const sep = t.split(/\n\s*-{3,}\s*\n/);
    if (sep.length > 1) t = sep[sep.length - 1].trim();
    const paras = t.split(/\n\s*\n/);
    if (paras.length > 1 && /^(i have |i'?ve |let me |here(?:'s| is| are)|okay|alright|sure|based on|after (?:my |the )?search)/i.test(paras[0].trim())) {
        t = paras.slice(1).join('\n\n').trim();
    }
    return t.trim();
}

// League-format clause for the Dynasty Read. Honors format flags ONLY when the
// caller passes them; otherwise the read stays league-agnostic so the shared
// weekly cache key remains identical across users.
function dynastyReadFormatClause(ctx: any): string {
    if (!ctx) return '';
    const sf      = ctx.superflex === true || ctx.isSuperFlex === true;
    const tep     = ctx.tep === true || ctx.tePremium === true || ctx.isTEP === true;
    const idp     = ctx.idp === true || ctx.isIDP === true;
    const scoring = ctx.scoringType || ctx.scoring || '';

    const bits: string[] = [];
    if (scoring === 'ppr') bits.push('full PPR');
    else if (scoring === 'half_ppr' || scoring === 'half') bits.push('half PPR');
    else if (scoring === 'std' || scoring === 'standard') bits.push('standard / non-PPR');
    if (sf)  bits.push('superflex (2 QB-eligible slots)');
    if (tep) bits.push('TE-premium');
    if (idp) bits.push('IDP');

    if (!bits.length) {
        return `\nThis is a league-agnostic dynasty read: focus on the role, usage, health and trajectory signals that move a player's value in any format.\n`;
    }
    return `\nThe GM's league is ${bits.join(', ')}. Read this player THROUGH that lens — the same news means different things by format: QB value swings hardest in superflex; high-target receivers and pass-catching backs gain in PPR; every-down and receiving tight ends gain in TE-premium; defenders carry real, tradeable value in IDP. Weight the outlook to what this format rewards.\n`;
}

// System prompt for the Dynasty Read. Deliberately NOT buildSystemPrompt(): that
// one is the full league-analyst persona (bold headers, 1200 words, cite owners /
// records) and fights this surface's tight single-player brief.
function buildDynastyReadSystemPrompt(ctx: any): string {
    const fmt = dynastyReadFormatClause(ctx);
    return `You are a sharp NFL analyst writing the dynasty read on ONE player for the GM who ALREADY ROSTERS him. Your job: translate what is ACTUALLY happening with this player in the real world right now into what it means for his dynasty value. You have web search — use it, and build the read entirely on what you find.

Weave three things into plain prose, in this order (do not label them):
1. SITUATION — the most important real, current development from recent reporting: depth-chart role and snap/target/touch trend, health and its timeline, contract or roster status, a coaching/scheme change, or a teammate's move that opens or closes a path. Anchor it to something concrete and recent — not a career résumé.
2. IMPACT — what that situation does to his usage and value right now.
3. LONG-TERM OUTLOOK — the dynasty trajectory over the next 1-3 seasons: arrow up, flat, or down, and the specific reason driving it.
${fmt}
HARD RULES:
- Ground the read in real, recent developments you actually found. Do NOT fall back on a generic age/role platitude that could be said about any player at his position — that is the exact failure mode to avoid.
- If genuinely nothing is breaking, the honest read is STILL concrete: his current depth-chart role, scheme fit, and the most recent move around him, and what those imply. Never write vague "trajectory" filler.
- LOW-PROFILE PLAYERS (deep bench, practice squad, just-drafted, UDFA, little coverage): never go blank or generic. Give his actual depth-chart spot and who is ahead of him, his draft pedigree and realistic path to snaps, and a blunt dynasty verdict — deep stash, taxi-only, or waiver-level — plus the single change (an injury ahead of him, a scheme fit, a standout camp/preseason report) that would put him on the radar.
- The GM ALREADY OWNS him — write the forward outlook and a hold-or-move read, NOT whether to acquire him or what to pay. Never say "don't pay up" or give buy-price advice.
- Wrap the final read — and nothing else — in <read></read> tags. Only the text inside those tags is shown to the GM, so put no preamble, fact list, separators, labels, or meta-commentary inside them (you may reason before the opening tag if you must). Example: <read>His role firmed up when…</read>
- Confident and direct, like an analyst who has done the homework. Cut "could / may / might" hedging.
- 3-5 sentences of PLAIN PROSE that run together as one short paragraph. Absolutely NO markdown, NO "#"/"##" headings, NO section titles ("Quick Take", "Situation", "Verdict", etc.), NO bullets, NO tables, NO labels, NO sign-off — just the sentences.`;
}

function buildDynastyReadPrompt(ctx: any): string {
    const name = ctx?.name || 'this player';
    const pos = ctx?.pos || '';
    const team = ctx?.team || 'FA';
    const age = ctx?.age ? `, age ${ctx.age}` : '';
    const wk = (ctx?.week === 0 || ctx?.week === '0' || ctx?.week == null) ? 'the offseason' : `week ${ctx.week}`;
    const season = ctx?.season || '';
    return `Use web search to pull the LATEST reporting on ${name} (${pos}, ${team}${age}) as of ${wk} ${season} — prioritize the last ~10 days plus this offseason's moves. Sources: ESPN, PFF, The Athletic, and trusted team beat reporters.

Build the read on what you actually find about his real situation:
- Depth-chart role and recent usage trend (snaps, targets, touches, routes).
- Injury status / designation and the expected timeline.
- Coaching, scheme, or personnel changes around him (new OC, an added competitor, a teammate's injury opening a path).
- Contract / roster status and any trade buzz.
Then say what it means: the impact on his value now, and the dynasty outlook over the next 1-3 seasons.

Lead with the single most decision-relevant real development. Do NOT restate fantasy points, DHQ value, or position rank — the card already shows those. Do NOT pad with generic age-curve commentary; if news is thin, give the most recent concrete situational fact and what it implies.`;
}

// ── Live NFL news (ESPN RSS, best-effort) ─────────────────────────────────────

async function fetchLiveNFLNews(): Promise<string> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch('https://www.espn.com/espn/rss/nfl/news', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!r.ok) return '';
        const xml = await r.text();
        const items: string[] = [];
        // Match CDATA and plain <title> tags inside <item> blocks
        const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null && items.length < 12) {
            const t = m[1].replace(/<[^>]+>/g, '').trim();
            if (t && t.length > 10) items.push(`• ${t}`);
        }
        return items.join('\n');
    } catch {
        return '';
    }
}

// ── General chat prompt ───────────────────────────────────────────────────────

function buildChatPrompt(ctx: any, liveNews: string): string {
    const teamsStr = (ctx.teams || []).map((t: any) => {
        const players = (t.players || []).slice(0, 12).join(', ');
        return `  ${t.owner} (${t.record || '?'}) | ${t.tier || '?'} | Health:${t.healthScore ?? '?'} | Needs:${(t.needs||[]).join(',')||'—'} | Strengths:${(t.strengths||[]).join(',')||'—'}${players ? `\n    Roster: ${players}` : ''}`;
    }).join('\n');

    const newsSection = liveNews
        ? `\n**LIVE NFL NEWS (fetched now from ESPN):**\n${liveNews}\n`
        : '';

    return `You are answering a dynasty fantasy football question for **${ctx.myOwner || 'an owner'}** in **${ctx.leagueName}** (${ctx.season} season).

**ALL TEAMS IN THE LEAGUE:**
${teamsStr || 'No team data available'}
${newsSection}
**QUESTION:** ${ctx.question}

Answer thoroughly and specifically. Reference real players, owners, and league data where relevant.
- If asking about a specific player: comment on their dynasty value, role, age, and injury status if known from the news above.
- If asking about trades: factor in both teams' needs, tier, and roster composition from the data above.
- If asking about targeting a player: identify which team owns them and suggest a realistic offer.
- If asking about NFL news/injuries: use the live news headlines above.
- If asking general strategy: tailor advice to the owner's league context.
Keep the response focused and actionable. Use **bold headers** to organize if the answer is multi-part.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    const responseHeaders = corsHeaders(req);

    try {
        const aiSession = await resolveAISession(req);
        if (!aiSession) {
            return new Response(
                JSON.stringify({ error: 'Valid session token required.' }),
                { status: 401, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        if (!isAIEnabled()) {
            return new Response(
                JSON.stringify({ error: 'AI is temporarily disabled by launch controls.' }),
                { status: 503, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        if (req.method !== 'POST') return new Response(null, { status: 405, headers: responseHeaders });
        const rawBody = await req.text();
        if (rawBody.length > 200000) return new Response(JSON.stringify({ error: 'AI request is too large.' }), { status: 413, headers: responseHeaders });
        let body;
        try { body = JSON.parse(rawBody); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers: responseHeaders }); }
        const personalProvider = req.headers.get('x-ai-provider');
        const personalKey = req.headers.get('x-ai-key');
        const personalModel = req.headers.get('x-ai-model');
        const personal = personalProvider !== null || personalKey !== null || personalModel !== null;
        if (personal && (!['gemini', 'openai', 'anthropic'].includes(personalProvider || '') || !personalKey || personalKey.length < 10 || personalKey.length > 1024 || /[\s\x00-\x1f]/.test(personalKey) || (personalModel && !/^[a-zA-Z0-9._-]{1,100}$/.test(personalModel)))) {
            return new Response(JSON.stringify({ error: 'Choose a supported AI provider and enter its API key in AI settings.' }), { status: 400, headers: responseHeaders });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: responseHeaders });
        const { type } = body;
        const context = parseContextPayload(body.context);

        if (typeof type !== 'string' || !type || type.length > 100 || body.context == null) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: type, context' }),
                { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ── Rate limit check ──────────────────────────────────────────────
        const rateCheck  = await checkRateLimit(aiSession.identifier);
        if (!rateCheck.allowed) {
            const retryAfterSec = Math.ceil((rateCheck.retryAfterMs ?? RATE_LIMIT_WINDOW) / 1000);
            return new Response(
                JSON.stringify({ error: `Rate limit exceeded. Try again in ${retryAfterSec}s.` }),
                {
                    status: 429,
                    headers: {
                        ...responseHeaders,
                        'Content-Type': 'application/json',
                        'Retry-After': String(retryAfterSec),
                    },
                }
            );
        }

        const genericContext = normalizeGenericAIContext(type, context);
        let maxTokensOverride: number | null = null;
        let useWebSearch = false;

        // Fetch live NFL news for War Room chat mode (best-effort, non-blocking on failure)
        const liveNews = type === 'chat' && !genericContext ? await fetchLiveNFLNews() : '';

        let userPrompt: string;
        switch (type) {
            case 'league':     userPrompt = buildLeaguePrompt(context);           break;
            case 'team':       userPrompt = buildTeamPrompt(context);             break;
            case 'partners':   userPrompt = buildPartnersPrompt(context);         break;
            case 'fa_targets': userPrompt = buildFATargetsPrompt(context);        break;
            case 'rookies':    userPrompt = buildRookiesPrompt(context);          break;
            case 'fa_chat':    userPrompt = buildFAChatPrompt(context);           break;
            case 'mock_draft': userPrompt = buildMockDraftPrompt(context);        break;
            case 'chat':       userPrompt = genericContext ? genericContext.userPrompt : buildChatPrompt(context, liveNews);   break;
            case 'trade_verdict':    userPrompt = buildTradeVerdictPrompt(context);    break;
            case 'team_diagnosis':   userPrompt = buildTeamDiagnosisPrompt(context);   break;
            case 'dashboard_digest': userPrompt = buildDashboardDigestPrompt(context); break;
            case 'insight':          userPrompt = buildInsightPrompt(context);         break;
            case 'dynasty_read':     userPrompt = buildDynastyReadPrompt(parseContextPayload(context)); break;
            default:
                if (genericContext) {
                    userPrompt = genericContext.userPrompt;
                    maxTokensOverride = genericContext.maxTokens;
                    useWebSearch = genericContext.useWebSearch;
                } else {
                    return new Response(
                        JSON.stringify({ error: `Unknown analysis type: ${type}` }),
                        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
                    );
                }
        }

        if (genericContext && STRUCTURED_TYPES.has(type)) {
            maxTokensOverride = genericContext.maxTokens;
            useWebSearch = genericContext.useWebSearch;
        }

        // Fresh reporting is part of Dynasty Read for every user.
        if (type === 'dynasty_read') useWebSearch = true;

        // No paid plan gates or owner-funded provider fallbacks. Personal credentials
        // exist only in this request and are never stored in cache or accounting.
        const provider: AIProvider = personal ? personalProvider as AIProvider : 'gemini';
        const defaults = { gemini: AI_MODELS.GEMINI_BALANCED, openai: AI_MODELS.OPENAI_STANDARD, anthropic: AI_MODELS.CLAUDE_REASONING };
        const route: AIRoute = { provider, model: personalModel || defaults[provider], tier: 'standard' };
        const apiKey = personal ? personalKey! : await getSharedGeminiKey();
        const respond = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...responseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        if (!apiKey) return respond({ error: 'Shared Gemini is not configured yet. Add your own key in AI settings.' }, 503);
        const parsedContext = parseContextPayload(context);
        const contextLeagueId = parsedContext?.leagueId || parsedContext?.currentLeagueId || null;
        const userPrefs = (!genericContext && STRUCTURED_TYPES.has(type) && type !== 'mock_draft' && type !== 'dynasty_read')
            ? await fetchPreferenceSummary(aiSession, contextLeagueId) : null;
        const cacheTtlMs = !personal && !genericContext ? (CACHEABLE_TYPES[type] || 0) : 0;
        const cacheKey = cacheTtlMs ? 'free-gemini-v1:' + aiSession.identifier + ':' + await computeCacheKey(type, context, aiSession, prefsVersionFor(userPrefs)) : null;
        const usage = { source: personal ? 'personal-key' : 'shared-gemini', plan: 'free', provider, model: route.model };
        const resultBody = (analysis: string, grounding?: any) => ({ analysis, ...(grounding ? { grounding } : {}),
            ...(type === 'mock_draft' ? { picks: parseJsonArray(analysis) } : {}),
            ...(JSON_ARRAY_TYPES.has(type) ? { insights: parseJsonArray(analysis) } : {}), provider, model: route.model, usage });
        if (cacheKey && parsedContext?.forceRefresh !== true) {
            const cached = await readAIResponseCache(cacheKey);
            if (cached) return respond({ ...resultBody(cached.analysis, cached.usage?.grounding), cached: true });
        }
        if (!personal) {
            const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            // Atomic limits are shared across workers; provider free-tier quotas may be lower.
            for (const [scope, identifier, limit, seconds] of [
                ['ai-shared:user-day', aiSession.identifier, envNumber('AI_SHARED_USER_DAILY_LIMIT', 30), 86400],
                ['ai-shared:project-minute', 'gemini', envNumber('AI_SHARED_RPM', 5), 60],
                ['ai-shared:project-day', 'gemini', envNumber('AI_SHARED_DAILY_LIMIT', 100), 86400],
            ] as [string, string, number, number][]) {
                const quota = await checkSecurityRateLimit(db, scope, identifier, { limit: Math.max(1, Math.floor(limit)), windowSeconds: seconds });
                if (!quota.allowed) return respond({ error: 'Shared Gemini capacity is used up. Try later or add your own key in AI settings.', retryAfterSeconds: quota.retryAfterSeconds }, 429);
            }
        }
        const maxTokens = Math.max(100, Math.min(maxTokensOverride || (type === 'mock_draft' ? 16000 : 8192), type === 'mock_draft' ? 16000 : 8192));
        const systemPrompt = genericContext?.system || (type === 'mock_draft'
            ? 'You are a dynasty fantasy football draft simulator. Output ONLY a raw JSON array. Never repeat a player. Start with [ and end with ].'
            : type === 'dynasty_read' ? buildDynastyReadSystemPrompt(parsedContext)
            : buildSystemPrompt(context) + buildUserPreferenceBlock(userPrefs));
        let result;
        try {
            result = await callAIProvider({ route, apiKey, systemPrompt: systemPrompt.slice(0, 30000), userPrompt: userPrompt.slice(0, 100000), maxTokens, useWebSearch });
        } catch {
            // Do not expose provider errors: some SDK errors contain request headers.
            return respond({ error: personal
                ? 'Your AI provider could not complete this request. Check your key, model, and provider quota in AI settings.'
                : 'Shared Gemini is unavailable or at capacity. Try later or add your own key in AI settings.' }, 503);
        }
        const analysis = type === 'dynasty_read' ? extractTaggedRead(result.analysis) : result.analysis;
        if (!analysis) return respond({ error: 'AI returned no answer. Please try again.' }, 502);
        if (type === 'mock_draft' && result.stopReason === 'max_tokens') return respond({ error: 'Draft simulation was too long. Try fewer rounds or owners.' }, 422);
        if (cacheKey && result.stopReason !== 'max_tokens') await writeAIResponseCache({ cacheKey, type, aiSession, leagueId: contextLeagueId, model: route.model, analysis, usage: { ...usage, grounding: result.grounding }, ttlMs: cacheTtlMs });
        return respond(resultBody(analysis, result.grounding));
    } catch {
        return new Response(JSON.stringify({ error: 'Unable to complete this AI request.' }), { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } });
    }
});
