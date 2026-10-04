const T0 = "2026-10-03T00:00:00Z";

export const EAND = {
  id: "builtin-eand",
  name: "e&",
  colors: {
    accent: "#BC0000",
    accent_dark: "#9E0000",
    navy: "#141D2D",
    ink: "#1A1A1A",
    pale: "#FFE5E5",
    line: "#E7E4DE",
  },
  font_text: "Nunito Sans",
  font_numerals: "Poppins",
  logo_on_light: null,
  logo_on_dark: null,
  logo_flat: null,
  website: "www.eand.com",
  owner: "e&",
  confidentiality: "© {year} e&. All rights reserved.",
  pdf_author: "e& Drones, Robotics & AI",
  builtin: true,
  created_at: T0,
  updated_at: T0,
};

export const WHITE_LABEL = {
  ...EAND,
  id: "builtin-white-label",
  name: "White label",
  colors: {
    accent: "#1F4FD1",
    accent_dark: "#173DA6",
    navy: "#131A26",
    ink: "#141821",
    pale: "#E8EEFF",
    line: "#E3E6EC",
  },
  font_text: "Inter",
  font_numerals: "Inter",
  website: "",
  owner: "",
  confidentiality: "Confidential. Prepared for {customer}. Do not distribute without written consent.",
  pdf_author: "",
};
