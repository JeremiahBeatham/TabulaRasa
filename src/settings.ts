import { App, PluginSettingTab, Setting } from "obsidian";
import type TabulaRasaPlugin from "./main";

export interface TabulaRasaSettings {
	/** Folder where new .sketch files (and PNG exports) are created. Empty = vault root. */
	sketchFolder: string;
	defaultColor: string;
	/** When true, start the pen in a color that contrasts the current theme. */
	matchPenColorToTheme: boolean;
	defaultBrushSize: number;
	palmRejection: boolean;
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
	canvasWidth: 1280,
	canvasHeight: 960,
	pngExportScale: 2,
	defaultBackground: "transparent",
	noteInsertMode: "embed",
	eraserMode: "stroke",
	toolbarButtonSize: 32,
	gesturesEnabled: true,
};

export class TabulaRasaSettingTab extends PluginSettingTab {
	plugin: TabulaRasaPlugin;

	constructor(app: App, plugin: TabulaRasaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
			.setName("Match pen color to theme")
			.setDesc(
				"Start drawing in white on a dark theme and black on a light theme, so the pen is always visible. Turn off to always use the default color below.",
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
			.setName("Default brush color")
			.setDesc("Used for new sketches when “Match pen color to theme” is off.")
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
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultBrushSize = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Toolbar").setHeading();

		new Setting(containerEl)
			.setName("Button size")
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

		new Setting(containerEl).setName("Gestures").setHeading();

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

		new Setting(containerEl).setName("Drawing").setHeading();

		new Setting(containerEl)
			.setName("Palm rejection")
			.setDesc(
				"When drawing with an Apple Pencil or stylus, ignore finger/touch input.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.palmRejection)
					.onChange(async (value) => {
						this.plugin.settings.palmRejection = value;
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
			.setName("Canvas width")
			.setDesc("Logical width of new sketches in pixels.")
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
			.setName("Canvas height")
			.setDesc("Logical height of new sketches in pixels.")
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
			.setName("PNG export scale")
			.setDesc(
				"Resolution multiplier for embedded PNG images. Higher = crisper but larger files.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(this.plugin.settings.pngExportScale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.pngExportScale = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
