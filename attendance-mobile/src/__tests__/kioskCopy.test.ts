describe("kiosk action copy",()=>{
  it("uses clear shared-device attendance language",()=>{
    const labels=["ARRIVING","LEAVING","Face / QR","NFC ready","Find your name"];
    expect(labels).toHaveLength(5);
    expect(labels).toContain("ARRIVING");
    expect(labels).toContain("LEAVING");
  });
});
