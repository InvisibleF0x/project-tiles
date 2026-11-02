/**
 * UI strings for the webview; chosen by `vscode.env.language`. The texts live in
 * `shared/i18n/*.json` so the JetBrains plugin shows exactly the same wording.
 */
import en from '../shared/i18n/en.json';
import pl from '../shared/i18n/pl.json';

export type Strings = typeof en;

const polish: Strings = pl;

export function stringsFor(locale: string): Strings {
  return locale.toLowerCase().startsWith('pl') ? polish : en;
}
