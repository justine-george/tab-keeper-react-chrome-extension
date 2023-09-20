import { useTranslation } from 'react-i18next';

export function useFontFamily() {
  const { i18n } = useTranslation();
  const currentLanguage = i18n.language;
  let font;

  switch (currentLanguage) {
    // Latin script languages
    case 'en':
    case 'fr':
    case 'de':
    case 'pt':
    case 'es':
    case 'it':
    case 'nl':
    case 'sv':
      font = 'Libre Franklin, sans-serif';
      break;

    // // Cyrillic script languages (e.g., Russian, Bulgarian)
    // case 'ru':
    // case 'bg':
    //   font = 'Cyrillic-font-family, sans-serif';
    //   break;

    // // Greek script language
    // case 'el':
    //   font = 'Greek-font-family, sans-serif';
    //   break;

    // // Arabic script language
    // case 'ar':
    //   font = 'Arabic-font-family, sans-serif';
    //   break;

    // // Devanagari script (e.g., Hindi)
    // case 'hi':
    //   font = 'Devanagari-font-family, sans-serif';
    //   break;

    // // East Asian languages (e.g., Chinese, Japanese, Korean)
    // case 'zh':
    // case 'ja':
    // case 'ko':
    //   font = 'East-Asian-font-family, sans-serif';
    //   break;

    // // Turkish (uses Latin script but might have unique needs due to special characters)
    // case 'tr':
    //   font = 'Turkish-font-family, sans-serif';
    //   break;

    default:
      font = 'Libre Franklin, sans-serif'; // fallback to Libre Franklin
      break;
  }

  console.log(currentLanguage);
  return font;
}
