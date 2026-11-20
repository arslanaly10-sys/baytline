/**
 * Photographs on the marketing site. All are licensed stand-ins (Wikimedia Commons, Unsplash): they
 * show the region and the kinds of buildings Baytline serves, not Baytline customers or listings.
 * Each is credited on /[locale]/credits. Files live in public/photos as <slug>-<width>.webp.
 */
export type PhotoSlug =
  | "dubai-marina" | "riyadh" | "doha-west-bay" | "kuwait-city" | "manama" | "muscat-bay"
  | "construction" | "white-tower" | "apartment-block" | "dining-room";

export type PhotoDef = {
  slug: PhotoSlug;
  width: number; // of the largest file
  height: number;
  widths: readonly number[];
  by: string;
  licence: string;
  licenceUrl: string;
  source: "Wikimedia Commons" | "Unsplash";
  page: string;
  adapted?: boolean; // cropped
  focus?: string; // object-position for tight crops
};

export const PHOTOS: Record<PhotoSlug, PhotoDef> = {
  "dubai-marina": { slug: "dubai-marina", width: 1420, height: 990, widths: [640, 1280], by: "Norlando Pobre", licence: "CC BY 2.0", licenceUrl: "https://creativecommons.org/licenses/by/2.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Dubai_Marina_Skyline.jpg", adapted: true },
  riyadh: { slug: "riyadh", width: 1600, height: 1067, widths: [640, 1280], by: "B.alotaby", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Riyadh_North_Skyline_.jpg" },
  "doha-west-bay": { slug: "doha-west-bay", width: 1010, height: 850, widths: [640, 1010], by: "Alex Sergeev (asergeev.com)", licence: "CC BY-SA 3.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:View_of_Doha_Corniche_and_West_Bay_from_Balhambar_Restaurant.jpg", adapted: true },
  "kuwait-city": { slug: "kuwait-city", width: 1920, height: 1344, widths: [640, 1280, 1920], by: "Zairon", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Kuwait_City_Kuwait_Towers_View_to_the_al-Hamra_Tower.jpg" },
  manama: { slug: "manama", width: 1920, height: 943, widths: [640, 1280, 1920], by: "Zairon", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Manama_Bahrain_National_Museum_Umgebung_1.jpg" },
  "muscat-bay": { slug: "muscat-bay", width: 1920, height: 1280, widths: [640, 1280, 1920], by: "Diego Delso", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Bah%C3%ADa_de_Al_Mirani,_Mascate,_Om%C3%A1n,_2024-08-14,_DD_44.jpg", focus: "12% 60%" },
  construction: { slug: "construction", width: 1300, height: 1700, widths: [640, 1280], by: "Kritzolina", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: "Wikimedia Commons", page: "https://commons.wikimedia.org/wiki/File:Construction_work_in_Freiham_11.jpg", adapted: true },
  "white-tower": { slug: "white-tower", width: 1920, height: 1292, widths: [640, 1280, 1920], by: "Julien Moreau", licence: "Unsplash License", licenceUrl: "https://unsplash.com/license", source: "Unsplash", page: "https://unsplash.com/photos/688Fna1pwOQ" },
  "apartment-block": { slug: "apartment-block", width: 1920, height: 1280, widths: [640, 1280, 1920], by: "Roman Kraft", licence: "Unsplash License", licenceUrl: "https://unsplash.com/license", source: "Unsplash", page: "https://unsplash.com/photos/7sMHTVJ0OTA" },
  "dining-room": { slug: "dining-room", width: 1920, height: 1282, widths: [640, 1280, 1920], by: "Breather", licence: "Unsplash License", licenceUrl: "https://unsplash.com/license", source: "Unsplash", page: "https://unsplash.com/photos/DEdM9Vs6s8w" },
};

export const MARKET_PHOTO = { AE: "dubai-marina", SA: "riyadh", QA: "doha-west-bay", KW: "kuwait-city", BH: "manama", OM: "muscat-bay" } as const satisfies Record<string, PhotoSlug>;
export const AUDIENCE_PHOTO = { developer: "construction", brokerage: "white-tower", management: "apartment-block", personal: "dining-room" } as const satisfies Record<string, PhotoSlug>;
