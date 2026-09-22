# Faithful DOCX Export

Plugin de Obsidian (MVP gratis) que exporta una nota a Word (`.docx`) **sin romper la
sintaxis de Obsidian**: callouts tipados, wikilinks, embeds y etiquetas salen
convertidos, no como texto literal.

## Qué hace

Comando **Export to Word (faithful)** (paleta de comandos) → escribe `<Nota>.docx`
junto al `.md` original.

Pre-procesado de sintaxis Obsidian antes de convertir:

| Sintaxis Obsidian | Salida en Word |
| --- | --- |
| `> [!warning] Título` (+ líneas `>`) | Párrafo con badge `⚠️ AVISO` en negrita + cuerpo (sin literal `[!warning]`) |
| `[[Nota\|Alias]]` / `[[Nota]]` / `[[Nota#Sección]]` | Texto con hyperlink `obsidian://open?vault=…&file=…` (si la nota existe) |
| `[[nota inexistente]]` | Solo texto, sin link |
| `![[Otra Nota]]` | Contenido de esa nota insertado (recursión máx. 2, anti-ciclo) |
| `![[img.png\|400]]`, `![[img.png\|400x300]]` | Imagen del vault con ancho/alto indicados |
| `==resaltado==` | Highlight amarillo (`<w:highlight w:val="yellow"/>`) |
| `%%oculto%%` | Eliminado |
| `#etiqueta` | Texto plano (sin `#`) |

Badges de callout: `note`/`info`→`ℹ️ NOTA`, `warning`/`caution`/`danger`/`bug`→`⚠️ AVISO`,
`tip`/`success`/`example`→`💡 CONSEJO`, `quote`→`❝ CITA`, resto→`📌 TIPO`.
Los modificadores `+`/`-`/`^` se ignoran.

## Instalación manual

1. `npm install && npm run build` (genera `main.js`).
2. Copiar `manifest.json`, `main.js` y `styles.css` a
   `<vault>/.obsidian/plugins/faithful-docx-export/`.
3. En Obsidian: Ajustes → Complementos → activar **Faithful DOCX Export**.

## Desarrollo

- `npm run build` → `tsc -noEmit` + bundle esbuild → `main.js`.
- `npm test` → `node --test test/converter.test.mjs`: fixture con toda la sintaxis
  Obsidian → preprocesador + converter → descomprime el `.docx` y asserta el
  `word/document.xml` (y `word/_rels/document.xml.rels` para los `Target="obsidian://…"`).

## Estructura

Scaffolding de [`obsidianmd/obsidian-sample-plugin`](https://github.com/obsidianmd/obsidian-sample-plugin)
(TypeScript + esbuild + `manifest.json`), `isDesktopOnly: true`.

## Créditos

- Converter derived from obsidian-toword (c) PixeroJan, MIT
  (<https://github.com/PixeroJan/obsidian-toword>) — ver `NOTICE`.
- Estructura del plugin derivada de obsidian-sample-plugin (c) Obsidian, ver su licencia.

## Desviaciones conocidas (f2)

- `tsconfig.json` relajado (`noUncheckedIndexedAccess: false`): el fork de toword
  indexa arrays sin guards; el resto de `strict` se mantiene.
- El fichero fuente del converter en toword es `converter-mobile.ts` (no existe
  `converter.ts`); se copió adaptado como `src/converter.ts`.
- Los hiperlinks externos del converter upstream no generaban relationships OOXML;
  aquí se emiten (`getExternalLinkId` + `TargetMode="External"`) para que
  `obsidian://…` sea un hyperlink real en Word.
- `%%oculto%%` solo se elimina si abre y cierra en la misma línea.
