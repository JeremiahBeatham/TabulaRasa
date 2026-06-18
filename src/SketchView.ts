import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TextFileView,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import {
	SketchCanvas,
	BrushSettings,
	CanvasAnchor,
	MIN_CANVAS_SIZE,
	MAX_CANVAS_SIZE,
} from "./canvas";
import {
	SketchDoc,
	ToolName,
	createEmptyDoc,
	parseDoc,
	serializeDoc,
} from "./model";
import type TabulaRasaPlugin from "./main";
import { TABULA_RASA_ICON_ID, TABULA_RASA_RESIZE_ICON_ID } from "./icon";

export const VIEW_TYPE_SKETCH = "tabula-rasa-sketch-view";

const PALETTE = [
	"#000000",
	"#e03131",
	"#1971c2",
	"#2f9e44",
	"#f08c00",
	"#9c36b5",
	"#ffffff",
];

const BRUSH_SIZES = [3, 6, 12, 24];

/**
 * Full-screen editor for `.sketch` files. Extends TextFileView so Obsidian
 * handles file load/save and the dirty indicator; we serialize the SketchDoc
 * as the file's text content.
 */
export class SketchView extends TextFileView {
	private plugin: TabulaRasaPlugin;
	private doc: SketchDoc;
	private canvas: SketchCanvas | null = null;
	private canvasHost: HTMLElement | null = null;
	private brush: BrushSettings;
	private resizeObserver: ResizeObserver | null = null;

	private toolButtons = new Map<ToolName, HTMLElement>();
	private colorButtons = new Map<string, HTMLElement>();
	private sizeButtons = new Map<number, HTMLElement>();
	private undoBtn: HTMLElement | null = null;
	private redoBtn: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TabulaRasaPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.doc = createEmptyDoc(
			plugin.settings.canvasWidth,
			plugin.settings.canvasHeight,
			plugin.settings.defaultBackground,
		);
		this.brush = {
			tool: "pen",
			color: plugin.settings.defaultColor,
			size: plugin.settings.defaultBrushSize,
			opacity: 1,
		};
	}

	getViewType(): string {
		return VIEW_TYPE_SKETCH;
	}

	getIcon(): string {
		return TABULA_RASA_ICON_ID;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Sketch";
	}

	// --- TextFileView plumbing -----------------------------------------

	getViewData(): string {
		if (this.canvas) this.doc = this.canvas.getDoc();
		return serializeDoc(this.doc);
	}

	setViewData(data: string, clear: boolean): void {
		this.doc = parseDoc(data);
		if (clear) {
			// New file context: ensure canvas reflects this document.
			this.rebuildCanvas();
		} else if (this.canvas) {
			this.rebuildCanvas();
		}
	}

	clear(): void {
		this.doc = createEmptyDoc(
			this.plugin.settings.canvasWidth,
			this.plugin.settings.canvasHeight,
			this.plugin.settings.defaultBackground,
		);
		if (this.canvas) this.rebuildCanvas();
	}

	// --- lifecycle ------------------------------------------------------

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("tabula-rasa-view");
		this.applyThemeDefaultColor();
		this.buildToolbar();
		this.canvasHost = this.contentEl.createDiv({
			cls: "tabula-rasa-canvas-host",
		});
		this.rebuildCanvas();

		this.resizeObserver = new ResizeObserver(() => this.canvas?.resize());
		if (this.canvasHost) this.resizeObserver.observe(this.canvasHost);
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		// Persist the .sketch source so leaving/closing always keeps your work.
		if (this.file && this.canvas) {
			await this.app.vault
				.modify(this.file, this.getViewData())
				.catch((e) => console.error("Saving sketch on close failed", e));
		}
		this.canvas?.destroy();
		this.canvas = null;
	}

	// --- canvas wiring --------------------------------------------------

	private rebuildCanvas(): void {
		if (!this.canvasHost) return;
		this.canvas?.destroy();
		this.canvasHost.empty();
		this.canvas = new SketchCanvas(this.canvasHost, this.doc, this.brush, {
			palmRejection: this.plugin.settings.palmRejection,
			onChange: () => {
				this.requestSave();
				this.refreshHistoryButtons();
			},
		});
		// Defer sizing until layout settles (important on mobile open).
		window.setTimeout(() => this.canvas?.resize(), 0);
		this.refreshHistoryButtons();
	}

	// --- toolbar --------------------------------------------------------

	private buildToolbar(): void {
		const bar = this.contentEl.createDiv({ cls: "tabula-rasa-toolbar" });

		const tools: { tool: ToolName; icon: string; label: string }[] = [
			{ tool: "pen", icon: "pencil", label: "Pen" },
			{ tool: "highlighter", icon: "highlighter", label: "Highlighter" },
			{ tool: "eraser", icon: "eraser", label: "Eraser" },
		];
		const toolGroup = bar.createDiv({ cls: "tabula-rasa-group" });
		for (const t of tools) {
			const btn = this.makeButton(toolGroup, t.icon, t.label, () =>
				this.selectTool(t.tool),
			);
			this.toolButtons.set(t.tool, btn);
		}

		const colorGroup = bar.createDiv({ cls: "tabula-rasa-group" });
		for (const color of PALETTE) {
			const swatch = colorGroup.createEl("button", {
				cls: "tabula-rasa-swatch",
				attr: { "aria-label": color, type: "button" },
			});
			swatch.style.backgroundColor = color;
			swatch.addEventListener("click", () => this.selectColor(color));
			this.colorButtons.set(color, swatch);
		}

		const sizeGroup = bar.createDiv({ cls: "tabula-rasa-group" });
		for (const size of BRUSH_SIZES) {
			const btn = sizeGroup.createEl("button", {
				cls: "tabula-rasa-size",
				attr: { "aria-label": `Size ${size}`, type: "button" },
			});
			const dot = btn.createDiv({ cls: "tabula-rasa-size-dot" });
			const px = Math.max(4, Math.min(22, size));
			dot.style.width = `${px}px`;
			dot.style.height = `${px}px`;
			btn.addEventListener("click", () => this.selectSize(size));
			this.sizeButtons.set(size, btn);
		}

		const actionGroup = bar.createDiv({ cls: "tabula-rasa-group" });
		this.undoBtn = this.makeButton(actionGroup, "undo-2", "Undo", () =>
			this.canvas?.undo(),
		);
		this.redoBtn = this.makeButton(actionGroup, "redo-2", "Redo", () =>
			this.canvas?.redo(),
		);
		this.makeButton(actionGroup, "trash-2", "Clear", () => {
			this.canvas?.clear();
		});
		this.makeButton(
			actionGroup,
			TABULA_RASA_RESIZE_ICON_ID,
			"Canvas size",
			() => this.openResizeModal(),
		);
		this.makeButton(actionGroup, "maximize", "Fit to screen", () => {
			this.canvas?.fitView();
		});
		this.makeButton(actionGroup, "check", "Save sketch", () => {
			void this.saveSketch();
		});
		this.makeButton(actionGroup, "download", "Export PNG", () => {
			void this.exportPng();
		});

		this.selectTool(this.brush.tool);
		this.selectColor(this.brush.color);
		this.selectSize(this.brush.size);
	}

	private makeButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): HTMLElement {
		const btn = parent.createEl("button", {
			cls: "tabula-rasa-btn",
			attr: { "aria-label": label, type: "button" },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private selectTool(tool: ToolName): void {
		this.brush.tool = tool;
		// Highlighter is semi-transparent and wider; eraser uses brush size.
		if (tool === "highlighter") {
			this.brush.opacity = 0.4;
		} else {
			this.brush.opacity = 1;
		}
		this.canvas?.setBrush(this.brush);
		this.toolButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === tool),
		);
	}

	private selectColor(color: string): void {
		this.brush.color = color;
		this.canvas?.setBrush(this.brush);
		this.colorButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === color),
		);
	}

	private selectSize(size: number): void {
		this.brush.size = size;
		this.canvas?.setBrush(this.brush);
		this.sizeButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === size),
		);
	}

	private openResizeModal(): void {
		const doc = this.canvas?.getDoc();
		if (!doc) return;
		new ResizeCanvasModal(this.app, {
			width: doc.width,
			height: doc.height,
			hasContent: doc.strokes.length > 0,
			onApply: (w, h, anchor, scaleToFit) =>
				this.canvas?.resizeCanvas(w, h, anchor, scaleToFit),
			onFitToContent: () => this.canvas?.fitCanvasToContent(),
		}).open();
	}

	private refreshHistoryButtons(): void {
		if (this.undoBtn) this.undoBtn.toggleClass("is-disabled", !this.canvas?.canUndo());
		if (this.redoBtn) this.redoBtn.toggleClass("is-disabled", !this.canvas?.canRedo());
	}

	/** Pick a starting pen color that's visible on the current theme background. */
	private applyThemeDefaultColor(): void {
		if (!this.plugin.settings.matchPenColorToTheme) return;
		const isDark = document.body.classList.contains("theme-dark");
		this.brush.color = isDark ? "#ffffff" : "#000000";
	}

	/** Write the .sketch source now. No PNG is produced — that's export-only. */
	private async saveSketch(): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to save yet.");
			return;
		}
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			new Notice("Sketch saved.");
		} catch (e) {
			console.error(e);
			new Notice("Save failed. See console for details.");
		}
	}

	/**
	 * Generate a PNG (the only time one is created) and ask whether to embed it
	 * in a note or just keep the image file in the vault.
	 */
	private async exportPng(): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to export yet.");
			return;
		}
		new ExportChoiceModal(this.app, {
			onAddToNote: () => void this.exportAndEmbed(),
			onDownload: () => void this.exportToFile(),
		}).open();
	}

	private async exportToFile(): Promise<void> {
		if (!this.file) return;
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			const path = await this.plugin.exportSketchToPng(
				this.file,
				this.getViewData(),
			);
			new Notice(`Image saved to your vault: ${path}`);
		} catch (e) {
			console.error(e);
			new Notice("PNG export failed. See console for details.");
		}
	}

	private async exportAndEmbed(): Promise<void> {
		if (!this.file) return;
		const note = await this.resolveTargetNote();
		if (!note) return;
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			const pngPath = await this.plugin.exportSketchToPng(
				this.file,
				this.getViewData(),
			);
			await this.embedInNote(note, pngPath);
			// Remember the note for next time if the sketch had none.
			if (this.canvas && !this.canvas.getDoc().sourceNote) {
				this.canvas.getDoc().sourceNote = note.path;
				await this.app.vault.modify(this.file, this.getViewData());
			}
			new Notice(`Image added to “${note.basename}”.`);
		} catch (e) {
			console.error(e);
			new Notice("Export failed. See console for details.");
		}
	}

	/** Use the sketch's origin note if it still exists, otherwise let the user pick. */
	private resolveTargetNote(): Promise<TFile | null> {
		const sourcePath = this.canvas?.getDoc().sourceNote;
		if (sourcePath) {
			const f = this.app.vault.getAbstractFileByPath(sourcePath);
			if (f instanceof TFile && f.extension === "md") {
				return Promise.resolve(f);
			}
		}
		return new Promise((resolve) => {
			new NotePickerModal(this.app, resolve).open();
		});
	}

	/** Insert the embed after the sketch's link if present, else append it. */
	private async embedInNote(note: TFile, pngPath: string): Promise<void> {
		const pngName = pngPath.split("/").pop() ?? pngPath;
		const embed = `![[${pngName}]]`;
		const content = await this.app.vault.read(note);
		if (content.includes(embed)) return; // already embedded

		const sketchName = this.file?.basename ?? "";
		const lines = content.split("\n");
		const linkIdx = sketchName
			? lines.findIndex((l) => l.includes(`[[${sketchName}`))
			: -1;
		if (linkIdx >= 0) {
			lines.splice(linkIdx + 1, 0, embed);
			await this.app.vault.modify(note, lines.join("\n"));
		} else {
			const sep = content.endsWith("\n") || content === "" ? "" : "\n";
			await this.app.vault.modify(note, `${content}${sep}\n${embed}\n`);
		}
	}
}

/** Two-choice dialog shown when exporting: embed in a note, or just keep the file. */
class ExportChoiceModal extends Modal {
	constructor(
		app: App,
		private actions: { onAddToNote: () => void; onDownload: () => void },
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Export sketch as image");
		this.contentEl.createEl("p", {
			text: "A PNG will be created from your sketch. Where should it go?",
		});
		new Setting(this.contentEl)
			.setName("Add to a note")
			.setDesc("Create the image and embed it in a note.")
			.addButton((b) =>
				b
					.setButtonText("Add to note")
					.setCta()
					.onClick(() => {
						this.close();
						this.actions.onAddToNote();
					}),
			);
		new Setting(this.contentEl)
			.setName("Just save the image")
			.setDesc("Keep the PNG file in your vault without embedding it.")
			.addButton((b) =>
				b.setButtonText("Save image").onClick(() => {
					this.close();
					this.actions.onDownload();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Fuzzy picker over markdown notes for choosing an embed destination. */
class NotePickerModal extends FuzzySuggestModal<TFile> {
	private picked = false;

	constructor(
		app: App,
		private onResolve: (note: TFile | null) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a note to add the image to…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.picked = true;
		this.onResolve(file);
	}

	onClose(): void {
		super.onClose();
		if (!this.picked) this.onResolve(null);
	}
}

interface ResizeActions {
	width: number;
	height: number;
	hasContent: boolean;
	onApply: (
		width: number,
		height: number,
		anchor: CanvasAnchor,
		scaleToFit: boolean,
	) => void;
	onFitToContent: () => void;
}

const RESIZE_PRESETS: { label: string; width: number; height: number }[] = [
	{ label: "Square", width: 1280, height: 1280 },
	{ label: "4:3", width: 1280, height: 960 },
	{ label: "16:9", width: 1280, height: 720 },
	{ label: "A4 portrait", width: 1240, height: 1754 },
	{ label: "A4 landscape", width: 1754, height: 1240 },
];

const ANCHOR_OPTIONS: { value: CanvasAnchor; label: string }[] = [
	{ value: "top-left", label: "Top left" },
	{ value: "top", label: "Top" },
	{ value: "top-right", label: "Top right" },
	{ value: "left", label: "Left" },
	{ value: "center", label: "Center" },
	{ value: "right", label: "Right" },
	{ value: "bottom-left", label: "Bottom left" },
	{ value: "bottom", label: "Bottom" },
	{ value: "bottom-right", label: "Bottom right" },
];

/** Dialog for changing the canvas dimensions / aspect ratio from the page. */
class ResizeCanvasModal extends Modal {
	private width: number;
	private height: number;
	private anchor: CanvasAnchor = "center";
	private scaleToFit = false;
	private widthInput: HTMLInputElement | null = null;
	private heightInput: HTMLInputElement | null = null;

	constructor(
		app: App,
		private actions: ResizeActions,
	) {
		super(app);
		this.width = actions.width;
		this.height = actions.height;
	}

	onOpen(): void {
		this.titleEl.setText("Canvas size");

		const presets = new Setting(this.contentEl)
			.setName("Presets")
			.setDesc("Apply a common size or aspect ratio.");
		for (const p of RESIZE_PRESETS) {
			presets.addButton((b) =>
				b.setButtonText(p.label).onClick(() => {
					this.width = p.width;
					this.height = p.height;
					this.syncInputs();
				}),
			);
		}

		new Setting(this.contentEl).setName("Width").setDesc("Pixels.").addText(
			(t) => {
				t.inputEl.type = "number";
				t.setValue(String(this.width));
				this.widthInput = t.inputEl;
				t.onChange((v) => {
					this.width = Number(v);
				});
			},
		);

		new Setting(this.contentEl)
			.setName("Height")
			.setDesc("Pixels.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(this.height));
				this.heightInput = t.inputEl;
				t.onChange((v) => {
					this.height = Number(v);
				});
			});

		new Setting(this.contentEl)
			.setName("Anchor")
			.setDesc("Where your drawing stays when the canvas size changes.")
			.addDropdown((dd) => {
				for (const a of ANCHOR_OPTIONS) dd.addOption(a.value, a.label);
				dd.setValue(this.anchor);
				dd.onChange((v) => {
					this.anchor = v as CanvasAnchor;
				});
			});

		new Setting(this.contentEl)
			.setName("Scale drawing to fit")
			.setDesc(
				"Resize your existing strokes to fill the new canvas instead of just repositioning them.",
			)
			.addToggle((t) =>
				t.setValue(this.scaleToFit).onChange((v) => {
					this.scaleToFit = v;
				}),
			);

		new Setting(this.contentEl)
			.setName("Fit to drawing")
			.setDesc(
				this.actions.hasContent
					? "Shrink the canvas to tightly wrap your drawing."
					: "Draw something first to use this.",
			)
			.addButton((b) => {
				b.setButtonText("Fit to drawing");
				b.setDisabled(!this.actions.hasContent);
				b.onClick(() => {
					this.close();
					this.actions.onFitToContent();
				});
			});

		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText("Apply")
					.setCta()
					.onClick(() => this.apply()),
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	private syncInputs(): void {
		if (this.widthInput) this.widthInput.value = String(this.width);
		if (this.heightInput) this.heightInput.value = String(this.height);
	}

	private apply(): void {
		const w = Math.round(this.width);
		const h = Math.round(this.height);
		if (
			!Number.isFinite(w) ||
			!Number.isFinite(h) ||
			w < MIN_CANVAS_SIZE ||
			h < MIN_CANVAS_SIZE ||
			w > MAX_CANVAS_SIZE ||
			h > MAX_CANVAS_SIZE
		) {
			new Notice(
				`Enter a width and height between ${MIN_CANVAS_SIZE} and ${MAX_CANVAS_SIZE} px.`,
			);
			return;
		}
		this.close();
		this.actions.onApply(w, h, this.anchor, this.scaleToFit);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
