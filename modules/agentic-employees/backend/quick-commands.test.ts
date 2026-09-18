import { describe,expect,it } from "vitest";
import { buildQuickCommandCatalog } from "./quick-commands";
import type { LightToolDescriptor,LightToolRegistry } from "./light-tool-registry";

function registry(tools:LightToolDescriptor[]):LightToolRegistry{
  return{
    tools,
    kinds:[...new Set(tools.map(t=>t.kind))],
    modules:[...new Set(tools.map(t=>t.module))],
    groupsByModule:{},
    stats:{
      total:tools.length,
      routeTools:tools.filter(t=>t.source==="route").length,
      nativeTools:tools.filter(t=>t.source==="native").length,
      writes:tools.filter(t=>!t.readOnly).length,
      reads:tools.filter(t=>t.readOnly).length,
    },
  };
}
function route(overrides:Partial<LightToolDescriptor>&Pick<LightToolDescriptor,"name"|"kind"|"method"|"pathTemplate">):LightToolDescriptor{
  return{
    description:overrides.name.replace(/_/g," "),
    module:"school",
    group:"general",
    source:"route",
    readOnly:overrides.method==="GET",
    aliases:[],
    ...overrides,
  };
}

describe("Quick command catalog",()=>{
  it("turns create student into an editable validated form with searchable Ledgerly references",()=>{
    const catalog=buildQuickCommandCatalog(registry([route({
      name:"create_student",kind:"create",module:"students",group:"students",method:"POST",
      pathTemplate:"/api/v1/school/student-management/students",readOnly:false,aliases:["create student"],
    })]));
    const command=catalog.commands[0]!;
    expect(command.command).toBe("create student");
    expect(command.aliases).toContain("add student");
    expect(command.aliases).toContain("register student");
    expect(command.aliases).toContain("create learner");
    expect(command.aliases).toContain("add pupil");
    expect(command.aliases).toContain("create new student");
    expect(command.fields.find(f=>f.name==="firstName")?.required).toBe(true);
    expect(command.fields.find(f=>f.name==="lastName")?.required).toBe(true);
    expect(command.fields.find(f=>f.name==="admissionDate")?.required).toBe(true);
    expect(command.fields.find(f=>f.name==="currentClassId")?.control).toBe("reference");
    expect(command.fields.find(f=>f.name==="currentAcademicYearId")?.control).toBe("reference");
    expect(command.fields.find(f=>f.name==="currentStreamId")?.control).toBe("reference");
  });

  it("keeps list classes separate while open class uses a searchable class selector",()=>{
    const catalog=buildQuickCommandCatalog(registry([
      route({name:"list_classes",kind:"query",module:"school setup",group:"classes",method:"GET",pathTemplate:"/api/v1/school/setup/classes",readOnly:true,aliases:["list classes"]}),
      route({name:"get_class",kind:"query",module:"school setup",group:"classes",method:"GET",pathTemplate:"/api/v1/school/setup/classes/:id",readOnly:true,aliases:["get class"]}),
    ]));
    const list=catalog.commands.find(item=>item.toolName==="list_classes")!,command=catalog.commands.find(item=>item.toolName==="get_class")!;
    expect(list.command).toBe("list classes");
    expect(list.fields).toHaveLength(0);
    expect(command.command).toBe("open class");
    expect(command.aliases).toContain("open class");
    expect(command.fields).toHaveLength(1);
    expect(command.fields[0]).toMatchObject({name:"classId",requestKey:"id",control:"reference",required:true});
  });

  it("turns future entity ID inputs into searchable reference controls without a hard-coded form",()=>{
    const tool:LightToolDescriptor={
      name:"inspect_timetable",description:"Inspect a timetable",kind:"query",module:"academics",group:"timetable",source:"native",readOnly:true,nativeName:"inspect_timetable",aliases:["inspect timetable"],
      parameters:{type:"object",properties:{timetableId:{type:"string"},date:{type:"string"}},required:["timetableId"]},
    };
    const command=buildQuickCommandCatalog(registry([tool])).commands[0]!;
    expect(command.fields.find(f=>f.name==="timetableId")).toMatchObject({control:"reference",required:true,referenceKey:"timetableId"});
  });

  it("generates comfortably more than 500 searchable command phrases from a modest live route catalog",()=>{
    const tools=Array.from({length:80},(_,i)=>route({
      name:`route_get_domain_${i}_records`,kind:"query",module:`domain ${i%8}`,group:"records",method:"GET",
      pathTemplate:`/api/v1/domain-${i}/records-${i}`,readOnly:true,aliases:[`list records ${i}`],
    }));
    const catalog=buildQuickCommandCatalog(registry(tools));
    expect(catalog.stats.toolCount).toBe(80);
    expect(catalog.stats.commandCount).toBeGreaterThan(500);
  });
});
