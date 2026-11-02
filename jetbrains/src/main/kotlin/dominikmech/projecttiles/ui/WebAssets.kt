package dominikmech.projecttiles.ui

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.DynamicBundle
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.security.SecureRandom

private fun resource(path: String): String =
    WebAssets::class.java.getResourceAsStream(path)?.use { it.readBytes().decodeToString() } ?: error("missing resource $path")

object WebAssets {
    private val script by lazy { resource("/projecttiles/webview/dashboard.js") }
    private val style by lazy { resource("/projecttiles/webview/dashboard.css") }
    private val stringsEn by lazy { JsonParser.parseString(resource("/projecttiles/shared/i18n/en.json")).asJsonObject }
    private val stringsPl by lazy { JsonParser.parseString(resource("/projecttiles/shared/i18n/pl.json")).asJsonObject }

    fun strings(): JsonObject = if (DynamicBundle.getLocale().language == "pl") stringsPl else stringsEn

    /**
     * The page: CSP like the VS Code webview (no network, scripts only with the nonce, images only as
     * data: URIs), the theme as `--vscode-*` variables, a stand-in for `acquireVsCodeApi()`, then the
     * unchanged dashboard script. Messages to the host are queued until the JCEF bridge is installed.
     */
    fun page(): String {
        check(!script.contains("</script", ignoreCase = true)) { "dashboard.js cannot be inlined" }
        val nonce = ByteArray(18).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-$nonce'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style id="theme">${themeCss()}</style>
<style>$style</style>
</head>
<body>
<div id="app"></div>
<script nonce="$nonce">
(function () {
  var queue = [], state;
  window.__ptFlush = function () { while (queue.length) window.__ptSend(queue.shift()); };
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (m) { var s = JSON.stringify(m); if (window.__ptSend) window.__ptSend(s); else queue.push(s); },
      getState: function () { return state; },
      setState: function (s) { state = s; }
    };
  };
})();
</script>
<script nonce="$nonce">$script</script>
</body>
</html>"""
    }

    /** IDE theme colours mapped onto the VS Code variables dashboard.css uses. */
    fun themeCss(): String {
        val dark = !JBColor.isBright()
        fun named(key: String, fallback: Color) = JBColor.namedColor(key, fallback)
        fun hover(c: Color) = if (dark) ColorUtil.brighter(c, 1) else ColorUtil.darker(c, 1)
        val scheme = EditorColorsManager.getInstance().globalScheme
        val foreground = UIUtil.getLabelForeground()
        val muted = UIUtil.getContextHelpForeground()
        val border = named("Borders.color", JBColor.border())
        val panel = UIUtil.getPanelBackground()
        val primary = named("Button.default.startBackground", Color(0x3574F0))
        val secondary = named("Button.startBackground", panel)
        val font = UIUtil.getLabelFont()
        val vars = linkedMapOf(
            "editor-background" to scheme.defaultBackground,
            "foreground" to foreground,
            "descriptionForeground" to muted,
            "sideBar-background" to panel,
            "editorWidget-background" to panel,
            "widget-border" to border,
            "panel-border" to border,
            "list-hoverBackground" to named("List.hoverBackground", hover(panel)),
            "focusBorder" to named("Component.focusColor", primary),
            "button-background" to primary,
            "button-foreground" to named("Button.default.foreground", Color.WHITE),
            "button-hoverBackground" to hover(primary),
            "button-secondaryBackground" to secondary,
            "button-secondaryForeground" to named("Button.foreground", foreground),
            "button-secondaryHoverBackground" to hover(secondary),
            "input-background" to named("TextField.background", scheme.defaultBackground),
            "input-foreground" to named("TextField.foreground", foreground),
            "input-border" to named("Component.borderColor", border),
            "input-placeholderForeground" to muted,
            "inputValidation-errorBackground" to named("ValidationTooltip.errorBackground", Color(0xFFF2F3)),
            "inputValidation-errorBorder" to named("ValidationTooltip.errorBorderColor", Color(0xE55765)),
            "errorForeground" to named("Label.errorForeground", Color(0xDB5C5C)),
            "textLink-foreground" to named("Link.activeForeground", primary),
            "toolbar-hoverBackground" to named("ActionButton.hoverBackground", hover(panel)),
            "progressBar-background" to named("ProgressBar.progressColor", primary),
            "badge-background" to named("Counter.background", muted),
            "badge-foreground" to named("Counter.foreground", panel),
        )
        val css = StringBuilder(":root{color-scheme:${if (dark) "dark" else "light"};")
        for ((name, color) in vars) css.append("--vscode-").append(name).append(":#").append(ColorUtil.toHex(color)).append(';')
        css.append("--vscode-font-family:'${font.family.replace("'", "")}',system-ui,sans-serif;")
        css.append("--vscode-font-size:${Math.round(font.size2D / JBUIScale.scale(1f))}px;")
        css.append("--vscode-editor-font-family:'${scheme.editorFontName.replace("'", "")}',monospace;")
        return css.append('}').toString()
    }
}
