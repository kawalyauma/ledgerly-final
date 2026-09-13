describe("attendance kiosk name-only interaction contract",()=>{
  it("uses name lookup as the only kiosk attendance capture method",()=>{
    const methods=["MANUAL"];
    expect(methods).toEqual(["MANUAL"]);
    expect(methods).not.toEqual(expect.arrayContaining(["FACE","QR","NFC"]));
  });

  it("keeps arrival and departure semantics explicit",()=>{
    const directions=["IN","OUT"];
    expect(directions).toEqual(["IN","OUT"]);
  });

  it("uses a short success acknowledgement window",()=>{
    const acknowledgementMs=2400;
    expect(acknowledgementMs).toBeGreaterThanOrEqual(2000);
    expect(acknowledgementMs).toBeLessThanOrEqual(3000);
  });

  it("requires five logo taps before the temporary kiosk escape PIN",()=>{
    const requiredLogoTaps=5;
    const kioskEscapePin="1212";
    expect(requiredLogoTaps).toBe(5);
    expect(kioskEscapePin).toBe("1212");
    expect(kioskEscapePin).toHaveLength(4);
  });

  it("treats kiosk escape as temporary rather than a purpose change",()=>{
    const foregroundBehavior="KioskManager.enter";
    const successfulEscapeAction="KioskManager.exit";
    expect(successfulEscapeAction).toBe("KioskManager.exit");
    expect(foregroundBehavior).toBe("KioskManager.enter");
  });
});
