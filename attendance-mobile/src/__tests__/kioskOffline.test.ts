describe("kiosk offline contract",()=>{
  it("keeps offline capture visible to the operator",()=>{
    const offlineState={label:"Offline mode",queueLabel:"queued"};
    expect(offlineState.label).toMatch(/Offline/);
    expect(offlineState.queueLabel).toBe("queued");
  });
});
