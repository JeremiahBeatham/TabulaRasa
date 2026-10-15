# Beatham fonts

The bundled faces, unmodified, with their licences — ported from HandCAD (`design/fonts`, ADR-0012). SF Pro and SF Compact are system fonts and are not bundled. Web projects and the guidelines site load them through `fonts.css` (this folder); Apple apps bundle the same files.

| Family | Role (token) | Files | PostScript names | Licence | Source |
|---|---|---|---|---|---|
| **Instrument Sans** | titles only (`font.family.display`) | `instrument-sans/InstrumentSans-SemiBold.ttf`, `InstrumentSans-Bold.ttf` | `InstrumentSans-SemiBold`, `InstrumentSans-Bold` | SIL OFL 1.1, no Reserved Font Name (`instrument-sans/OFL.txt`, "Copyright 2022 The Instrument Sans Project Authors") | [Instrument/instrument-sans](https://github.com/Instrument/instrument-sans) `fonts/ttf/`, commit `7fa22308a3d0`, v1.000 |
| **JetBrains Mono** | every number (`font.family.mono`) | `jetbrains-mono/JetBrainsMono-Regular.ttf`, `-Medium.ttf`, `-SemiBold.ttf` | `JetBrainsMono-Regular`, `JetBrainsMono-Medium`, `JetBrainsMono-SemiBold` | SIL OFL 1.1, no Reserved Font Name (`jetbrains-mono/OFL.txt`, "Copyright 2020 The JetBrains Mono Project Authors") | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) `fonts/ttf/`, commit `19371302b95d`, v2.305 |
| **Bitcount Single** | hero numerals only (`font.family.hero`) | `bitcount-single/BitcountSingle-Variable.ttf` (renamed from `BitcountSingle[CRSV,ELSH,ELXP,slnt,wght].ttf`; the font itself is unchanged) | `BitcountSingle-Regular` (the default instance: round dots, `ELSH` 0) | SIL OFL 1.1, no Reserved Font Name (`bitcount-single/OFL.txt`; the font's own copyright string reads "Copyright 2024 The Bitcount Project Authors"). "Bitcount" is a trademark of TYPETR. | [google/fonts `ofl/bitcountsingle`](https://github.com/google/fonts/tree/main/ofl/bitcountsingle), upstream [petrvanblokland/TYPETR-Bitcount](https://github.com/petrvanblokland/TYPETR-Bitcount) commit `af0818eaeb3b` |
| **Aujournuit** | Culinary sub-brand only: everything (`font.family.sans`/`display`/`mono` overridden in `subbrands/culinary`) | `aujournuit/Aujournuit-Regular.{ttf,woff2}`, `Aujournuit-Airy.{ttf,woff2}` | `Aujournuit-Regular`, `Aujournuit-Airy` | SIL OFL 1.1 (`aujournuit/OFL.txt`, "Copyright © 2023, Collletttivo") | [collletttivo.it/typefaces/aujournuit](https://www.collletttivo.it/typefaces/aujournuit), received as a zip from Jeremiah 2026-10-15 |

All files were downloaded on 2026-10-03 (for HandCAD) and copied here unchanged.

SHA-256:
```
735badeb8b2046cee6f5e1226412ab6c29db04accbca413af03d70e991dce10d  instrument-sans/InstrumentSans-Bold.ttf
7151cf505f897e17b4e9b956293b5a60046ec39da3923a8feba29ce86fd14e12  instrument-sans/InstrumentSans-SemiBold.ttf
e6fd0d7e91550b3ed2b735d4312474362c4716edc4fc0577a0f61ed782d5aed1  jetbrains-mono/JetBrainsMono-Regular.ttf
d16e6dc99672734698d629705f617c79f6eb6040f5113efe3a145204dc988109  jetbrains-mono/JetBrainsMono-Medium.ttf
12d4b18fe6e1af528e4bea69cb0997aeff22f9e52fccffcf66342dd88aa32ab8  jetbrains-mono/JetBrainsMono-SemiBold.ttf
007608c704d41cfff140892070b71f31971ec6d85b9f8ad5fdd0d2625f517c70  bitcount-single/BitcountSingle-Variable.ttf
```

## Glyph coverage (checked with fontTools, 2026-10-03)
| | 0–9 | `.` `,` | − (U+2212) | ± | ° | Ø | × | µ | tabular digits |
|---|---|---|---|---|---|---|---|---|---|
| Instrument Sans | yes | yes | yes | **no** | yes | yes | yes | **no** | yes (`tnum`) |
| JetBrains Mono | yes | yes | yes | yes | yes | yes | yes | yes | yes (monospaced) |
| Bitcount Single | yes | yes | yes | yes | yes | yes | yes | yes | yes (every glyph 600 units) |

Instrument Sans has no ± or µ, so **titles never carry values**. **Doto** (the other OFL dot-matrix face on Google Fonts, closest to Nothing's Ndot) was rejected because it has no ± and no µ.

## OFL 1.1 in practice
- Bundling in the app and embedding on the web are both allowed; the fonts may not be sold on their own.
- Keep each `OFL.txt` next to its files, and list all three families with their copyright lines in the product's acknowledgements (a Licences screen in an app, a credits line on a site, the manual for a physical product).
- Don't modify the files. If a subset or instance is ever needed, the result is a Modified Version: it keeps the OFL, and since none of the three declares a Reserved Font Name, it may keep the name.

## iOS, macOS and watchOS
1. Add the six `.ttf` files to the app target (Copy Bundle Resources), or as resources of the package that owns the UI.
2. List them in the app's Info.plist under **Fonts provided by application** (`UIAppFonts`). The file names are in `BTTokens.Fonts.bundledFiles` (`HCTokens` in HandCAD):
   ```xml
   <key>UIAppFonts</key>
   <array>
     <string>InstrumentSans-SemiBold.ttf</string>
     <string>InstrumentSans-Bold.ttf</string>
     <string>JetBrainsMono-Regular.ttf</string>
     <string>JetBrainsMono-Medium.ttf</string>
     <string>JetBrainsMono-SemiBold.ttf</string>
     <string>BitcountSingle-Variable.ttf</string>
   </array>
   ```
   Fonts shipped inside a Swift package's resources are not seen by `UIAppFonts`; register them at launch with `CTFontManagerRegisterFontsForURL(url, .process, nil)` instead.
3. Use the token fonts (`Font.btTitle2`, `Font.btNumericCaption`, `Font.btHeroNumeral`, …) or `Font(btStyle:boldText:)`. These call `Font.custom(postScriptName, size:, relativeTo:)`, so the faces scale with Dynamic Type. If a face isn't registered, they fall back to SF Mono for mono and hero, and SF Pro otherwise.
4. Bold Text: pass `boldText: legibilityWeight == .bold` (from `@Environment(\.legibilityWeight)`). A bundled face then steps up 200 in weight; the system fonts embolden themselves.
5. watchOS: text is SF Compact (the system font there). Bundle only the faces a watch screen uses — usually Bitcount Single for one hero numeral (a pairing code) and JetBrains Mono for values; Instrument Sans titles at watch sizes are an open question per sub-brand.
6. JetBrains Mono has code ligatures (`calt`, e.g. `>=`, `!=`). Turn them off in expression fields with a `UIFontDescriptor` feature setting, so `width >= 20` shows the characters that were typed.


Aujournuit SHA-256 (ttf): `f42eba574af2bade40d3574f52961f9a6f3fc6f1b9ca200d5bd2a1b96eba7d38` Regular, `5592a294e78df8ad4a3f686c35f293b8c14850e17331f2583829a9bc5a7e8b7d` Airy. One weight (400); covers 0-9 . , − ± ° × µ; no tabular figures.
