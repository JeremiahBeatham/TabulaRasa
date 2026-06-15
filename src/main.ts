import {
	Editor,
	Notice,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	ObsidianBoardSettings,
	ObsidianBoardSettingTab,
} from "./settings";
import { SketchView, VIEW_TYPE_SKETCH } from "./SketchView";
import {
	SKETCH_EXTENSION,
	createEmptyDoc,
	parseDoc,
	serializeDoc,
} from "./model";
import { renderDocToPngBlob, renderDocToSvg } from "./export";

export default class ObsidianBoardPlugin extends Plugin {
	settings!: ObsidianBoardSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SKETCH,
			(leaf) => new SketchView(leaf, this),
		);
		this.registerExtensions([SKETCH_EXTENSION], VIEW_TYPE_SKETCH);

		this.addRibbonIcon("pencil", "New sketch", () => {
			void this.createAndOpenSketch();
		});

		this.addCommand({
			id: "create-sketch",
			name: "Create new sketch",
			callback: () => {
				void this.createAndOpenSketch();
			},
		});

		this.addCommand({
			id: "create-sketch-embed",
			name: "Create new sketch linked to current note",
			editorCallback: (editor: Editor, ctx) => {
				void this.createAndLinkSketch(editor, ctx.file ?? null);
			},
		});

		this.addCommand({
			id: "export-sketch-svg",
			name: "Export current sketch as SVG",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(SketchView);
				if (!view || !view.file) return false;
				if (!checking) void this.exportActiveSvg(view);
				return true;
			},
		});

		this.addSettingTab(new ObsidianBoardSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian unregisters views/extensions registered above automatically.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// --- sketch file creation ------------------------------------------

	private async ensureFolder(folderPath: string): Promise<void> {
		if (!folderPath) return;
		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) return;
		if (existing) return; // a file occupies the path; fall back to root usage
		await this.app.vault.createFolder(folderPath).catch(() => {
			/* folder may have been created concurrently */
		});
	}

	private timestampName(): string {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `Sketch ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
			d.getDate(),
		)} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
	}

	private async uniquePath(base: string, ext: string): Promise<string> {
		const folder = this.settings.sketchFolder
			? normalizePath(this.settings.sketchFolder)
			: "";
		await this.ensureFolder(folder);
		const make = (suffix: string) =>
			normalizePath(`${folder ? folder + "/" : ""}${base}${suffix}.${ext}`);
		let candidate = make("");
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = make(` ${i++}`);
		}
		return candidate;
	}

	/**
	 * Create a new empty .sketch file and return its TFile. If a source note is
	 * given, the sketch records it so exports can default to that note.
	 */
	async createSketchFile(sourceNote?: string): Promise<TFile> {
		const doc = createEmptyDoc(
			this.settings.canvasWidth,
			this.settings.canvasHeight,
			this.settings.defaultBackground,
		);
		if (sourceNote) doc.sourceNote = sourceNote;
		const path = await this.uniquePath(this.timestampName(), SKETCH_EXTENSION);
		return await this.app.vault.create(path, serializeDoc(doc));
	}

	async createAndOpenSketch(): Promise<TFile> {
		const file = await this.createSketchFile();
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		return file;
	}

	/**
	 * Create a standalone sketch and drop a link to it in the current note (no
	 * image is generated — a PNG is only produced when the user exports).
	 */
	async createAndLinkSketch(editor: Editor, note: TFile | null): Promise<void> {
		const file = await this.createSketchFile(note?.path);
		const link = this.app.fileManager.generateMarkdownLink(
			file,
			note?.path ?? "",
		);
		editor.replaceSelection(`${link}\n`);
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		new Notice("Sketch created and linked in this note.");
	}

	// --- exporting ------------------------------------------------------

	private pngPathFor(sketch: TFile): string {
		const dir = sketch.parent && sketch.parent.path !== "/" ? sketch.parent.path : "";
		return normalizePath(`${dir ? dir + "/" : ""}${sketch.basename}.png`);
	}

	/** Render the given sketch document data to a PNG sibling file. Returns its path. */
	async exportSketchToPng(sketch: TFile, data: string): Promise<string> {
		const doc = parseDoc(data);
		const blob = await renderDocToPngBlob(doc, this.settings.pngExportScale);
		const buffer = await blob.arrayBuffer();
		const path = this.pngPathFor(sketch);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, buffer);
		} else {
			await this.app.vault.createBinary(path, buffer);
		}
		return path;
	}

	private async exportActiveSvg(view: SketchView): Promise<void> {
		const file = view.file;
		if (!file) return;
		const doc = parseDoc(view.getViewData());
		const svg = renderDocToSvg(doc);
		const dir = file.parent && file.parent.path !== "/" ? file.parent.path : "";
		const path = normalizePath(`${dir ? dir + "/" : ""}${file.basename}.svg`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, svg);
		} else {
			await this.app.vault.create(path, svg);
		}
		new Notice(`Exported SVG: ${path}`);
	}
}
