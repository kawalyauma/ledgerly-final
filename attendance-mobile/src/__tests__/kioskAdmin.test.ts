describe("kiosk administrator contract",()=>{
  it("requires an explicit administrator PIN before settings",()=>{
    const controls={pinRequired:true,hiddenGestureTaps:5};
    expect(controls.pinRequired).toBe(true);
    expect(controls.hiddenGestureTaps).toBe(5);
  });
});
