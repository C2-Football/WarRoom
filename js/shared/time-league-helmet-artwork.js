// Complete, attributed source artwork. Team colors only replace paint values
// on existing source elements; geometry, hardware and draw order stay intact.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const cache = new Map();
    const CACHE_LIMIT = 128;
    const ASSET_IDS = ['cyberscooty', 'simanek'];
    const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
    const assetIdFor = (spec) => ASSET_IDS.includes(spec?.assetId) ? spec.assetId : 'cyberscooty';
    const shade = (color, ratio) => '#' + color.slice(1).match(/../g).map((part) => Math.round(parseInt(part, 16) * ratio).toString(16).padStart(2, '0')).join('').toUpperCase();

    function colorsFor(spec) {
        const shell = App.TimeLeagueHelmet?.shellColorFor?.(spec) || spec?.shellColor;
        return {
            shell: hex(shell, '#172A49'),
            stripe: hex(spec?.stripeColor, '#F4F1E8'),
            facemask: hex(spec?.facemaskColor, '#C2C5C9'),
        };
    }

    function recolorMap(assetId, colors) {
        if (assetId === 'simanek') {
            return {
                stop3840: ['stop-color', colors.shell],
                stop3842: ['stop-color', shade(colors.shell, 203 / 255)],
                path3790: ['fill', colors.stripe],
                path3780: ['fill', colors.facemask],
                path3782: ['fill', shade(colors.facemask, 191 / 249)],
                stop3846: ['stop-color', shade(colors.facemask, 168 / 249)],
                stop3848: ['stop-color', shade(colors.facemask, 172 / 249)],
                stop3854: ['stop-color', shade(colors.facemask, 194 / 249)],
                stop3856: ['stop-color', shade(colors.facemask, 224 / 249)],
            };
        }
        return {
            path2996: ['fill', colors.shell],
            path3893: ['fill', colors.stripe],
            path3043: ['fill', shade(colors.facemask, 205 / 212)],
            path3051: ['fill', shade(colors.facemask, 208 / 212)],
            stop3920: ['stop-color', shade(colors.facemask, 202 / 212)],
            stop3922: ['stop-color', colors.facemask],
        };
    }

    function paintSource(source, assetId, colors) {
        const replacements = recolorMap(assetId, colors);
        // Read the fixed local source, never user markup. Match opening tags
        // without serializing the XML: source whitespace and attributes remain.
        return source.replace(/<(?:path|stop)\b[^>]*>/g, (tag) => {
            const id = tag.match(/\bid="([^"]+)"/)?.[1];
            const replacement = replacements[id];
            if (!replacement) return tag;
            const [property, color] = replacement;
            const propertyPattern = new RegExp('(^|;)(' + property + ':)#[0-9a-f]{6}(?=;|$)', 'i');
            return tag.replace(/\bstyle="([^"]*)"/, (attribute, style) => {
                return 'style="' + style.replace(propertyPattern, (match, delimiter, prefix) => delimiter + prefix + color) + '"';
            });
        });
    }

    function rendered(spec) {
        const assetId = assetIdFor(spec);
        const source = App.TimeLeagueHelmetSources?.[assetId];
        if (typeof source !== 'string') return { svg: '', image: 'images/time-league/helmets/' + assetId + '.svg' };
        if (spec?.artworkMode !== 'team-colors') return { svg: source, image: 'images/time-league/helmets/' + assetId + '.svg' };
        const colors = colorsFor(spec);
        const key = [assetId, colors.shell, colors.stripe, colors.facemask].join('|');
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            cache.set(key, cached);
            return cached;
        }
        const svg = paintSource(source, assetId, colors);
        const result = { svg, image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
        cache.set(key, result);
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        return result;
    }

    const api = {
        svgFor: (spec) => rendered(spec).svg,
        imageFor: (spec) => rendered(spec).image,
    };
    App.TimeLeagueHelmetArtwork = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
