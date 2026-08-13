import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type TabulaRasaPlugin from "./main";

export interface TabulaRasaSettings {
	/** Folder where new .sketch files (and PNG exports) are created. Empty = vault root. */
	sketchFolder: string;
	defaultColor: string;
	/** When true, start the pen in a color that contrasts the current theme. */
	matchPenColorToTheme: boolean;
	defaultBrushSize: number;
	palmRejection: boolean;
	/**
	 * When true, new sketches get a portrait canvas sized to the screen instead of
	 * the fixed dimensions below, so a fresh sketch fills the page you're drawing on.
	 */
	fitNewSketchesToScreen: boolean;
	/** Fallback dimensions for new sketches when not fitting to the screen. */
	canvasWidth: number;
	canvasHeight: number;
	/** Pixel scale used when exporting PNGs for embedding. */
	pngExportScale: number;
	/** Default background for new sketches: "transparent" or a CSS color. */
	defaultBackground: string;
	/**
	 * How a sketch is inserted into a note when created from it:
	 * "embed" renders a live inline preview; "link" inserts a plain link.
	 */
	noteInsertMode: "embed" | "link";
	/** Eraser behavior: "stroke" removes whole strokes; "partial" erases the touched part. */
	eraserMode: "stroke" | "partial";
	/**
	 * Diameter of the toolbar's circular buttons in pixels. The tap target stays
	 * at least 44px regardless — only the drawn circle changes size.
	 */
	toolbarButtonSize: ToolbarButtonSize;
	/**
	 * Double-tap gestures: two fingers to undo, three to redo. Recognised by the
	 * fingers *not* travelling, which keeps them clear of two-finger pan/zoom.
	 */
	gesturesEnabled: boolean;
	/**
	 * Hold still at the end of a stroke and a rough line or circle is replaced by a
	 * clean one. Deliberately a hold rather than automatic: a stroke that reshapes
	 * itself the instant you lift is startling, and unpredictable mid-sketch.
	 */
	shapeSnap: boolean;
}

export type ToolbarButtonSize = 24 | 32 | 40;
export const TOOLBAR_BUTTON_SIZES: ToolbarButtonSize[] = [24, 32, 40];
/** Apple's minimum comfortable tap target; the button's hit area never goes below it. */
export const MIN_TAP_TARGET = 44;

export const DEFAULT_SETTINGS: TabulaRasaSettings = {
	sketchFolder: "Sketches",
	defaultColor: "#000000",
	matchPenColorToTheme: true,
	defaultBrushSize: 6,
	palmRejection: true,
	fitNewSketchesToScreen: true,
	canvasWidth: 960,
	canvasHeight: 1280,
	pngExportScale: 2,
	defaultBackground: "transparent",
	noteInsertMode: "embed",
	eraserMode: "stroke",
	toolbarButtonSize: 32,
	gesturesEnabled: true,
	shapeSnap: true,
};

export class TabulaRasaSettingTab extends PluginSettingTab {
	plugin: TabulaRasaPlugin;

	constructor(app: App, plugin: TabulaRasaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Section headings match the per-sketch sheet: an icon and a size step up, so
	 * sections don't lose to their own contents.
	 */
	private heading(icon: string, text: string): void {
		const h = this.containerEl.createDiv({ cls: "tabula-rasa-sheet-heading" });
		const ic = h.createSpan({ cls: "tabula-rasa-sheet-heading-icon" });
		setIcon(ic, icon);
		h.createSpan({ cls: "tabula-rasa-sheet-heading-text", text });
	}

	/**
	 * Section order and membership come from a card sort, not from the order these
	 * settings happened to be added. Palm rejection deliberately isn't here — it
	 * moved to the per-sketch sheet, where you actually reach for it.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("tabula-rasa-sheet-body");

		this.heading("settings", "General");

		new Setting(containerEl)
			.setName("Sketch folder")
			.setDesc(
				"Folder where new sketches and their image exports are saved. Leave empty for the vault root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Sketches")
					.setValue(this.plugin.settings.sketchFolder)
					.onChange(async (value) => {
						this.plugin.settings.sketchFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Insert sketches into notes as")
			.setDesc(
				"When you create a sketch from a note, choose whether the note shows a live inline preview of the canvas or just a link to the sketch.",
			)
			.addDropdown((dd) =>
				dd
					.addOption("embed", "Live preview (inline)")
					.addOption("link", "Link")
					.setValue(this.plugin.settings.noteInsertMode)
					.onChange(async (value) => {
						this.plugin.settings.noteInsertMode =
							value === "link" ? "link" : "embed";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Match pen colour to theme")
			.setDesc(
				"Start drawing in white on a dark theme and black on a light theme, so the pen is always visible. Turn off to always use the default colour below.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchPenColorToTheme)
					.onChange(async (value) => {
						this.plugin.settings.matchPenColorToTheme = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default brush colour")
			.setDesc("Used for new sketches when “Match pen colour to theme” is off.")
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.defaultColor)
					.onChange(async (value) => {
						this.plugin.settings.defaultColor = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default brush size")
			.setDesc("Base stroke width in pixels.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 40, 1)
					.setValue(this.plugin.settings.defaultBrushSize)
					.onChange(async (value) => {
						this.plugin.settings.defaultBrushSize = value;
						await this.plugin.saveSettings();
					}),
			);

		this.heading("circle", "Toolbar");

		new Setting(containerEl)
			.setName("Toolbar button size")
			.setDesc(
				"Diameter of the toolbar buttons. Smaller buttons leave more room for the canvas; the tap area stays comfortable either way.",
			)
			.addDropdown((dd) => {
				for (const size of TOOLBAR_BUTTON_SIZES) {
					dd.addOption(String(size), `${size} px`);
				}
				dd.setValue(String(this.plugin.settings.toolbarButtonSize));
				dd.onChange(async (value) => {
					const n = Number(value) as ToolbarButtonSize;
					if (TOOLBAR_BUTTON_SIZES.includes(n)) {
						this.plugin.settings.toolbarButtonSize = n;
						await this.plugin.saveSettings();
						this.plugin.refreshOpenSketchViews();
					}
				});
			});

		this.heading("hand", "Gestures");

		new Setting(containerEl)
			.setName("Double-tap to undo and redo")
			.setDesc(
				"Double-tap with two fingers to undo, three fingers to redo. Dragging two fingers still pans and zooms — only taps that stay put count as gestures.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.gesturesEnabled)
					.onChange(async (value) => {
						this.plugin.settings.gesturesEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.refreshOpenSketchViews();
					}),
			);

		this.heading("pencil", "Drawing");

		new Setting(containerEl)
			.setName("Hold to snap shapes")
			.setDesc(
				"Pause at the end of a stroke, without lifting, and a rough line or circle becomes a clean one. Holding over anything else leaves it alone.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.shapeSnap).onChange(async (value) => {
					this.plugin.settings.shapeSnap = value;
					await this.plugin.saveSettings();
					this.plugin.refreshOpenSketchViews();
				}),
			);

		new Setting(containerEl)
			.setName("Fit new sketches to the screen")
			.setDesc(
				"New sketches get a portrait canvas the size of the screen, so a fresh sketch fills the page. Turn off to always use the fixed size below.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fitNewSketchesToScreen)
					.onChange(async (value) => {
						this.plugin.settings.fitNewSketchesToScreen = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Transparent background")
			.setDesc(
				"New sketches use a transparent background. Turn off for a white page.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultBackground === "transparent")
					.onChange(async (value) => {
						this.plugin.settings.defaultBackground = value
							? "transparent"
							: "#ffffff";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default canvas height")
			.setDesc("Height of new sketches in pixels, when not fitting to the screen.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.canvasHeight))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.canvasHeight = Math.round(n);
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Default canvas width")
			.setDesc("Width of new sketches in pixels, when not fitting to the screen.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.canvasWidth))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.canvasWidth = Math.round(n);
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("PNG export scale")
			.setDesc(
				"Resolution multiplier for exported PNG images. Higher = crisper but larger files.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(this.plugin.settings.pngExportScale)
					.onChange(async (value) => {
						this.plugin.settings.pngExportScale = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
