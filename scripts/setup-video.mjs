import { spawnSync } from "node:child_process";
import { join } from "node:path";
const directory=join(".chalk-work","video-venv");
function run(command,args){const r=spawnSync(command,args,{stdio:"inherit",windowsHide:true});if(r.status!==0)process.exit(r.status || 1);}
run("python",["-m","venv",directory]);
run(join(directory,process.platform==="win32" ? "Scripts/python.exe" : "bin/python"),["-m","pip","install","manim==0.21.0"]);
