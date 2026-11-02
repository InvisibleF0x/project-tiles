/**
 * Extension → language mapping with GitHub Linguist colours. Data/markup/
 * config formats are deliberately absent so that e.g. a Unity project counts
 * C# instead of .unity/.prefab/.asset YAML, and a WPF project doesn't drown in
 * XAML. The table itself lives in `shared/languages.json` (also used by the
 * JetBrains plugin).
 */
import table from '../../../shared/languages.json';

export interface LanguageDefinition {
  name: string;
  color: string;
  extensions: string[];
}

export const LANGUAGES: LanguageDefinition[] = table.languages;

/** Case-insensitive name → definition. Lets manual overrides reuse the colour palette. */
export const LANGUAGE_BY_NAME = new Map(LANGUAGES.map((l) => [l.name.toLowerCase(), l]));

/** Lower-case extension (without the dot) → definition. */
export const LANGUAGE_BY_EXTENSION = new Map<string, LanguageDefinition>();
for (const language of LANGUAGES) {
  for (const extension of language.extensions) {
    LANGUAGE_BY_EXTENSION.set(extension, language);
  }
}

/** Colour for languages that have no entry in the table (manual overrides with unknown names). */
export const UNKNOWN_LANGUAGE_COLOR = table.unknownColor;
