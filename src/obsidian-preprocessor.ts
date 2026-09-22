// Pre-procesador de sintaxis Obsidian, ejecutado ANTES del parseo md estándar.
// Cubre: callouts tipados, wikilinks, embeds de nota (recursivos), %%oculto%%, #etiqueta.
// Los embeds de imagen y ==resaltado== los resuelve el converter (fork de toword) tal cual.

export interface PreprocessVault {
	vaultName: string;
	/** Resuelve un linkpath (p. ej. "Otra Nota", "img.png") desde fromPath. Null si no existe. */
	resolve(linkpath: string, fromPath: string): { path: string; isMd: boolean } | null;
	/** Lee el contenido de texto de una nota. */
	read(path: string): Promise<string>;
}

const CALLOUT_BADGES: Record<string, string> = {
	note: 'ℹ️ NOTA',
	info: 'ℹ️ NOTA',
	warning: '⚠️ AVISO',
	caution: '⚠️ AVISO',
	danger: '⚠️ AVISO',
	bug: '⚠️ AVISO',
	tip: '💡 CONSEJO',
	success: '💡 CONSEJO',
	example: '💡 CONSEJO',
	quote: '❝ CITA',
};

// ponytail: profundidad de embed 2 (spec) + set GLOBAL de rutas ya embebidas como anti-ciclo;
// los wikilinks se resuelven contra sourcePath de la nota raíz (Obsidian resuelve por basename,
// techo: homónimos en subcarpetas dentro de embeds pueden degradarse a texto sin link).
const MAX_EMBED_DEPTH = 2;

export async function preprocessObsidian(
	markdown: string,
	vault: PreprocessVault,
	sourcePath: string,
): Promise<string> {
	const expanded = await expandEmbeds(markdown, vault, sourcePath, 0, new Set());
	return transformLines(expanded, vault, sourcePath);
}

/** Rangos [inicio, fin] de los tramos dentro de bloques de código cercados (no se transforman). */
function fencedRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let open = -1;
	const re = /^[ \t]*(?:```|~~~).*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (open === -1) {
			open = m.index;
		} else {
			ranges.push([open, m.index + m[0].length]);
			open = -1;
		}
	}
	if (open !== -1) ranges.push([open, text.length]);
	return ranges;
}

/**
 * Sustituye ![[Nota]] por el contenido markdown de esa nota (recursivo, máx. MAX_EMBED_DEPTH
 * niveles, con guarda anti-ciclo). ![[img.png]] (no-md) se deja intacto: lo convierte el converter.
 */
async function expandEmbeds(
	text: string,
	vault: PreprocessVault,
	fromPath: string,
	depth: number,
	seen: Set<string>,
): Promise<string> {
	const ranges = fencedRanges(text);
	const re = /!\[\[([^\]]+?)\]\]/g;
	let out = '';
	let last = 0;
	for (const m of text.matchAll(re)) {
		const start = m.index;
		if (ranges.some(([a, b]) => start >= a && start < b)) continue;
		const raw = m[0];
		const target = m[1].split('|')[0].split('#')[0].trim();
		const resolved = vault.resolve(target, fromPath);
		out += text.slice(last, start);
		last = start + raw.length;

		if (!resolved) {
			out += target; // embed inexistente -> solo texto
		} else if (!resolved.isMd) {
			out += raw; // embed de imagen/archivo: lo maneja el converter con resourceLoader
		} else if (seen.has(resolved.path) || depth >= MAX_EMBED_DEPTH) {
			out += target; // ciclo o profundidad máxima -> solo texto
		} else {
			seen.add(resolved.path);
			const inner = await expandEmbeds(
				await vault.read(resolved.path),
				vault,
				resolved.path,
				depth + 1,
				seen,
			);
			out += `\n${inner.trimEnd()}\n`;
		}
	}
	return out + text.slice(last);
}

/** Transformaciones por línea (fuera de bloques de código cercados). */
function transformLines(text: string, vault: PreprocessVault, sourcePath: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let inFence = false;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^[ \t]*(?:```|~~~)/.test(line)) {
			inFence = !inFence;
			out.push(line);
			i++;
			continue;
		}
		if (inFence) {
			out.push(line);
			i++;
			continue;
		}

		// Callout tipado: > [!tipo]+ Título + sus líneas ">" -> párrafo con badge + cuerpo plano
		const callout = line.match(/^\s*>\s*\[!([A-Za-z0-9_-]+)\][+\-^]?(?:\s+(.*))?$/);
		if (callout) {
			const type = callout[1].toLowerCase();
			const title = (callout[2] || '').trim();
			const badge = CALLOUT_BADGES[type] || `📌 ${type.toUpperCase()}`;
			out.push(title ? `**${badge}** ${title}` : `**${badge}**`);
			i++;
			while (i < lines.length && /^\s*>/.test(lines[i])) {
				out.push(inlineTransform(lines[i].replace(/^\s*>\s?/, ''), vault, sourcePath));
				i++;
			}
			continue;
		}

		out.push(inlineTransform(line, vault, sourcePath));
		i++;
	}
	return out.join('\n');
}

function inlineTransform(line: string, vault: PreprocessVault, sourcePath: string): string {
	let s = line;
	// Definición de footnote ([^1]: texto) -> <sup>1</sup> texto; si no, markdown-it
	// la traga como "link reference definition" y el contenido desaparece del documento.
	s = s.replace(/^\[\^([^\]]+)\]:\s*(.*)$/, '<sup>$1</sup> $2');
	// %%oculto%% -> eliminar (ponytail: solo comentario en la misma línea)
	s = s.replace(/%%.*?%%/g, '');
	// Wikilinks -> [texto](obsidian://...) si la nota existe, si no solo texto
	s = s.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_full, inner: string) => {
		const pipe = inner.indexOf('|');
		const beforeAlias = pipe === -1 ? inner : inner.slice(0, pipe);
		const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim();
		const hash = beforeAlias.indexOf('#');
		const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
		const sub = hash === -1 ? null : beforeAlias.slice(hash + 1).trim();
		const text = alias || sub || target;
		const resolved = vault.resolve(target, sourcePath);
		if (!resolved) return text;
		const file = resolved.path.replace(/\.md$/i, '');
		return `[${text}](obsidian://open?vault=${encodeURIComponent(vault.vaultName)}&file=${encodeURIComponent(file)})`;
	});
	// #etiqueta -> texto plano (sin #); no toca "# Título" (requiere carácter no-espacio tras #)
	s = s.replace(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gu, '$1$2');
	return s;
}
