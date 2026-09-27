import type { SceneScript, SceneVariable } from "./schema";
import { compileExpression } from "./expressions";

const variable=(name:string,value:number,unit:string,label:string,min:number,max:number,step:number):SceneVariable=>({name,value,unit,label,min,max,step,adjustable:true});
const point=(x:string|number,y:string|number=0,z:string|number=0)=>({x:String(x),y:String(y),z:String(z)});
const object=(id:string,label:string,shape:"box"|"sphere",x:string,y:string)=>({id,label,shape,position:point(x,y),rotation:point(0),size:{x:0.6,y:0.6,z:0.6,radius:0.3},color:"#86D9B0",visible:"1",trail:true});
function build(title:string,problemText:string,variables:SceneVariable[],objects:SceneScript["objects"],steps:{title:string;narration:string;equations:string[]}[],answers:{question:string;expression:string;unit:string}[]):SceneScript {
  const scope=Object.fromEntries(variables.map(v=>[v.name,v.value]));
  return {title,problemText,variables,duration:6,loop:false,world:{gravity:"0",showGrid:true,groundY:-1000,scale:1},camera:{position:[5,3,11],target:[0,0,0]},objects,connectors:[],vectors:[],
    steps:steps.map((s,i)=>({...s,tStart:i*6/steps.length,tEnd:(i+1)*6/steps.length,focus:objects.map(o=>o.id),showVectors:[]})),
    answers:answers.map(a=>({...a,value:Number(compileExpression(a.expression,variables.map(v=>v.name)).evaluate(scope))}))};
}
export const dampingFrequency="sqrt(k/m-(b/(2*m))^2)";
export const dampingDisplacement=(t:string)=>`A*exp(-b*${t}/(2*m))*(cos(${dampingFrequency}*${t})+b/(2*m*${dampingFrequency})*sin(${dampingFrequency}*${t}))`;
export const dampingVelocity=(t:string)=>`-A*k/(m*${dampingFrequency})*exp(-b*${t}/(2*m))*sin(${dampingFrequency}*${t})`;
const damping=build("Damped spring oscillation","A mass m on a spring k is released from displacement A with zero initial velocity. A viscous damper exerts -b v. Find the damped frequency, displacement after 6 seconds, and energy decay. Assumptions: linear spring, linear viscous damping, underdamped motion, no driving force. Slider ranges keep every combination underdamped.",
  [variable("m",1,"kg","Mass",.5,2,.1),variable("k",9,"N/m","Spring stiffness",4,16,.5),variable("b",.6,"kg/s","Damping",.1,1,.05),variable("A",1,"m","Initial displacement",.2,2,.1)],
  [object("mass","Oscillating mass","box",dampingDisplacement("t"),"0"),object("anchor","Spring anchor","box","-3","0")],
  [{title:"Write the force balance",narration:"The spring pulls back toward equilibrium, while the damper opposes velocity. Newton's second law gives a second-order differential equation. Start with displacement A and zero velocity, rather than assuming an arbitrary sine wave.",equations:["m\\ddot{x}+b\\dot{x}+kx=0","x(0)=A,\\quad\\dot{x}(0)=0"]},
   {title:"Solve the decaying oscillation",narration:"The displacement oscillates inside an exponentially shrinking envelope. Damping lowers the oscillation frequency below the undamped spring frequency. The extra sine term ensures the mass starts with zero velocity.",equations:["\\alpha=\\frac{b}{2m}","\\omega_d=\\sqrt{\\frac{k}{m}-\\alpha^2}","x=Ae^{-\\alpha t}(\\cos\\omega_d t+\\frac{\\alpha}{\\omega_d}\\sin\\omega_d t)"]},
   {title:"Check the energy",narration:"Kinetic and spring energy exchange during each oscillation. Their total decreases because the damper removes energy at the rate b times velocity squared. Increasing damping changes both the envelope and frequency.",equations:["E=\\frac12 m\\dot{x}^2+\\frac12 kx^2","\\frac{dE}{dt}=-b\\dot{x}^2"]}],
  [{question:"Damped angular frequency",expression:dampingFrequency,unit:"rad/s"},{question:"Displacement at 6 s",expression:dampingDisplacement("6"),unit:"m"},{question:"Mechanical energy at 6 s",expression:`0.5*m*(${dampingVelocity("6")})^2+0.5*k*(${dampingDisplacement("6")})^2`,unit:"J"}]);
damping.connectors = [{id:"spring",kind:"spring",from:"anchor",to:"mass"}];
damping.camera={position:[-1,1,5],target:[-1,0,0]};

export const circuitFrequency="sqrt(1/(L*C)-(R/(2*L))^2)";
export const circuitCharge=(t:string)=>`Q*exp(-R*${t}/(2*L))*(cos(${circuitFrequency}*${t})+R/(2*L*${circuitFrequency})*sin(${circuitFrequency}*${t}))`;
export const circuitCurrent=(t:string)=>`Q/(L*C*${circuitFrequency})*exp(-R*${t}/(2*L))*sin(${circuitFrequency}*${t})`;
const circuit=build("Source-free RLC circuit","A capacitor carrying initial charge Q discharges through a series resistor R and inductor L, with zero initial current. Find frequency, charge, and discharge current at 6 seconds. Assumptions: ideal lumped components, constant R/L/C, underdamped response, no external source. The moving marker represents normalized capacitor charge; its spatial motion is diagrammatic, not electron speed. Positive discharge current is -dq/dt.",
  [variable("L",1,"H","Inductance",.5,2,.1),variable("C",.04,"F","Capacitance",.01,.05,.005),variable("R",.5,"ohm","Resistance",.1,1,.1),variable("Q",.1,"C","Initial charge",.01,.2,.01)],
  [object("charge","Charge indicator","sphere",`2*(${circuitCharge("t")})/Q`,"-2.5"),object("capacitor","Capacitor","box","-2","1"),object("resistor","Resistor","box","0","1"),object("inductor","Inductor","box","2","1")],
  [{title:"Apply Kirchhoff's voltage law",narration:"The resistor, inductor and capacitor voltage drops sum to zero. Expressing current through the time derivative of capacitor charge produces a differential equation with the same mathematical structure as a damped spring.",equations:["L\\ddot{q}+R\\dot{q}+q/C=0","q(0)=Q,\\quad\\dot{q}(0)=0"]},
   {title:"Oscillation between electric and magnetic energy",narration:"The capacitor's electric energy moves into the inductor's magnetic field and then back again. Resistance dissipates energy, so the charge reversals become smaller. The marker shows the sign and normalized magnitude of charge, not the trajectory of an electron.",equations:["\\alpha=R/(2L)","\\omega_d=\\sqrt{1/(LC)-\\alpha^2}"]},
   {title:"Read the charge and current",narration:"Evaluate the charge solution at the requested time. Discharge current is the negative derivative of charge under our sign convention. The natural angular frequency and exponential damping depend on different combinations of the component values.",equations:["i=-\\dot{q}","E=q^2/(2C)+Li^2/2","\\dot{E}=-Ri^2"]}],
  [{question:"Damped angular frequency",expression:circuitFrequency,unit:"rad/s"},{question:"Capacitor charge at 6 s",expression:circuitCharge("6"),unit:"C"},{question:"Discharge current at 6 s",expression:circuitCurrent("6"),unit:"A"}]);

circuit.objects.find(o=>o.id==="capacitor")!.shape="capacitor";
circuit.objects.find(o=>o.id==="resistor")!.shape="resistor";
circuit.objects.find(o=>o.id==="inductor")!.shape="inductor";
circuit.connectors=[
  {id:"wire_cr",kind:"rod",from:"-1.3,1,0",to:"-0.7,1,0"},
  {id:"wire_rl",kind:"rod",from:"0.7,1,0",to:"1.3,1,0"},
  {id:"wire_left",kind:"rod",from:"-2.7,1,0",to:"-3.2,1,0"},
  {id:"wire_down_left",kind:"rod",from:"-3.2,1,0",to:"-3.2,-1,0"},
  {id:"wire_bottom",kind:"rod",from:"-3.2,-1,0",to:"3.2,-1,0"},
  {id:"wire_down_right",kind:"rod",from:"3.2,-1,0",to:"3.2,1,0"},
  {id:"wire_right",kind:"rod",from:"3.2,1,0",to:"2.7,1,0"}
];
circuit.camera={position:[0,0,8],target:[0,-.5,0]};

export const dragVelocity=(t:string)=>`m*g/c*(1-exp(-c*${t}/m))`;
export const dragDistance=(t:string)=>`m*g/c*(${t}-m/c*(1-exp(-c*${t}/m)))`;
const drag=build("Fall through a fluid with linear drag","A body of mass m falls from rest in a fluid with drag force -c v. Find terminal speed, speed after 6 seconds, and downward displacement. Assumptions: linear Stokes-like drag regime, constant effective downward acceleration g, buoyancy absorbed into g, unbounded fluid, no ground impact or turbulence. Drawing uses one scene unit per 5 metres of downward displacement.",
  [variable("m",1,"kg","Mass",.5,2,.1),variable("c",1,"kg/s","Drag coefficient",.2,2,.1),variable("g",9.81,"m/s^2","Effective gravity",1,12,.1)],
  [object("body","Falling body","sphere","0",`-(${dragDistance("t")})/5`)],
  [{title:"Balance gravity and drag",narration:"Choose downward as positive. Gravity accelerates the body, and drag acts upward in proportion to speed. As the body speeds up, drag grows until it balances the effective weight.",equations:["m\\dot{v}=mg-cv","v(0)=0"]},
   {title:"Approach terminal velocity",narration:"The velocity approaches a limiting value exponentially rather than increasing forever. The characteristic response time is mass divided by drag coefficient. A heavier body responds more slowly and has a higher terminal velocity for the same coefficient.",equations:["v_T=mg/c","\\tau=m/c","v(t)=v_T(1-e^{-t/\\tau})"]},
   {title:"Integrate to find displacement",narration:"Integrate the velocity from the release time to obtain downward displacement. Initially it agrees with free fall; later the distance grows almost linearly because the speed is close to terminal velocity. This model does not describe turbulent or quadratic drag.",equations:["s(t)=v_T[t-\\tau(1-e^{-t/\\tau})]"]}],
  [{question:"Terminal speed",expression:"m*g/c",unit:"m/s"},{question:"Speed at 6 s",expression:dragVelocity("6"),unit:"m/s"},{question:"Downward displacement at 6 s",expression:dragDistance("6"),unit:"m"}]);
drag.camera={position:[5,-4,15],target:[0,-5,0]};
export const advancedPresets={damping,circuit,drag};
export const advancedPresetList=[{key:"damping" as const,name:"Damped spring oscillation",blurb:damping.problemText},{key:"circuit" as const,name:"Source-free RLC circuit",blurb:circuit.problemText},{key:"drag" as const,name:"Fall through a fluid with linear drag",blurb:drag.problemText}];
