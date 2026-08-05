import {
	Editor,
	MarkdownRenderChild,
	Notice,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	TabulaRasaSettings,
	TabulaRasaSettingTab,
} from "./settings";
import { SketchView, VIEW_TYPE_SKETCH } from "./SketchView";
import {
	SKETCH_EXTENSION,
	createEmptyDoc,
	parseDoc,
	serializeDoc,
} from "./model";
import { renderDocToPngBlob, renderDocToSvg } from "./export";
import { TABULA_RASA_ICON_ID, registerTabulaRasaIcon } from "./icon";

export default class TabulaRasaPlugin extends Plugin {
	settings!: TabulaRasaSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		registerTabulaRasaIcon();

		this.registerView(
			VIEW_TYPE_SKETCH,
			(leaf) => new SketchView(leaf, this),
		);
		this.registerExtensions([SKETCH_EXTENSION], VIEW_TYPE_SKETCH);

		// Render `![[…sketch]]` embeds as a live inline preview of the canvas.
		// We register a real embed handler (instead of a markdown post-processor)
		// so Obsidian uses our renderer rather than the generic "file in a box"
		// fallback it shows for unknown file types.
		this.registerSketchEmbed();

		this.addRibbonIcon(TABULA_RASA_ICON_ID, "New sketch", () => {
			void this.createAndOpenSketch();
		});

		this.addCommand({
			id: "create-sketch",
			name: "Create new sketch",
			icon: TABULA_RASA_ICON_ID,
			callback: () => {
				void this.createAndOpenSketch();
			},
		});

		this.addCommand({
			id: "create-sketch-embed",
			name: "Create new sketch in current note",
			icon: TABULA_RASA_ICON_ID,
			editorCallback: (editor: Editor, ctx) => {
				void this.createAndLinkSketch(editor, ctx.file ?? null);
			},
		});

		this.addCommand({
			id: "export-sketch-svg",
			name: "Export current sketch as SVG",
			icon: "download",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(SketchView);
				if (!view || !view.file) return false;
				if (!checking) void this.exportActiveSvg(view);
				return true;
			},
		});

		this.addSettingTab(new TabulaRasaSettingTab(this.app, this));
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
	 * Create a sketch and reference it in the current note. Depending on the
	 * "Insert sketches into notes as" setting this inserts either a live inline
	 * preview (embed) or a plain link. No image file is ever generated.
	 */
	async createAndLinkSketch(editor: Editor, note: TFile | null): Promise<void> {
		const file = await this.createSketchFile(note?.path);
		const useEmbed = this.settings.noteInsertMode === "embed";
		const link = this.app.fileManager.generateMarkdownLink(
			file,
			note?.path ?? "",
		);
		editor.replaceSelection(`${useEmbed ? "!" : ""}${link}\n`);
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		new Notice(
			useEmbed
				? "Sketch created and embedded in this note."
				: "Sketch created and linked in this note.",
		);
	}

	// --- inline embed rendering ----------------------------------------

	/**
	 * Teach Obsidian to render `.sketch` embeds as a live SVG preview. We hook the
	 * (internal) embed registry so our renderer replaces the generic file-embed
	 * box for both Reading view and Live Preview. The registration is undone on
	 * unload.
	 */
	private registerSketchEmbed(): void {
		const registry = (this.app as unknown as { embedRegistry?: EmbedRegistry })
			.embedRegistry;
		if (!registry?.registerExtension) {
			console.warn(
				"Tabula Rasa: embed registry unavailable; sketch previews disabled.",
			);
			return;
		}
		registry.registerExtension(SKETCH_EXTENSION, (ctx, file) =>
			new SketchEmbed(ctx.containerEl, this, file),
		);
		this.register(() => registry.unregisterExtension?.(SKETCH_EXTENSION));
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

	/** Rebuild open sketch views so settings changes show up without a reopen. */
	refreshOpenSketchViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SKETCH)) {
			const view = leaf.view;
			if (view instanceof SketchView) view.refreshChrome();
		}
	}

	async exportActiveSvg(view: SketchView): Promise<void> {
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

/** Minimal shape of Obsidian's (internal) embed registry that we depend on. */
interface EmbedRegistry {
	registerExtension?(
		ext: string,
		creator: (ctx: { containerEl: HTMLElement }, file: TFile) => SketchEmbed,
	): void;
	unregisterExtension?(ext: string): void;
}

/**
 * Renders a .sketch file inline inside a note as an SVG preview, and keeps it
 * in sync when the underlying sketch is edited. Clicking opens the editor.
 * `loadFile` is invoked by the embed registry when the embed is (re)loaded.
 */
class SketchEmbed extends MarkdownRenderChild {
	private wired = false;

	constructor(
		containerEl: HTMLElement,
		private plugin: TabulaRasaPlugin,
		private file: TFile,
	) {
		super(containerEl);
	}

	onload(): void {
		this.wire();
		void this.render();
	}

	/** Called by Obsidian's embed registry to (re)render the file. */
	async loadFile(): Promise<void> {
		this.wire();
		await this.render();
	}

	private wire(): void {
		if (this.wired) return;
		this.wired = true;
		this.containerEl.empty();
		this.containerEl.addClass("tabula-rasa-embed");
		this.containerEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void this.plugin.app.workspace.getLeaf("tab").openFile(this.file);
		});
		// Refresh the preview whenever the sketch is saved elsewhere.
		this.registerEvent(
			this.plugin.app.vault.on("modify", (f) => {
				if (f.path === this.file.path) void this.render();
			}),
		);
	}

	private async render(): Promise<void> {
		try {
			const raw = await this.plugin.app.vault.cachedRead(this.file);
			const doc = parseDoc(raw);
			const svg = new DOMParser()
				.parseFromString(renderDocToSvg(doc), "image/svg+xml")
				.documentElement;
			this.containerEl.empty();
			this.containerEl.appendChild(svg);
		} catch (e) {
			console.error("Failed to render sketch embed", e);
			this.containerEl.empty();
			this.containerEl.setText("Could not render sketch preview.");
		}
	}
}
