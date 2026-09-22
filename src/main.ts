import { Notice, Plugin } from 'obsidian';

// MVP: comando de exportación. Se cablea en el hito del preprocesador.
export default class FaithfulDocxExportPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'export-to-word-faithful',
			name: 'Export to Word (faithful)',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) new Notice('Export not wired yet');
				return true;
			},
		});
	}

	onunload() {}
}
