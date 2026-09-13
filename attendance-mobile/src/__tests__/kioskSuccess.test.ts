describe("kiosk success states",()=>{
  it("maps attendance direction to human confirmation",()=>{
    const label=(direction:"IN"|"OUT")=>direction==="IN"?"CHECKED IN":"CHECKED OUT";
    expect(label("IN")).toBe("CHECKED IN");
    expect(label("OUT")).toBe("CHECKED OUT");
  });
});
