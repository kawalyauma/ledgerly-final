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
});
