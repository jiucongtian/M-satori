export type DailyState="loading"|"start"|"confirming-cost"|"generating"|"ready"|"failed"|"unavailable";
export type DailyEvent={type:"RESTORE_START"|"CONFIRM_COST"|"GENERATE"|"READY"|"UNAVAILABLE"|"RETRY"}|{type:"FAIL";recoverTo:"start"|"generating"};
export type DailyMachine={state:DailyState;recoverTo:"start"|"generating"};
export const initialDailyMachine:DailyMachine={state:"loading",recoverTo:"start"};
const allowed:Record<DailyState,Partial<Record<DailyEvent["type"],DailyState>>>={loading:{RESTORE_START:"start",GENERATE:"generating",READY:"ready",UNAVAILABLE:"unavailable",FAIL:"failed"},start:{CONFIRM_COST:"confirming-cost"},"confirming-cost":{GENERATE:"generating",FAIL:"failed"},generating:{READY:"ready",FAIL:"failed"},ready:{},failed:{RETRY:"start"},unavailable:{RETRY:"start"}};
export function dailyReducer(machine:DailyMachine,event:DailyEvent):DailyMachine{if(event.type==="FAIL")return{state:"failed",recoverTo:event.recoverTo};if(event.type==="RETRY"&&(machine.state==="failed"||machine.state==="unavailable"))return{...machine,state:machine.recoverTo};const next=allowed[machine.state][event.type];return next?{...machine,state:next}:machine;}
