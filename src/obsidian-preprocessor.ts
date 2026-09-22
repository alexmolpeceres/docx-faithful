// Pre-procesador de sintaxis Obsidian (callouts, wikilinks, embeds, ocultos, etiquetas).
// STUB TDD: aún no transforma nada -> la sintaxis llega sin procesar al converter.

export interface PreprocessVault {
	vaultName: string;
	/** Resuelve un linkpath (p. ej. "Otra Nota", "img.png") desde fromPath. Null si no existe. */
	resolve(linkpath: string, fromPath: string): { path: string; isMd: boolean } | null;
	/** Lee el contenido de texto de una nota. */
	read(path: string): Promise<string>;
}

export async function preprocessObsidian(
	markdown: string,
	_vault: PreprocessVault,
	_sourcePath: string,
): Promise<string> {
	return markdown;
}
