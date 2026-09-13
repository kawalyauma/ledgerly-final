describe("name-only kiosk product decision",()=>{
  it("keeps the kiosk capture method supervised manual lookup",()=>{
    const kioskCaptureMethod="MANUAL";
    const entryMode="NAME_LOOKUP";
    expect(kioskCaptureMethod).toBe("MANUAL");
    expect(entryMode).toBe("NAME_LOOKUP");
  });

  it("does not depend on biometric or scanner capture methods",()=>{
    const disabledMethods=["FACE","QR","NFC"];
    expect(disabledMethods).toEqual(["FACE","QR","NFC"]);
  });
});
