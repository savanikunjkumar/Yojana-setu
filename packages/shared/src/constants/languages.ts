/**
 * Languages the voice interface targets, as BCP-47 tags that browser
 * SpeechRecognition / SpeechSynthesis and the major cloud STT vendors accept.
 * Ordered by number of speakers so the language picker needs no scrolling for
 * most users.
 */
export interface SupportedLanguage {
  readonly code: string;
  readonly name: string;
  readonly nativeName: string;
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'en-IN', name: 'English', nativeName: 'English' },
  { code: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'mr-IN', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'or-IN', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'as-IN', name: 'Assamese', nativeName: 'অসমীয়া' },
  { code: 'ur-IN', name: 'Urdu', nativeName: 'اردو' },
];

export const DEFAULT_LANGUAGE = 'hi-IN';

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

export function isSupportedLanguage(code: string): boolean {
  return LANGUAGE_CODES.includes(code);
}
