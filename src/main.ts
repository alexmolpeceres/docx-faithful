import { Notice, Plugin, TFile } from 'obsidian';
import { MarkdownToDocxConverter } from './converter';
import { preprocessObsidian, PreprocessVault } from './obsidian-preprocessor';

// Sin settings UI (fuera de alcance f2): valores fijos del MVP.
const SETTINGS = {
	defaultFontFamily: 'Calibri',
	defaultFontSize: 11,
	includeMetadata: false,
	preserveFormatting: true,
	useObsidianAppearance: false,
	includeFilenameAsHeader: false,
	pageSize: 'A4' as const,
	chunkingThreshold: 100000,
	enablePreprocessing: false,
};

export default class FaithfulDocxExportPlugin extends Plugin {
	converter: MarkdownToDocxConverter = new MarkdownToDocxConverter(SETTINGS);

	async onload() {
		this.addCommand({
			id: 'export-to-word-faithful',
			name: 'Export to Word (faithful)',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.export(file);
				return true;
			},
		});
	}

	onunload() {}

	private makeVault(): PreprocessVault {
		return {
			vaultName: this.app.vault.getName(),
			resolve: (linkpath: string, fromPath: string) => {
				const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
				return dest ? { path: dest.path, isMd: dest.extension === 'md' } : null;
			},
			read: (path: string) => this.app.vault.adapter.read(path),
		};
	}

	async export(file: TFile) {
		try {
			new Notice('Exporting to Word...');
			const vault = this.makeVault();
			const source = await this.app.vault.read(file);
			const markdown = await preprocessObsidian(source, vault, file.path);

			// Mismo criterio que toword: resuelve el recurso en el vault y lee sus bytes
			const resourceLoader = async (link: string): Promise<ArrayBuffer | null> => {
				const dest = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
				if (!dest) return null;
				try {
					return await this.app.vault.readBinary(dest);
				} catch (err) {
					console.error(`Failed to load embedded resource: ${link}`, err);
					return null;
				}
			};

			const blob = await this.converter.convert(markdown, file.basename, null, resourceLoader);

			const parent = file.parent?.path;
			const outPath = parent && parent !== '/' ? `${parent}/${file.basename}.docx` : `${file.basename}.docx`;
			await this.app.vault.adapter.writeBinary(outPath, await blob.arrayBuffer());
			new Notice(`Saved to: ${outPath}`, 5000);
		} catch (error) {
			console.error('Faithful DOCX export failed:', error);
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Error exporting to Word: ${message}`);
		}
	}
}
