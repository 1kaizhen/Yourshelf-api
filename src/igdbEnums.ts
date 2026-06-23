// Resolver tables for IGDB enum integers → human-readable strings.
// IGDB returns small integers for many categorical fields; resolving these
// server-side keeps the frontend free of magic-number maps.

// games.game_type (formerly games.category)
export const GAME_CATEGORY: Record<number, string> = {
  0: 'main_game',
  1: 'dlc_addon',
  2: 'expansion',
  3: 'bundle',
  4: 'standalone_expansion',
  5: 'mod',
  6: 'episode',
  7: 'season',
  8: 'remake',
  9: 'remaster',
  10: 'expanded_game',
  11: 'port',
  12: 'fork',
  13: 'pack',
  14: 'update',
};

// games.status
export const GAME_STATUS: Record<number, string> = {
  0: 'released',
  2: 'alpha',
  3: 'beta',
  4: 'early_access',
  5: 'offline',
  6: 'cancelled',
  7: 'rumored',
  8: 'delisted',
};

// platforms.category
export const PLATFORM_CATEGORY: Record<number, string> = {
  1: 'console',
  2: 'arcade',
  3: 'platform',
  4: 'operating_system',
  5: 'portable_console',
  6: 'computer',
};

// websites.category
export const WEBSITE_CATEGORY: Record<number, string> = {
  1: 'official',
  2: 'wikia',
  3: 'wikipedia',
  4: 'facebook',
  5: 'twitter',
  6: 'twitch',
  8: 'instagram',
  9: 'youtube',
  10: 'iphone',
  11: 'ipad',
  12: 'android',
  13: 'steam',
  14: 'reddit',
  15: 'itch',
  16: 'epicgames',
  17: 'gog',
  18: 'discord',
};

// external_games.category
export const EXTERNAL_GAME_CATEGORY: Record<number, string> = {
  1: 'steam',
  5: 'gog',
  10: 'youtube',
  11: 'microsoft',
  13: 'apple',
  14: 'twitch',
  15: 'android',
  20: 'amazon_asin',
  22: 'amazon_luna',
  23: 'amazon_adg',
  26: 'epicgames',
  28: 'oculus',
  29: 'utomik',
  30: 'itch',
  31: 'xboxmarketplace',
  32: 'kartridge',
  36: 'playstation_store_us',
  37: 'other',
  54: 'mycrosoft_store',
  55: 'gamejolt',
};

// age_ratings.category (rating board)
export const AGE_RATING_CATEGORY: Record<number, string> = {
  1: 'ESRB',
  2: 'PEGI',
  3: 'CERO',
  4: 'USK',
  5: 'GRAC',
  6: 'CLASS_IND',
  7: 'ACB',
};

// age_ratings.rating (the actual rating label)
export const AGE_RATING_VALUE: Record<number, string> = {
  1: 'Three',
  2: 'Seven',
  3: 'Twelve',
  4: 'Sixteen',
  5: 'Eighteen',
  6: 'RP',
  7: 'EC',
  8: 'E',
  9: 'E10+',
  10: 'T',
  11: 'M',
  12: 'AO',
  13: 'CERO_A',
  14: 'CERO_B',
  15: 'CERO_C',
  16: 'CERO_D',
  17: 'CERO_Z',
  18: 'USK_0',
  19: 'USK_6',
  20: 'USK_12',
  21: 'USK_16',
  22: 'USK_18',
  23: 'GRAC_ALL',
  24: 'GRAC_Twelve',
  25: 'GRAC_Fifteen',
  26: 'GRAC_Eighteen',
  27: 'GRAC_TESTING',
  28: 'CLASS_IND_L',
  29: 'CLASS_IND_Ten',
  30: 'CLASS_IND_Twelve',
  31: 'CLASS_IND_Fourteen',
  32: 'CLASS_IND_Sixteen',
  33: 'CLASS_IND_Eighteen',
  34: 'ACB_G',
  35: 'ACB_PG',
  36: 'ACB_M',
  37: 'ACB_MA15',
  38: 'ACB_R18',
  39: 'ACB_RC',
};

// release_dates.region
export const REGION: Record<number, string> = {
  1: 'europe',
  2: 'north_america',
  3: 'australia',
  4: 'new_zealand',
  5: 'japan',
  6: 'china',
  7: 'asia',
  8: 'worldwide',
  9: 'korea',
  10: 'brazil',
};

// language_support_type (Audio, Subtitles, Interface)
export const LANGUAGE_SUPPORT_TYPE: Record<number, 'audio' | 'subtitles' | 'interface'> = {
  1: 'audio',
  2: 'subtitles',
  3: 'interface',
};

export function resolve<T extends string>(table: Record<number, T>, value: number | undefined | null): T | null {
  if (value === undefined || value === null) return null;
  return table[value] ?? null;
}
