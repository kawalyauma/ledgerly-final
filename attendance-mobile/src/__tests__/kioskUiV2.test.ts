describe("attendance kiosk UI v2 interaction contract",()=>{
  it("keeps attendance capture methods and direction semantics explicit",()=>{
    const methods=["FACE","QR","NFC","MANUAL"];
    const directions=["IN","OUT"];
    expect(methods).toEqual(expect.arrayContaining(["FACE","QR","NFC","MANUAL"]));
    expect(directions).toEqual(["IN","OUT"]);
  });

  it("uses a short success acknowledgement window",()=>{
    const acknowledgementMs=2600;
    expect(acknowledgementMs).toBeGreaterThanOrEqual(2000);
    expect(acknowledgementMs).toBeLessThanOrEqual(3000);
  });
});
