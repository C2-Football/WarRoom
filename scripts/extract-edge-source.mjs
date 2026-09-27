// Read-only recovery of original game source when Supabase's multipart
// unbundler fails on a large ESZIP. No module from the bundle is executed.
export async function originalFiles(specifiers, sourceOf, mapOf, game) {
    if (!['time-league', 'duat'].includes(game)) throw Error('Unsupported game');
    const entrypoints = specifiers.filter(value => value.endsWith(`functions/${game}/index.ts`));
    if (entrypoints.length !== 1) throw Error('Missing or ambiguous game entrypoint');
    const prefix = entrypoints[0].slice(0, -`functions/${game}/index.ts`.length);
    const files = new Map();
    for (const specifier of specifiers) {
        if (!specifier.startsWith(prefix + 'functions/')) continue;
        const relative = specifier.slice(prefix.length);
        if (!/^functions\/[A-Za-z0-9_./-]+\.(?:ts|js|mjs)$/.test(relative) || relative.split('/').some(part => part === '..' || part === '.' || !part)) throw Error('Unsafe source path');
        if (!relative.startsWith(`functions/${game}/`) && !relative.startsWith('functions/_shared/')) throw Error('Unexpected game source scope');
        const target = 'supabase/' + relative;
        if (files.has(target)) throw Error('Duplicate source path');
        let source = await sourceOf(specifier);
        const mapText = await mapOf(specifier);
        if (mapText) {
            const map = JSON.parse(mapText);
            if (map.version !== 3 || map.sources?.length !== 1 || map.sources[0] !== specifier || map.sourcesContent?.length !== 1 || typeof map.sourcesContent[0] !== 'string') throw Error('Original source map is incomplete');
            source = map.sourcesContent[0];
        } else if (relative.endsWith('.ts')) throw Error('Original TypeScript source map is missing');
        if (typeof source !== 'string' || !source.trim()) throw Error('Empty original source');
        files.set(target, source);
    }
    if (!files.has(`supabase/functions/${game}/index.ts`)) throw Error('Missing recovered entrypoint');
    return files;
}

if (import.meta.main) {
    const [bundlePath, targetDirectory, game] = Deno.args;
    const { Parser } = await import('npm:@deno/eszip@0.106.0');
    const parser = await Parser.createInstance();
    const specifiers = await parser.parseBytes(await Deno.readFile(bundlePath));
    await parser.load();
    const files = await originalFiles(specifiers, value => parser.getModuleSource(value), value => parser.getModuleSourceMap(value), game);
    for (const [relative, source] of files) {
        const target = targetDirectory + '/' + relative;
        await Deno.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
        await Deno.writeTextFile(target, source);
    }
    console.log(`Recovered ${files.size} original ${game} source files.`);
}
