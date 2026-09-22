// TDD (spec f2, punto "Verificación"):
// fixture md con TODA la sintaxis Obsidian -> preprocesador + converter -> descomprimir
// el .docx y assertar sobre word/document.xml (+ document.xml.rels para los Target de hiperenlaces OOXML).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

// Bundle src/ -> test/.build/entry.mjs (node no entiende TS; 'obsidian' se aliasa a un stub)
await build({
	entryPoints: [path.join(root, 'src', 'test-entry.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	outfile: path.join(here, '.build', 'entry.mjs'),
	alias: { obsidian: path.join(here, 'obsidian-stub.mjs') },
	logLevel: 'silent',
});
const { preprocessObsidian, MarkdownToDocxConverter } = await import('./.build/entry.mjs');

// --- vault falso -------------------------------------------------------------
const NOTES = {
	'Main.md': `# Título del documento

> [!warning] Cuidado con esto
> Esta línea va dentro del callout.
> Sigue dentro.

Ver [[Otra Nota|la nota hermana]] y también [[nota inexistente]].

Subsección con [[Otra Nota#Sección]].

![[Otra Nota]]

![[img.png|400]]

Esto es ==resaltado== y esto %%Texto oculto%% queda fuera.

Etiqueta al final #etiqueta

- elemento uno
- elemento dos

| Col A | Col B |
| --- | --- |
| 1 | 2 |

[enlace md estándar](https://example.com)
`,
	'Otra Nota.md': `EMBEDDED: contenido de la nota hermana

![[Nota Hija]]
`,
	'Nota Hija.md': `EMBEDDED-2: contenido de la nota hija
`,
};
const FILES = { 'img.png': true };

const vault = {
	vaultName: 'MiVault',
	resolve(linkpath, _fromPath) {
		if (FILES[linkpath]) return { path: linkpath, isMd: false };
		const asIs = linkpath.endsWith('.md') ? linkpath : null;
		const withMd = linkpath.endsWith('.md') ? null : `${linkpath}.md`;
		for (const cand of [asIs, withMd]) {
			if (cand && Object.prototype.hasOwnProperty.call(NOTES, cand)) {
				return { path: cand, isMd: true };
			}
		}
		return null;
	},
	async read(p) {
		if (!(p in NOTES)) throw new Error(`not found: ${p}`);
		return NOTES[p];
	},
};

// PNG 1x1 válido (para el embed de imagen con ancho)
const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);
const resourceLoader = async (link) => (link.endsWith('.png') ? PNG_1X1.buffer.slice(PNG_1X1.byteOffset, PNG_1X1.byteOffset + PNG_1X1.byteLength) : null);

const SETTINGS = {
	defaultFontFamily: 'Calibri',
	defaultFontSize: 11,
	includeMetadata: false,
	preserveFormatting: true,
	useObsidianAppearance: false,
	includeFilenameAsHeader: false,
	pageSize: 'A4',
	chunkingThreshold: 100000,
	enablePreprocessing: false,
};

// --- test --------------------------------------------------------------------
test('fixture con toda la sintaxis obsidian -> docx fiel', async () => {
	const md = await preprocessObsidian(NOTES['Main.md'], vault, 'Main.md');
	const converter = new MarkdownToDocxConverter(SETTINGS);
	const blob = await converter.convert(md, 'Main', null, resourceLoader);

	assert.equal(blob.type.includes('wordprocessingml'), true, 'blob es un docx');

	const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
	const doc = strFromU8(files['word/document.xml']);
	const rels = strFromU8(files['word/_rels/document.xml.rels']);
	const all = doc + rels;

	// Callout tipado -> badge (⚠️ AVISO), sin literal [!warning]
	assert.ok(doc.includes('⚠️ AVIS'), 'callout tipado renderiza badge ⚠️ AVIS...');
	assert.ok(!all.includes('[!warning]'), 'no sobra el literal [!warning]');

	// Wikilink con alias -> hyperlink obsidian:// en las relationships OOXML
	assert.ok(rels.includes('Target="obsidian://open?vault='), 'wikilink con alias -> Target obsidian://open?vault=...');
	// Wikilink inexistente -> solo texto, sin link
	assert.ok(!rels.includes('inexistente'), 'wikilink inexistente no genera hyperlink');

	// Sin sintaxis Obsidian cruda en la salida
	assert.ok(!all.includes('[['), 'no queda ningún [[');

	// Embeds de nota (con embed anidado, recursión)
	assert.ok(doc.includes('EMBEDDED:'), 'embed de nota inserta su contenido');
	assert.ok(doc.includes('EMBEDDED-2:'), 'embed anidado (nivel 2) inserta su contenido');

	// %%oculto%% eliminado
	assert.ok(!doc.includes('Texto oculto'), '%%Texto oculto%% eliminado');

	// ==resaltado== -> highlight amarillo
	assert.ok(doc.includes('<w:highlight w:val="yellow"/>'), 'resaltado con highlight amarillo');

	// tabla
	assert.ok(doc.includes('<w:tbl>'), 'tabla convertida a w:tbl');

	// etiqueta -> texto plano
	assert.ok(!doc.includes('#etiqueta'), '#etiqueta pierde el #');

	// imagen embedida con ancho
	assert.ok(
		Object.keys(files).some((k) => k.startsWith('word/media/')),
		'imagen del vault incrustada en el docx',
	);
});
