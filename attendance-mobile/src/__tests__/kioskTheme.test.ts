import {KIOSK_THEME} from "../kioskTheme";

describe("kiosk visual theme",()=>{
  it("keeps primary kiosk surfaces and actions distinct",()=>{
    expect(KIOSK_THEME.background).not.toBe(KIOSK_THEME.accent);
    expect(KIOSK_THEME.surface).not.toBe(KIOSK_THEME.lightSurface);
    expect(KIOSK_THEME.text).not.toBe(KIOSK_THEME.darkText);
  });
});
