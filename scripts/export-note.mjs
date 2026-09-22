// Exporta una nota real del vault a .docx SIN Obsidian — mismo cableado que el plugin:
// preprocessObsidian(source, vault) -> MarkdownToDocxConverter.convert(...).
// Uso: node scripts/export-note.mjs "<vault>/<Mi Nota>.md"   (escribe <Mi Nota>.docx al lado)
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const noteAbs = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!noteAbs) {
	console.error('Uso: node scripts/export-note.mjs "<vault>/<Mi Nota>.md"');
	process.exit(1);
}
const vaultDir = path.dirname(noteAbs);
const noteName = path.basename(noteAbs, '.md');

// Bundle src/ igual que el test (node no entiende TS; 'obsidian' -> stub)
await build({
	entryPoints: [path.join(root, 'src', 'test-entry.ts')],
	bundle: true, platform: 'node', format: 'esm', target: 'node20',
	outfile: path.join(root, 'test', '.build', 'entry.mjs'),
	alias: { obsidian: path.join(root, 'test', 'obsidian-stub.mjs') },
	logLevel: 'silent',
});
const { preprocessObsidian, MarkdownToDocxConverter } = await import('../test/.build/entry.mjs');

// Índice del vault (md + recursos embebibles), rel -> abs
const files = new Map(); // 'nombre.md' / rel con '/' -> abs
async function walk(dir) {
	for (const e of await fs.readdir(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.')) continue;
		const abs = path.join(dir, e.name);
		if (e.isDirectory()) await walk(abs);
		else files.set(path.relative(vaultDir, abs).split(path.sep).join('/'), abs);
	}
}
await walk(vaultDir);

function resolveLink(linkpath) {
	const clean = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`;
	if (files.has(clean)) return clean;
	// basename (Obsidian resuelve por nombre aunque esté en subcarpeta)
	const want = path.basename(clean).toLowerCase();
	for (const rel of files.keys()) if (path.basename(rel).toLowerCase() === want) return rel;
	return null;
}

const vault = {
	vaultName: path.basename(vaultDir),
	resolve: (linkpath) => {
		const rel = resolveLink(linkpath);
		return rel ? { path: rel, isMd: rel.endsWith('.md') } : null;
	},
	read: (rel) => fs.readFile(files.get(rel), 'utf8'),
};
const resourceLoader = async (link) => {
	const rel = resolveLink(link);
	if (!rel) return null;
	const buf = await fs.readFile(files.get(rel));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); // ArrayBuffer limpio (pool de Node)
};

// SETTINGS idénticos a src/main.ts (MVP sin settings UI)
const SETTINGS = {
	defaultFontFamily: 'Calibri', defaultFontSize: 11, includeMetadata: false,
	preserveFormatting: true, useObsidianAppearance: false, includeFilenameAsHeader: false,
	pageSize: 'A4', chunkingThreshold: 100000, enablePreprocessing: false,
};

const source = await fs.readFile(noteAbs, 'utf8');
const markdown = await preprocessObsidian(source, vault, path.basename(noteAbs));
const converter = new MarkdownToDocxConverter(SETTINGS);
const blob = await converter.convert(markdown, noteName, null, resourceLoader);
const out = path.join(vaultDir, `${noteName}.docx`);
await fs.writeFile(out, Buffer.from(await blob.arrayBuffer()));

// smoke: el docx es un zip OOXML con su documento
const xml = unzipSync(new Uint8Array(await fs.readFile(out)))['word/document.xml'];
if (!xml || xml.length < 100) throw new Error('docx inválido: word/document.xml ausente');
console.log(`OK -> ${out} (${xml.length} bytes de document.xml)`);
